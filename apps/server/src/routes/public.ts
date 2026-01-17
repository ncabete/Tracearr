/**
 * Public API Routes - External access for third-party integrations
 *
 * All routes require Bearer token authentication via Authorization header.
 * Token format: Authorization: Bearer trr_pub_<base64url>
 *
 * Endpoints:
 * - GET /docs - OpenAPI 3.0 specification (JSON)
 * - GET /health - System health and server connectivity
 * - GET /stats - Dashboard overview statistics
 * - GET /streams - Currently active playback sessions
 * - GET /users - User list with activity summary
 * - GET /violations - Violations list with filtering
 * - GET /history - Session history with filtering
 */

import type { FastifyPluginAsync } from 'fastify';
import { eq, desc, sql, and, gte, lte, isNull, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { formatBitrate } from '@tracearr/shared';
import { db } from '../db/client.js';
import { users, serverUsers, servers, sessions, violations, rules } from '../db/schema.js';
import { getCacheService } from '../services/cache.js';
import { generateOpenAPIDocument } from './public.openapi.js';

// Pagination schema for public API
const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});

// Common filter schema
const serverFilterSchema = z.object({
  serverId: z.uuid().optional(),
});

// Streams query schema (extends server filter with summary option)
const streamsQuerySchema = serverFilterSchema.extend({
  summary: z.coerce.boolean().optional(),
});

// Response envelope helper
interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
  };
}

function paginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  pageSize: number
): PaginatedResponse<T> {
  return {
    data,
    meta: { total, page, pageSize },
  };
}

