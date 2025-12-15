/**
 * Jellystat Backup Import Service
 *
 * Parses Jellystat backup JSON files and imports historical watch data
 * into Tracearr's sessions table.
 *
 * Key features:
 * - File-based import (JSON upload from Jellystat backup)
 * - Optional media enrichment via Jellyfin /Items API
 * - GeoIP lookup for IP addresses
 * - Progress tracking via WebSocket
 */

import { eq } from 'drizzle-orm';
import type {
  JellystatPlaybackActivity,
  JellystatImportProgress,
  JellystatImportResult,
} from '@tracearr/shared';
import { jellystatBackupSchema } from '@tracearr/shared';
import { db } from '../db/client.js';
import { sessions, serverUsers, servers } from '../db/schema.js';
import { refreshAggregates } from '../db/timescale.js';
import { geoipService } from './geoip.js';
import type { PubSubService } from './cache.js';
import { JellyfinClient } from './mediaServer/jellyfin/client.js';
import { EmbyClient } from './mediaServer/emby/client.js';

// Configuration
const BATCH_SIZE = 100; // Records per batch insert
const ENRICHMENT_BATCH_SIZE = 100; // Items per Jellyfin API call
const PROGRESS_THROTTLE_MS = 2000; // WebSocket update interval
const PROGRESS_RECORD_INTERVAL = 100; // Update every N records

// Jellyfin tick conversion (100ns ticks to milliseconds)
const TICKS_TO_MS = 10000;

/**
 * Media enrichment data from Jellyfin/Emby API
 */
interface MediaEnrichment {
  seasonNumber?: number;
  episodeNumber?: number;
  year?: number;
  thumbPath?: string;
}

/**
 * Interface for clients that support getItems (both Jellyfin and Emby)
 */
interface MediaServerClientWithItems {
  getItems(ids: string[]): Promise<{
    Id: string;
    ParentIndexNumber?: number;
    IndexNumber?: number;
    ProductionYear?: number;
    ImageTags?: { Primary?: string };
  }[]>;
}

/**
 * Parse and validate Jellystat backup file
 */
export function parseJellystatBackup(jsonString: string): JellystatPlaybackActivity[] {
  const data = JSON.parse(jsonString);
  const parsed = jellystatBackupSchema.safeParse(data);

  if (!parsed.success) {
    throw new Error(`Invalid Jellystat backup format: ${parsed.error.message}`);
  }

  // Extract playback activity from first array element
  const activities = parsed.data[0]?.jf_playback_activity ?? [];
  return activities;
}

/**
 * Transform Jellystat activity to session insert data
 */
