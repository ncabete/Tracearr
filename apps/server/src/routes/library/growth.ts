/**
 * Library Growth Route
 *
 * GET /growth - Time-series library growth data points
 *
 * Uses pre-computed library_snapshots for efficient growth tracking.
 * Snapshots are created daily by the maintenance job.
 */

import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'drizzle-orm';
import {
  REDIS_KEYS,
  CACHE_TTL,
  TIME_MS,
  libraryGrowthQuerySchema,
  type LibraryGrowthQueryInput,
} from '@tracearr/shared';
import { db } from '../../db/client.js';
import { validateServerAccess } from '../../utils/serverFiltering.js';
import { buildLibraryCacheKey } from './utils.js';

/** Single data point in growth timeline (per media type) */
interface GrowthDataPoint {
  day: string;
  total: number;
  additions: number;
}

/** Library growth response shape with separate series per media type */
interface LibraryGrowthResponse {
  period: string;
  movies: GrowthDataPoint[];
  episodes: GrowthDataPoint[];
  music: GrowthDataPoint[];
}

/**
 * Calculate start date based on period string.
 * Returns null for 'all' which triggers dynamic earliest date lookup.
 */
function getStartDate(period: '7d' | '30d' | '90d' | '1y' | 'all'): Date | null {
  const now = new Date();
  switch (period) {
    case '7d':
      return new Date(now.getTime() - 7 * TIME_MS.DAY);
    case '30d':
      return new Date(now.getTime() - 30 * TIME_MS.DAY);
    case '90d':
      return new Date(now.getTime() - 90 * TIME_MS.DAY);
    case '1y':
      return new Date(now.getTime() - 365 * TIME_MS.DAY);
    case 'all':
      return null;
  }
}

export const libraryGrowthRoute: FastifyPluginAsync = async (app) => {
  /**
   * GET /growth - Library growth timeline
   *
   * Returns time-series data from pre-computed library_snapshots.
   * Much more efficient than computing growth from library_items on the fly.
   */
  app.get<{ Querystring: LibraryGrowthQueryInput }>(
    '/growth',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const query = libraryGrowthQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.badRequest('Invalid query parameters');
      }

      const { serverId, libraryId, period, timezone } = query.data;
      const authUser = request.user;
      const tz = timezone ?? 'UTC';

      // Validate server access if specific server requested
      if (serverId) {
        const error = validateServerAccess(authUser, serverId);
        if (error) {
          return reply.forbidden(error);
        }
      }

      // Build cache key with all varying params
      const cacheKey = buildLibraryCacheKey(REDIS_KEYS.LIBRARY_GROWTH, serverId, period, tz);

      // Add libraryId to cache key if provided
      const fullCacheKey = libraryId ? `${cacheKey}:${libraryId}` : cacheKey;

      // Try cache first
      const cached = await app.redis.get(fullCacheKey);
      if (cached) {
        try {
          return JSON.parse(cached) as LibraryGrowthResponse;
        } catch {
          // Fall through to compute
        }
      }

      // Build server filter for snapshots table
      const serverFilter = serverId
        ? sql`AND ls.server_id = ${serverId}::uuid`
        : authUser.serverIds?.length
          ? sql`AND ls.server_id = ANY(${authUser.serverIds}::uuid[])`
          : sql``;

      // Optional library filter
      const libraryFilter = libraryId ? sql`AND ls.library_id = ${libraryId}` : sql``;

      // Calculate date range
      const startDate = getStartDate(period);
      const endDate = new Date();

      // For 'all' period, find the earliest snapshot date from library_snapshots
      let effectiveStartDate: Date;
      if (startDate) {
        effectiveStartDate = startDate;
      } else {
        const earliestResult = await db.execute(sql`
          SELECT MIN(snapshot_time)::date AS earliest
          FROM library_snapshots ls
          WHERE 1=1
            ${serverFilter}
            ${libraryFilter}
        `);
        const earliest = (earliestResult.rows[0] as { earliest: string | null })?.earliest;
        effectiveStartDate = earliest ? new Date(earliest) : new Date('2020-01-01');
      }

      // Query from library_snapshots - much more efficient than generate_series
      // Snapshots are point-in-time markers - use MAX per library per day, then SUM across libraries
      const result = await db.execute(sql`
        WITH library_daily AS (
          -- Get MAX counts per library per day (handles multiple snapshots per day)
          SELECT
            DATE(ls.snapshot_time AT TIME ZONE ${tz}) AS day,
            ls.server_id,
            ls.library_id,
            MAX(ls.movie_count) AS movies,
            MAX(ls.episode_count) AS episodes,
            MAX(ls.music_count) AS music
          FROM library_snapshots ls
          WHERE ls.snapshot_time >= ${effectiveStartDate.toISOString()}::timestamptz
            AND ls.snapshot_time <= ${endDate.toISOString()}::timestamptz
            ${serverFilter}
            ${libraryFilter}
          GROUP BY 1, ls.server_id, ls.library_id
        ),
        daily_totals AS (
          -- Sum across all libraries for each day
          SELECT
            day,
            SUM(movies)::int AS movies,
            SUM(episodes)::int AS episodes,
            SUM(music)::int AS music
          FROM library_daily
          GROUP BY day
        ),
        with_additions AS (
          -- Calculate additions as difference from previous day
          SELECT
            day,
            movies,
            episodes,
            music,
            GREATEST(0, movies - COALESCE(LAG(movies) OVER (ORDER BY day), movies))::int AS movie_adds,
            GREATEST(0, episodes - COALESCE(LAG(episodes) OVER (ORDER BY day), episodes))::int AS episode_adds,
            GREATEST(0, music - COALESCE(LAG(music) OVER (ORDER BY day), music))::int AS music_adds
          FROM daily_totals
        )
        SELECT
          day::text,
          movies,
          episodes,
          music,
          movie_adds,
          episode_adds,
          music_adds
        FROM with_additions
        ORDER BY day ASC
      `);

      const rows = result.rows as Array<{
        day: string;
        movies: number;
        episodes: number;
        music: number;
        movie_adds: number;
        episode_adds: number;
        music_adds: number;
      }>;

      // Build separate arrays for each media type
      const movies: GrowthDataPoint[] = [];
      const episodes: GrowthDataPoint[] = [];
      const music: GrowthDataPoint[] = [];

      for (const row of rows) {
        if (row.movies > 0 || row.movie_adds > 0) {
          movies.push({
            day: row.day,
            total: row.movies,
            additions: row.movie_adds,
          });
        }

        if (row.episodes > 0 || row.episode_adds > 0) {
          episodes.push({
            day: row.day,
            total: row.episodes,
            additions: row.episode_adds,
          });
        }

        if (row.music > 0 || row.music_adds > 0) {
          music.push({
            day: row.day,
            total: row.music,
            additions: row.music_adds,
          });
        }
      }

      const response: LibraryGrowthResponse = {
        period,
        movies,
        episodes,
        music,
      };

      // Cache for 5 minutes
      await app.redis.setex(fullCacheKey, CACHE_TTL.LIBRARY_GROWTH, JSON.stringify(response));

      return response;
    }
  );
};