export const publicRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /docs - OpenAPI 3.0 specification
   * No authentication required - allows integrations to discover the API
   */
  app.get('/docs', async (_request, reply) => {
    const spec = generateOpenAPIDocument() as Record<string, unknown>;

    // Fetch actual servers to populate serverId dropdowns
    const allServers = await db
      .select({ id: servers.id, name: servers.name })
      .from(servers)
      .orderBy(servers.displayOrder);

    if (allServers.length > 0) {
      const serverIds = allServers.map((s) => s.id);
      const serverListDescription =
        'Filter to specific server. Available servers:\n' +
        allServers.map((s) => `• **${s.name}**: \`${s.id}\``).join('\n');

      const paths = spec.paths as Record<string, Record<string, unknown>> | undefined;
      if (paths) {
        for (const pathObj of Object.values(paths)) {
          for (const methodObj of Object.values(pathObj)) {
            const method = methodObj as { parameters?: Array<Record<string, unknown>> };
            if (method.parameters) {
              for (const param of method.parameters) {
                if (param.name === 'serverId' && param.in === 'query') {
                  const schema = param.schema as Record<string, unknown> | undefined;
                  if (schema) {
                    schema.enum = serverIds;
                  }
                  // Update description to list available servers
                  param.description = serverListDescription;
                }
              }
            }
          }
        }
      }
    }

    return reply.type('application/json').send(spec);
  });

  /**
   * GET /health - System health and server connectivity
   */
  app.get('/health', { preHandler: [app.authenticatePublicApi] }, async () => {
    // Get all servers
    const allServers = await db
      .select({
        id: servers.id,
        name: servers.name,
        type: servers.type,
      })
      .from(servers)
      .orderBy(servers.displayOrder);

    // Get cached health state and active sessions
    const cacheService = getCacheService();
    const activeSessions = cacheService ? await cacheService.getAllActiveSessions() : [];

    // Build server status using cached health from the poller
    const serverStatus = await Promise.all(
      allServers.map(async (server) => {
        const serverActiveStreams = activeSessions.filter((s) => s.serverId === server.id).length;
        // Use cached health state set by the poller (null = unknown/not yet checked)
        const cachedHealth = cacheService ? await cacheService.getServerHealth(server.id) : null;
        // Consider online if explicitly healthy, or unknown (null) with benefit of doubt
        const online = cachedHealth !== false;

        return {
          id: server.id,
          name: server.name,
          type: server.type,
          online,
          activeStreams: serverActiveStreams,
        };
      })
    );

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      servers: serverStatus,
    };
  });

  /**
   * GET /stats - Dashboard overview statistics
   */
  app.get('/stats', { preHandler: [app.authenticatePublicApi] }, async (request) => {
    const query = serverFilterSchema.safeParse(request.query);
    const serverId = query.success ? query.data.serverId : undefined;

    // Get active streams
    const cacheService = getCacheService();
    let activeSessions = cacheService ? await cacheService.getAllActiveSessions() : [];
    if (serverId) {
      activeSessions = activeSessions.filter((s) => s.serverId === serverId);
    }

    // Get total users
    const serverFilter = serverId ? eq(serverUsers.serverId, serverId) : undefined;
    const [userCountResult] = await db
      .select({ count: sql<number>`count(distinct ${serverUsers.userId})::int` })
      .from(serverUsers)
      .where(serverFilter);

    // Get total sessions (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sessionFilter = serverId
      ? and(eq(sessions.serverId, serverId), gte(sessions.startedAt, thirtyDaysAgo))
      : gte(sessions.startedAt, thirtyDaysAgo);
    const [sessionCountResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sessions)
      .where(sessionFilter);

    // Get recent violations (last 7 days) - join with serverUsers to filter by serverId
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const violationQuery = db
      .select({ count: sql<number>`count(*)::int` })
      .from(violations)
      .innerJoin(serverUsers, eq(violations.serverUserId, serverUsers.id));

    const violationFilter = serverId
      ? and(eq(serverUsers.serverId, serverId), gte(violations.createdAt, sevenDaysAgo))
      : gte(violations.createdAt, sevenDaysAgo);

    const [violationCountResult] = await violationQuery.where(violationFilter);

    return {
      activeStreams: activeSessions.length,
      totalUsers: userCountResult?.count ?? 0,
      totalSessions: sessionCountResult?.count ?? 0,
      recentViolations: violationCountResult?.count ?? 0,
      timestamp: new Date().toISOString(),
    };
  });

  /**
   * GET /streams - Currently active playback sessions
   * Query params:
   *   - serverId: Filter to specific server
   *   - summary: If true, returns only summary stats (omits data array for lighter payload)
   */
  app.get('/streams', { preHandler: [app.authenticatePublicApi] }, async (request) => {
    const query = streamsQuerySchema.safeParse(request.query);
    const serverId = query.success ? query.data.serverId : undefined;
    const summaryOnly = query.success ? query.data.summary : false;

    const cacheService = getCacheService();
    let activeSessions = cacheService ? await cacheService.getAllActiveSessions() : [];

    if (serverId) {
      activeSessions = activeSessions.filter((s) => s.serverId === serverId);
    }

    const streams = summaryOnly
      ? []
      : activeSessions.map((session) => ({
          id: session.id,
          serverId: session.serverId,
          serverName: session.server.name,
          // User info
          username: session.user.identityName ?? session.user.username,
          userThumb: session.user.thumbUrl,
          // Media info
          mediaTitle: session.mediaTitle,
          mediaType: session.mediaType,
          showTitle: session.grandparentTitle,
          seasonNumber: session.seasonNumber,
          episodeNumber: session.episodeNumber,
          year: session.year,
          thumbPath: session.thumbPath,
          durationMs: session.durationMs,
          // Playback state
          state: session.state,
          progressMs: session.progressMs ?? 0,
          startedAt: session.startedAt,
          // Transcode info
          isTranscode: session.isTranscode,
          videoDecision: session.videoDecision,
          audioDecision: session.audioDecision,
          bitrate: session.bitrate,
          // Device info
          device: session.device,
          player: session.playerName,
          product: session.product,
          platform: session.platform,
        }));

    const categorizeStream = (session: (typeof activeSessions)[0]) => {
      // Transcode if either video or audio is being transcoded
      if (session.isTranscode) return 'transcode';
      // Direct stream if either video or audio is 'copy' (container remux)
      if (session.videoDecision === 'copy' || session.audioDecision === 'copy')
        return 'directStream';
      // Otherwise it's direct play
      return 'directPlay';
    };

    let transcodeCount = 0;
    let directStreamCount = 0;
    let directPlayCount = 0;
    let totalBitrate = 0;

    for (const session of activeSessions) {
      const category = categorizeStream(session);
      if (category === 'transcode') transcodeCount++;
      else if (category === 'directStream') directStreamCount++;
      else directPlayCount++;
      if (session.bitrate) totalBitrate += session.bitrate;
    }

    const serverBreakdown: Record<
      string,
      {
        serverId: string;
        serverName: string;
        total: number;
        transcodes: number;
        directStreams: number;
        directPlays: number;
        bitrateKbps: number;
      }
    > = {};

    for (const session of activeSessions) {
      let serverStats = serverBreakdown[session.serverId];
      if (!serverStats) {
        serverStats = {
          serverId: session.serverId,
          serverName: session.server.name,
          total: 0,
          transcodes: 0,
          directStreams: 0,
          directPlays: 0,
          bitrateKbps: 0,
        };
        serverBreakdown[session.serverId] = serverStats;
      }
      const category = categorizeStream(session);
      serverStats.total++;
      if (category === 'transcode') serverStats.transcodes++;
      else if (category === 'directStream') serverStats.directStreams++;
      else serverStats.directPlays++;
      if (session.bitrate) serverStats.bitrateKbps += session.bitrate;
    }

    const summary = {
      total: activeSessions.length,
      transcodes: transcodeCount,
      directStreams: directStreamCount,
      directPlays: directPlayCount,
      totalBitrate: formatBitrate(totalBitrate),
      byServer: Object.values(serverBreakdown).map((s) => ({
        serverId: s.serverId,
        serverName: s.serverName,
        total: s.total,
        transcodes: s.transcodes,
        directStreams: s.directStreams,
        directPlays: s.directPlays,
        totalBitrate: formatBitrate(s.bitrateKbps),
      })),
    };

    // If summary-only mode, omit the data array for a lighter payload
    if (summaryOnly) {
      return { summary };
    }

    return { data: streams, summary };
  });

  /**
   * GET /users - User list with activity summary
   * Returns user-server pairs (a user with accounts on multiple servers appears multiple times)
   */
  app.get('/users', { preHandler: [app.authenticatePublicApi] }, async (request, reply) => {
    const pagination = paginationSchema.safeParse(request.query);
    const filter = serverFilterSchema.safeParse(request.query);

    if (!pagination.success) {
      return reply.badRequest('Invalid pagination parameters');
    }

    const { page, pageSize } = pagination.data;
    const serverId = filter.success ? filter.data.serverId : undefined;
    const offset = (page - 1) * pageSize;

    const whereClause = serverId ? eq(serverUsers.serverId, serverId) : undefined;

    // Get total count - count all user-server pairs (not distinct users) to match pagination
    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .innerJoin(serverUsers, eq(users.id, serverUsers.userId))
      .where(whereClause);

    // Get paginated users with server info joined directly (avoiding N+1)
    const userRows = await db
      .select({
        id: users.id,
        username: users.username,
        name: users.name,
        role: users.role,
        aggregateTrustScore: users.aggregateTrustScore,
        totalViolations: users.totalViolations,
        createdAt: users.createdAt,
        // Server-specific data
        serverId: serverUsers.serverId,
        serverUsername: serverUsers.username,
        lastActivityAt: serverUsers.lastActivityAt,
        sessionCount: serverUsers.sessionCount,
        // Server name joined directly
        serverName: servers.name,
      })
      .from(users)
      .innerJoin(serverUsers, eq(users.id, serverUsers.userId))
      .innerJoin(servers, eq(serverUsers.serverId, servers.id))
      .where(whereClause)
      .orderBy(desc(serverUsers.lastActivityAt))
      .limit(pageSize)
      .offset(offset);

    const userData = userRows.map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.name ?? row.serverUsername ?? row.username,
      role: row.role,
      trustScore: row.aggregateTrustScore,
      totalViolations: row.totalViolations,
      serverId: row.serverId,
      serverName: row.serverName,
      lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
      sessionCount: row.sessionCount,
      createdAt: row.createdAt.toISOString(),
    }));

    return paginatedResponse(userData, countResult?.count ?? 0, page, pageSize);
  });

  /**
   * GET /violations - Violations list with filtering
   */
  app.get('/violations', { preHandler: [app.authenticatePublicApi] }, async (request, reply) => {
    const querySchema = paginationSchema.extend({
      serverId: z.uuid().optional(),
      severity: z.enum(['low', 'warning', 'high']).optional(),
      acknowledged: z.coerce.boolean().optional(),
    });

    const query = querySchema.safeParse(request.query);
    if (!query.success) {
      return reply.badRequest('Invalid query parameters');
    }

    const { page, pageSize, serverId, severity, acknowledged } = query.data;
    const offset = (page - 1) * pageSize;

    // Build where conditions - join with serverUsers to get serverId
    const conditions: ReturnType<typeof eq>[] = [];
    if (serverId) conditions.push(eq(serverUsers.serverId, serverId));
    if (severity) conditions.push(eq(violations.severity, severity));
    if (acknowledged !== undefined) {
      // Use acknowledgedAt timestamp: acknowledged=true means IS NOT NULL, false means IS NULL
      conditions.push(
        acknowledged ? isNotNull(violations.acknowledgedAt) : isNull(violations.acknowledgedAt)
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count with join
    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(violations)
      .innerJoin(serverUsers, eq(violations.serverUserId, serverUsers.id))
      .where(whereClause);

    // Get violations with joins (including servers and users to avoid N+1)
    const violationRows = await db
      .select({
        id: violations.id,
        serverId: serverUsers.serverId,
        serverName: servers.name,
        severity: violations.severity,
        acknowledgedAt: violations.acknowledgedAt,
        data: violations.data,
        createdAt: violations.createdAt,
        // Rule info
        ruleId: rules.id,
        ruleType: rules.type,
        ruleName: rules.name,
        // User info
        userId: serverUsers.userId,
        serverUsername: serverUsers.username,
        userName: users.name,
        userUsername: users.username,
      })
      .from(violations)
      .innerJoin(rules, eq(violations.ruleId, rules.id))
      .innerJoin(serverUsers, eq(violations.serverUserId, serverUsers.id))
      .innerJoin(servers, eq(serverUsers.serverId, servers.id))
      .innerJoin(users, eq(serverUsers.userId, users.id))
      .where(whereClause)
      .orderBy(desc(violations.createdAt))
      .limit(pageSize)
      .offset(offset);

    const violationData = violationRows.map((row) => ({
      id: row.id,
      serverId: row.serverId,
      serverName: row.serverName,
      severity: row.severity,
      acknowledged: row.acknowledgedAt !== null,
      data: row.data,
      createdAt: row.createdAt.toISOString(),
      rule: {
        id: row.ruleId,
        type: row.ruleType,
        name: row.ruleName,
      },
      user: {
        id: row.userId,
        username: row.userName ?? row.serverUsername ?? row.userUsername,
      },
    }));

    return paginatedResponse(violationData, countResult?.count ?? 0, page, pageSize);
  });

  /**
   * GET /history - Session history with filtering
   */
  app.get('/history', { preHandler: [app.authenticatePublicApi] }, async (request, reply) => {
    const querySchema = paginationSchema.extend({
      serverId: z.uuid().optional(),
      state: z.enum(['playing', 'paused', 'stopped']).optional(),
      mediaType: z.enum(['movie', 'episode', 'track', 'live', 'photo', 'unknown']).optional(),
      startDate: z.coerce.date().optional(),
      endDate: z.coerce.date().optional(),
    });

    const query = querySchema.safeParse(request.query);
    if (!query.success) {
      return reply.badRequest('Invalid query parameters');
    }

    const { page, pageSize, serverId, state, mediaType, startDate, endDate } = query.data;
    const offset = (page - 1) * pageSize;

    // Validate date range
    if (startDate && endDate && startDate > endDate) {
      return reply.badRequest('startDate must be before or equal to endDate');
    }

    // Build where conditions
    const conditions: ReturnType<typeof eq>[] = [];
    if (serverId) conditions.push(eq(sessions.serverId, serverId));
    if (state) conditions.push(eq(sessions.state, state));
    if (mediaType) conditions.push(eq(sessions.mediaType, mediaType));
    if (startDate) conditions.push(gte(sessions.startedAt, startDate));
    if (endDate) conditions.push(lte(sessions.startedAt, endDate));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sessions)
      .where(whereClause);

    // Get sessions with server and user info joined directly (avoiding N+1)
    const sessionRows = await db
      .select({
        id: sessions.id,
        serverId: sessions.serverId,
        serverName: servers.name,
        state: sessions.state,
        mediaType: sessions.mediaType,
        mediaTitle: sessions.mediaTitle,
        grandparentTitle: sessions.grandparentTitle,
        seasonNumber: sessions.seasonNumber,
        episodeNumber: sessions.episodeNumber,
        year: sessions.year,
        durationMs: sessions.durationMs,
        progressMs: sessions.progressMs,
        startedAt: sessions.startedAt,
        stoppedAt: sessions.stoppedAt,
        device: sessions.device,
        playerName: sessions.playerName,
        // User info
        userId: serverUsers.userId,
        serverUsername: serverUsers.username,
        userName: users.name,
        userUsername: users.username,
      })
      .from(sessions)
      .innerJoin(serverUsers, eq(sessions.serverUserId, serverUsers.id))
      .innerJoin(servers, eq(sessions.serverId, servers.id))
      .innerJoin(users, eq(serverUsers.userId, users.id))
      .where(whereClause)
      .orderBy(desc(sessions.startedAt))
      .limit(pageSize)
      .offset(offset);

    const sessionData = sessionRows.map((row) => ({
      id: row.id,
      serverId: row.serverId,
      serverName: row.serverName,
      state: row.state,
      mediaType: row.mediaType,
      mediaTitle: row.mediaTitle,
      showTitle: row.grandparentTitle,
      seasonNumber: row.seasonNumber,
      episodeNumber: row.episodeNumber,
      year: row.year,
      durationMs: row.durationMs,
      progressMs: row.progressMs,
      startedAt: row.startedAt.toISOString(),
      stoppedAt: row.stoppedAt?.toISOString() ?? null,
      device: row.device,
      player: row.playerName,
      user: {
        id: row.userId,
        username: row.userName ?? row.serverUsername ?? row.userUsername,
      },
    }));

    return paginatedResponse(sessionData, countResult?.count ?? 0, page, pageSize);
  });
};