export function transformActivityToSession(
  activity: JellystatPlaybackActivity,
  serverId: string,
  serverUserId: string,
  geo: ReturnType<typeof geoipService.lookup>,
  enrichment?: MediaEnrichment
): typeof sessions.$inferInsert {
  // Parse duration (can be string or number)
  const durationSeconds =
    typeof activity.PlaybackDuration === 'string'
      ? parseInt(activity.PlaybackDuration, 10)
      : activity.PlaybackDuration;
  const durationMs = isNaN(durationSeconds) ? 0 : durationSeconds * 1000;

  // Parse timestamps
  const stoppedAt = new Date(activity.ActivityDateInserted);
  const startedAt = new Date(stoppedAt.getTime() - durationMs);

  // Parse ticks for progress/total duration
  // Use != null to handle 0 correctly (0 is a valid value, not falsy)
  const positionMs =
    activity.PlayState?.PositionTicks != null
      ? Math.floor(activity.PlayState.PositionTicks / TICKS_TO_MS)
      : null;
  const totalDurationMs =
    activity.PlayState?.RuntimeTicks != null
      ? Math.floor(activity.PlayState.RuntimeTicks / TICKS_TO_MS)
      : null;

  // Determine media type (episode if SeriesName exists, else movie)
  const mediaType: 'movie' | 'episode' | 'track' = activity.SeriesName ? 'episode' : 'movie';

  // Determine transcode status (anything not DirectPlay is considered a transcode)
  const isTranscode = activity.PlayMethod !== 'DirectPlay';

  // Bitrate from transcoding info (bps to kbps)
  const bitrate = activity.TranscodingInfo?.Bitrate
    ? Math.floor(activity.TranscodingInfo.Bitrate / 1000)
    : null;

  return {
    serverId,
    serverUserId,
    sessionKey: activity.Id,
    plexSessionId: null, // Not applicable for Jellyfin imports
    ratingKey: activity.NowPlayingItemId,
    externalSessionId: activity.Id,
    referenceId: null, // Not available from Jellystat
    state: 'stopped',
    mediaType,
    mediaTitle: activity.NowPlayingItemName,
    grandparentTitle: activity.SeriesName ?? null,
    seasonNumber: enrichment?.seasonNumber ?? null,
    episodeNumber: enrichment?.episodeNumber ?? null,
    year: enrichment?.year ?? null,
    thumbPath: enrichment?.thumbPath ?? null,
    startedAt,
    lastSeenAt: stoppedAt,
    lastPausedAt: null, // Not available from Jellystat
    stoppedAt,
    durationMs,
    totalDurationMs,
    progressMs: positionMs,
    pausedDurationMs: 0, // Cannot calculate from Jellystat data
    watched: activity.PlayState?.Completed ?? false,
    forceStopped: false, // Historical imports are not force stopped
    shortSession: durationMs < 120000, // Under 2 minutes = short session
    ipAddress: activity.RemoteEndPoint ?? '0.0.0.0',
    geoCity: geo.city,
    geoRegion: geo.region,
    geoCountry: geo.country,
    geoLat: geo.lat,
    geoLon: geo.lon,
    playerName: activity.DeviceName ?? activity.Client ?? 'Unknown',
    device: activity.DeviceName ?? activity.Client ?? null,
    deviceId: activity.DeviceId ?? null,
    product: activity.Client ?? null,
    platform: activity.Client ?? null,
    quality: null, // Not available from Jellystat
    isTranscode,
    bitrate,
  };
}

/**
 * Batch fetch media enrichment data from Jellyfin/Emby
 */
async function fetchMediaEnrichment(
  client: MediaServerClientWithItems,
  mediaIds: string[]
): Promise<Map<string, MediaEnrichment>> {
  const enrichmentMap = new Map<string, MediaEnrichment>();

  if (mediaIds.length === 0) return enrichmentMap;

  try {
    const items = await client.getItems(mediaIds);

    for (const item of items) {
      if (!item.Id) continue;

      const enrichment: MediaEnrichment = {};

      // Season and episode numbers
      if (item.ParentIndexNumber != null) {
        enrichment.seasonNumber = item.ParentIndexNumber;
      }
      if (item.IndexNumber != null) {
        enrichment.episodeNumber = item.IndexNumber;
      }

      // Production year
      if (item.ProductionYear != null) {
        enrichment.year = item.ProductionYear;
      }

      // Thumb path (construct from ImageTags.Primary)
      if (item.ImageTags?.Primary) {
        enrichment.thumbPath = `/Items/${item.Id}/Images/Primary`;
      }

      if (Object.keys(enrichment).length > 0) {
        enrichmentMap.set(item.Id, enrichment);
      }
    }
  } catch (error) {
    // Log but don't fail - enrichment is optional
    console.warn('[Jellystat] Media enrichment batch failed:', error);
  }

  return enrichmentMap;
}

/**
 * Import Jellystat backup into Tracearr
 *
 * @param serverId - Target Tracearr server ID
 * @param backupJson - Raw JSON string from Jellystat backup file
 * @param enrichMedia - Whether to fetch metadata from Jellyfin API
 * @param pubSubService - Optional pub/sub service for progress updates
 */
