/**
 * User Mapping Module
 *
 * Creates a mapping from external user IDs (Plex user_id, Jellyfin GUID)
 * to Tracearr server user IDs.
 *
 * Used by both Tautulli and Jellystat importers.
 */

import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { serverUsers } from '../../db/schema.js';

/**
 * Create a mapping from external user IDs to Tracearr server user IDs
 *
 * @param serverId - The server ID to get users for
 * @returns Map where key is externalId (as string) and value is serverUser.id
 */
export async function createUserMapping(serverId: string): Promise<Map<string, string>> {
  const tracearrUsers = await db
    .select()
    .from(serverUsers)
    .where(eq(serverUsers.serverId, serverId));

  const userMap = new Map<string, string>();
  for (const serverUser of tracearrUsers) {
    if (serverUser.externalId) {
      userMap.set(serverUser.externalId, serverUser.id);
    }
  }

  return userMap;
}

/**
 * Look up a Tracearr server user ID from an external ID
 *
 * Handles both string and number external IDs by normalizing to string.
 *
 * @param userMap - The user mapping from createUserMapping
 * @param externalId - The external user ID (Plex number or Jellyfin GUID)
 * @returns The Tracearr server user ID, or null if not found
 */
export function lookupUser(
  userMap: Map<string, string>,
  externalId: string | number
): string | null {
  return userMap.get(String(externalId)) ?? null;
}

/**
 * Tracking for skipped users during import
 */
export interface SkippedUser {
  externalId: string;
  username: string | null;
  count: number;
}

/**
 * Create a tracker for users that couldn't be mapped during import
 */
export function createSkippedUserTracker() {
  const skippedUsers = new Map<string, { username: string | null; count: number }>();

  return {
    /**
     * Track a skipped user
     */
    track(externalId: string | number, username: string | null): void {
      const key = String(externalId);
      const existing = skippedUsers.get(key);
      if (existing) {
        existing.count++;
      } else {
        skippedUsers.set(key, { username, count: 1 });
      }
    },

    /**
     * Get count of unique skipped users
     */
    get size(): number {
      return skippedUsers.size;
    },

    /**
     * Get all skipped users
     */
    getAll(): SkippedUser[] {
      return [...skippedUsers.entries()].map(([externalId, data]) => ({
        externalId,
        username: data.username,
        count: data.count,
      }));
    },

    /**
     * Get top N skipped users by count
     */
    getTop(n: number): SkippedUser[] {
      return this.getAll()
        .sort((a, b) => b.count - a.count)
        .slice(0, n);
    },

    /**
     * Format a warning message about skipped users
     */
    formatWarning(): string | null {
      if (skippedUsers.size === 0) return null;

      const top5 = this.getTop(5)
        .map((u) => `${u.username ?? 'Unknown'} (${u.count} records)`)
        .join(', ');

      const moreUsers = skippedUsers.size > 5 ? ` and ${skippedUsers.size - 5} more` : '';

      return `${skippedUsers.size} users not found in Tracearr: ${top5}${moreUsers}. Sync your server first to import their history.`;
    },
  };
}
