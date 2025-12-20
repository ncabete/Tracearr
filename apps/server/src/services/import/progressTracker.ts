/**
 * Progress Tracker Module
 *
 * Handles throttled progress publishing for import operations.
 * Prevents flooding WebSocket with updates while maintaining responsiveness.
 *
 * Used by both Tautulli and Jellystat importers.
 */

import type { PubSubService } from '../cache.js';

// Default throttle settings
const DEFAULT_THROTTLE_MS = 2000;
const DEFAULT_THROTTLE_RECORDS = 100;

/**
 * Configuration for progress tracker
 */
export interface ProgressTrackerConfig {
  /** PubSub service for publishing updates */
  pubSubService?: PubSubService;
  /** Channel to publish progress updates to */
  channel: string;
  /** Minimum milliseconds between updates (default: 2000) */
  throttleMs?: number;
  /** Publish every N records regardless of time (default: 100) */
  throttleRecords?: number;
  /** Optional callback for additional progress handling (e.g., BullMQ lock extension) */
  onProgress?: () => Promise<void>;
}

/**
 * Create a progress tracker for an import operation
 *
 * The tracker throttles updates to avoid flooding WebSocket connections
 * while still providing timely feedback to the user.
 */
export function createProgressTracker<TProgress>(config: ProgressTrackerConfig) {
  const throttleMs = config.throttleMs ?? DEFAULT_THROTTLE_MS;
  const throttleRecords = config.throttleRecords ?? DEFAULT_THROTTLE_RECORDS;

  let lastPublishTime = 0;
  let lastPublishCount = 0;

  /**
   * Publish progress to the configured channel
   */
  async function doPublish(progress: TProgress): Promise<void> {
    if (config.pubSubService) {
      try {
        await config.pubSubService.publish(config.channel, progress);
      } catch (err) {
        console.warn(`[ProgressTracker] Failed to publish to ${config.channel}:`, err);
      }
    }

    if (config.onProgress) {
      try {
        await config.onProgress();
      } catch (err) {
        console.warn('[ProgressTracker] onProgress callback failed:', err);
      }
    }
  }

  return {
    /**
     * Publish progress if throttle conditions are met
     *
     * @param progress - The progress object to publish
     * @param processedCount - Current count of processed records (for record-based throttling)
     * @param force - Force publish regardless of throttle (for final updates)
     */
    publish(progress: TProgress, processedCount: number, force?: boolean): void {
      const now = Date.now();
      const timeSinceLastPublish = now - lastPublishTime;
      const recordsSinceLastPublish = processedCount - lastPublishCount;

      const shouldPublish =
        force || timeSinceLastPublish >= throttleMs || recordsSinceLastPublish >= throttleRecords;

      if (shouldPublish) {
        // Fire-and-forget to avoid blocking the import loop
        doPublish(progress).catch(() => {
          // Already logged in doPublish
        });
        lastPublishTime = now;
        lastPublishCount = processedCount;
      }
    },

    /**
     * Force publish progress immediately (for start/end events)
     */
    forcePublish(progress: TProgress): void {
      this.publish(progress, 0, true);
    },

    /**
     * Reset throttle counters (useful for new phases of import)
     */
    reset(): void {
      lastPublishTime = 0;
      lastPublishCount = 0;
    },
  };
}

/**
 * Create a simple progress tracker that publishes synchronously
 * (fire-and-forget, no awaiting)
 *
 * This is the simpler version used by the current importers.
 */
export function createSimpleProgressPublisher<TProgress>(
  pubSubService: PubSubService | undefined,
  channel: string,
  onProgress?: (progress: TProgress) => Promise<void>
) {
  return (progress: TProgress) => {
    if (pubSubService) {
      pubSubService.publish(channel, progress).catch((err: unknown) => {
        console.warn(`[ProgressPublisher] Failed to publish to ${channel}:`, err);
      });
    }
    if (onProgress) {
      onProgress(progress).catch((err: unknown) => {
        console.warn('[ProgressPublisher] onProgress callback failed:', err);
      });
    }
  };
}