export async function importJellystatBackup(
  serverId: string,
  backupJson: string,
  enrichMedia: boolean = true,
  pubSubService?: PubSubService
): Promise<JellystatImportResult> {
  // Initialize progress
  const progress: JellystatImportProgress = {
    status: 'idle',
    totalRecords: 0,
    processedRecords: 0,
    importedRecords: 0,
    skippedRecords: 0,
    errorRecords: 0,
    enrichedRecords: 0,
    message: 'Starting import...',
  };

  // Throttled progress publishing
  let lastProgressTime = Date.now();
  const publishProgress = () => {
    if (pubSubService) {
      pubSubService.publish('import:jellystat:progress', progress).catch((err: unknown) => {
        console.warn('[Jellystat] Failed to publish progress:', err);
      });
    }
  };

  publishProgress();

  try {
    // === Phase 1: Parse backup ===
    progress.status = 'parsing';
    progress.message = 'Parsing Jellystat backup file...';
    publishProgress();

    const activities = parseJellystatBackup(backupJson);
    progress.totalRecords = activities.length;
    progress.message = `Parsed ${activities.length} records from backup`;
    publishProgress();

    if (activities.length === 0) {
      progress.status = 'complete';
      progress.message = 'No playback activity records found in backup';
      publishProgress();
      return {
        success: true,
        imported: 0,
        skipped: 0,
        errors: 0,
        enriched: 0,
        message: 'No playback activity records found in backup',
      };
    }

    // === Get server info for enrichment ===
    const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);

    if (!server) {
      throw new Error(`Server not found: ${serverId}`);
    }

    // Validate server type
    if (server.type !== 'jellyfin' && server.type !== 'emby') {
      throw new Error(`Jellystat import only supports Jellyfin/Emby servers, got: ${server.type}`);
    }

    // === Build user mapping ===
    const tracearrUsers = await db
      .select()
      .from(serverUsers)
      .where(eq(serverUsers.serverId, serverId));

    const userMap = new Map<string, string>(); // Jellyfin GUID → Tracearr serverUser ID
    for (const su of tracearrUsers) {
      if (su.externalId) {
        userMap.set(su.externalId, su.id);
      }
    }

    // === Pre-fetch existing sessions for deduplication ===
    console.log('[Jellystat] Pre-fetching existing sessions for deduplication...');
    const existingSessions = await db
      .select({
        id: sessions.id,
        externalSessionId: sessions.externalSessionId,
      })
      .from(sessions)
      .where(eq(sessions.serverId, serverId));

    const existingSessionIds = new Set(
      existingSessions.map((s) => s.externalSessionId).filter((id): id is string => id != null)
    );
    console.log(`[Jellystat] Pre-fetched ${existingSessions.length} existing sessions`);

    // === Phase 2: Optional media enrichment ===
    const enrichmentMap = new Map<string, MediaEnrichment>();

    if (enrichMedia) {
      progress.status = 'enriching';
      progress.message = 'Fetching media metadata from Jellyfin...';
      publishProgress();

      // Get unique media IDs
      const uniqueMediaIds = [...new Set(activities.map((a) => a.NowPlayingItemId))];
      console.log(`[Jellystat] Enriching ${uniqueMediaIds.length} unique media items`);

      // Create Jellyfin/Emby client (both have getItems method)
      // Use JellyfinClient for both since Emby inherits from it and has same API
      const clientConfig = {
        url: server.url,
        token: server.token,
        id: server.id,
        name: server.name,
      };
      const client =
        server.type === 'emby' ? new EmbyClient(clientConfig) : new JellyfinClient(clientConfig);

      // Batch fetch enrichment data
      for (let i = 0; i < uniqueMediaIds.length; i += ENRICHMENT_BATCH_SIZE) {
        const batch = uniqueMediaIds.slice(i, i + ENRICHMENT_BATCH_SIZE);
        const batchEnrichment = await fetchMediaEnrichment(client, batch);

        for (const [id, data] of batchEnrichment) {
          enrichmentMap.set(id, data);
          progress.enrichedRecords++;
        }

        progress.message = `Enriching media: ${Math.min(i + ENRICHMENT_BATCH_SIZE, uniqueMediaIds.length)}/${uniqueMediaIds.length}`;
        publishProgress();
      }

      console.log(`[Jellystat] Enriched ${enrichmentMap.size} media items`);
    }

    // === Phase 3: Process records ===
    progress.status = 'processing';
    progress.message = 'Processing records...';
    publishProgress();

    // GeoIP cache
    const geoCache = new Map<string, ReturnType<typeof geoipService.lookup>>();

    // Batch collections
    const insertBatch: (typeof sessions.$inferInsert)[] = [];

    let imported = 0;
    let skipped = 0;
    let errors = 0;

    // Track skipped users
    const skippedUsers = new Map<string, { username: string | null; count: number }>();

    // Helper to flush insert batch
    const flushBatch = async () => {
      if (insertBatch.length > 0) {
        await db.insert(sessions).values(insertBatch);
        insertBatch.length = 0;
      }
    };

    for (const activity of activities) {
      progress.processedRecords++;

      try {
        // Find server user by Jellyfin GUID
        const serverUserId = userMap.get(activity.UserId);
        if (!serverUserId) {
          // User not found - track for warning
          const existing = skippedUsers.get(activity.UserId);
          if (existing) {
            existing.count++;
          } else {
            skippedUsers.set(activity.UserId, {
              username: activity.UserName ?? null,
              count: 1,
            });
          }
          skipped++;
          progress.skippedRecords++;
          continue;
        }

        // Check for existing session (deduplicate)
        if (existingSessionIds.has(activity.Id)) {
          skipped++;
          progress.skippedRecords++;
          continue;
        }

        // Get GeoIP data (cached)
        const ipAddress = activity.RemoteEndPoint ?? '0.0.0.0';
        let geo = geoCache.get(ipAddress);
        if (!geo) {
          geo = geoipService.lookup(ipAddress);
          geoCache.set(ipAddress, geo);
        }

        // Get enrichment data if available
        const enrichment = enrichmentMap.get(activity.NowPlayingItemId);

        // Transform and add to batch
        const sessionData = transformActivityToSession(
          activity,
          serverId,
          serverUserId,
          geo,
          enrichment
        );
        insertBatch.push(sessionData);

        // Add to existing set to prevent duplicates within same import
        existingSessionIds.add(activity.Id);

        imported++;
        progress.importedRecords++;

        // Flush batch when full
        if (insertBatch.length >= BATCH_SIZE) {
          await flushBatch();
        }
      } catch (error) {
        console.error('[Jellystat] Error processing record:', activity.Id, error);
        errors++;
        progress.errorRecords++;
      }

      // Throttled progress updates
      const now = Date.now();
      if (
        progress.processedRecords % PROGRESS_RECORD_INTERVAL === 0 ||
        now - lastProgressTime > PROGRESS_THROTTLE_MS
      ) {
        progress.message = `Processing: ${progress.processedRecords}/${progress.totalRecords}`;
        publishProgress();
        lastProgressTime = now;
      }
    }

    // Final flush
    await flushBatch();

    // Refresh TimescaleDB aggregates
    progress.message = 'Refreshing aggregates...';
    publishProgress();
    try {
      await refreshAggregates();
    } catch (err) {
      console.warn('[Jellystat] Failed to refresh aggregates after import:', err);
    }

    // Build result message
    let message = `Import complete: ${imported} imported, ${skipped} skipped, ${errors} errors`;
    if (enrichMedia && enrichmentMap.size > 0) {
      message += `, ${enrichmentMap.size} media items enriched`;
    }

    if (skippedUsers.size > 0) {
      const totalSkippedRecords = [...skippedUsers.values()].reduce((sum, u) => sum + u.count, 0);
      message += `. Warning: ${totalSkippedRecords} records skipped - ${skippedUsers.size} users from backup not found in Tracearr. Sync your server first to import their history.`;

      console.warn(
        `[Jellystat] Import skipped users: ${[...skippedUsers.entries()].map(([id, data]) => `${data.username}(${id})`).join(', ')}`
      );
    }

    // Final progress update
    progress.status = 'complete';
    progress.message = message;
    publishProgress();

    return {
      success: true,
      imported,
      skipped,
      errors,
      enriched: enrichmentMap.size,
      message,
      skippedUsers:
        skippedUsers.size > 0
          ? [...skippedUsers.entries()].map(([id, data]) => ({
              jellyfinUserId: id,
              username: data.username,
              recordCount: data.count,
            }))
          : undefined,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Jellystat] Import failed:', error);

    progress.status = 'error';
    progress.message = `Import failed: ${errorMessage}`;
    publishProgress();

    return {
      success: false,
      imported: progress.importedRecords,
      skipped: progress.skippedRecords,
      errors: progress.errorRecords,
      enriched: progress.enrichedRecords,
      message: `Import failed: ${errorMessage}`,
    };
  }
}
