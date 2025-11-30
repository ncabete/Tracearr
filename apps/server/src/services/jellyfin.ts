/**
 * Jellyfin API integration service
 */

import type { Server } from '@tracearr/shared';
import { decrypt } from '../utils/crypto.js';

const CLIENT_NAME = 'Tracearr';
const CLIENT_VERSION = '1.0.0';
const DEVICE_ID = 'tracearr-server';
const DEVICE_NAME = 'Tracearr Server';

export interface JellyfinAuthResult {
  id: string;
  username: string;
  token: string;
  serverId: string;
  isAdmin: boolean;
}

export interface JellyfinSession {
  id: string;
  userId: string;
  userName: string;
  userPrimaryImageTag?: string; // User avatar
  client: string;
  deviceName: string;
  deviceId: string;
  deviceType?: string;
  remoteEndPoint: string;
  nowPlayingItem?: {
    id: string; // Jellyfin item ID (equivalent to Plex ratingKey)
    name: string; // Episode title or movie title
    type: string; // Movie, Episode, Audio
    runTimeTicks: number;
    // Episode-specific fields
    seriesName?: string; // Show name (for episodes)
    seasonName?: string; // Season name (e.g., "Season 1")
    seriesId?: string; // Show ID (for episodes)
    parentIndexNumber?: number; // Season number
    indexNumber?: number; // Episode number
    productionYear?: number; // Release year
    // Poster fields - Jellyfin uses ImageTags
    imageTags?: {
      Primary?: string;
    };
    seriesPrimaryImageTag?: string; // Show poster tag (for episodes)
    // Source bitrate for direct play
    mediaSources?: Array<{
      bitrate?: number;
    }>;
  };
  playState?: {
    positionTicks: number;
    isPaused: boolean;
  };
  transcodingInfo?: {
    isVideoDirect: boolean;
    bitrate: number;
  };
}

export interface JellyfinLibrary {
  id: string;
  name: string;
  collectionType: string;
  locations: string[];
}

export interface JellyfinUser {
  id: string;
  name: string;
  hasPassword: boolean;
  isAdministrator: boolean;
  isDisabled: boolean;
  lastLoginDate: string | null;
  lastActivityDate: string | null;
}

/**
 * Played item from watch history
 * Note: Unlike Tautulli, this only returns WHAT was watched, not session details (IP, device, etc.)
 */
export interface JellyfinPlayedItem {
  id: string;
  name: string;
  type: string;
  seriesName?: string;
  parentIndexNumber?: number;
  indexNumber?: number;
  productionYear?: number;
  runTimeTicks: number;
  playCount: number;
  lastPlayedDate: string | null;
}

/**
 * Activity log entry from Jellyfin
 * Useful for detecting login attempts, playback events, etc.
 */
export interface JellyfinActivityEntry {
  id: number;
  name: string;
  overview?: string;
  shortOverview?: string;
  type: string;
  itemId?: string;
  userId?: string;
  date: string;
  severity: string;
}

interface JellyfinAuthResponse {
  User: {
    Id: string;
    Name: string;
    ServerId: string;
    Policy: {
      IsAdministrator: boolean;
    };
  };
  AccessToken: string;
  ServerId: string;
}

export class JellyfinService {
  private baseUrl: string;
  private apiKey: string;

  constructor(server: Server & { token: string }) {
    this.baseUrl = server.url.replace(/\/$/, '');
    this.apiKey = decrypt(server.token);
  }

  private buildAuthHeader(): string {
    return `MediaBrowser Client="${CLIENT_NAME}", Device="${DEVICE_NAME}", DeviceId="${DEVICE_ID}", Version="${CLIENT_VERSION}", Token="${this.apiKey}"`;
  }

  private buildHeaders(): Record<string, string> {
    return {
      'X-Emby-Authorization': this.buildAuthHeader(),
      Accept: 'application/json',
    };
  }

  async getSessions(): Promise<JellyfinSession[]> {
    const response = await fetch(`${this.baseUrl}/Sessions`, {
      headers: this.buildHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Jellyfin sessions request failed: ${response.status}`);
    }

    const sessions = (await response.json()) as Record<string, unknown>[];

    // Filter to sessions with active playback
    return sessions
      .filter((session) => session.NowPlayingItem)
      .map((session) => {
        const nowPlaying = session.NowPlayingItem as Record<string, unknown>;
        const imageTags = nowPlaying?.ImageTags as Record<string, string> | undefined;

        return {
          id: String(session.Id ?? ''),
          userId: String(session.UserId ?? ''),
          userName: String(session.UserName ?? ''),
          userPrimaryImageTag: session.UserPrimaryImageTag ? String(session.UserPrimaryImageTag) : undefined,
          client: String(session.Client ?? ''),
          deviceName: String(session.DeviceName ?? ''),
          deviceId: String(session.DeviceId ?? ''),
          deviceType: session.DeviceType ? String(session.DeviceType) : undefined,
          remoteEndPoint: String(session.RemoteEndPoint ?? ''),
          nowPlayingItem: nowPlaying
            ? {
                id: String(nowPlaying.Id ?? ''),
                name: String(nowPlaying.Name ?? ''),
                type: String(nowPlaying.Type ?? ''),
                runTimeTicks: Number(nowPlaying.RunTimeTicks ?? 0),
                // Episode-specific fields
                seriesName: nowPlaying.SeriesName ? String(nowPlaying.SeriesName) : undefined,
                seasonName: nowPlaying.SeasonName ? String(nowPlaying.SeasonName) : undefined,
                seriesId: nowPlaying.SeriesId ? String(nowPlaying.SeriesId) : undefined,
                parentIndexNumber: nowPlaying.ParentIndexNumber ? Number(nowPlaying.ParentIndexNumber) : undefined,
                indexNumber: nowPlaying.IndexNumber ? Number(nowPlaying.IndexNumber) : undefined,
                productionYear: nowPlaying.ProductionYear ? Number(nowPlaying.ProductionYear) : undefined,
                // Poster fields
                imageTags: imageTags ? { Primary: imageTags.Primary } : undefined,
                seriesPrimaryImageTag: nowPlaying.SeriesPrimaryImageTag ? String(nowPlaying.SeriesPrimaryImageTag) : undefined,
                // Source bitrate for direct play
                mediaSources: Array.isArray(nowPlaying.MediaSources)
                  ? (nowPlaying.MediaSources as Array<Record<string, unknown>>).map(ms => ({
                      bitrate: ms.Bitrate ? Number(ms.Bitrate) : undefined,
                    }))
                  : undefined,
              }
            : undefined,
          playState: session.PlayState
            ? {
                positionTicks: Number(
                  (session.PlayState as Record<string, unknown>).PositionTicks ?? 0
                ),
                isPaused: Boolean(
                  (session.PlayState as Record<string, unknown>).IsPaused ?? false
                ),
              }
            : undefined,
          transcodingInfo: session.TranscodingInfo
            ? {
                isVideoDirect: Boolean(
                  (session.TranscodingInfo as Record<string, unknown>).IsVideoDirect ??
                    true
                ),
                bitrate: Number(
                  (session.TranscodingInfo as Record<string, unknown>).Bitrate ?? 0
                ),
              }
            : undefined,
        };
      });
  }

  async getUsers(): Promise<JellyfinUser[]> {
    const response = await fetch(`${this.baseUrl}/Users`, {
      headers: this.buildHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Jellyfin users request failed: ${response.status}`);
    }

    const users = (await response.json()) as Record<string, unknown>[];

    return users.map((user) => ({
      id: String(user.Id ?? ''),
      name: String(user.Name ?? ''),
      hasPassword: Boolean(user.HasPassword ?? false),
      isAdministrator: Boolean(
        (user.Policy as Record<string, unknown>)?.IsAdministrator ?? false
      ),
      isDisabled: Boolean(
        (user.Policy as Record<string, unknown>)?.IsDisabled ?? false
      ),
      lastLoginDate: user.LastLoginDate ? String(user.LastLoginDate) : null,
      lastActivityDate: user.LastActivityDate ? String(user.LastActivityDate) : null,
    }));
  }

  async getLibraries(): Promise<JellyfinLibrary[]> {
    const response = await fetch(`${this.baseUrl}/Library/VirtualFolders`, {
      headers: this.buildHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Jellyfin libraries request failed: ${response.status}`);
    }

    const folders = (await response.json()) as Record<string, unknown>[];

    return folders.map((folder) => ({
      id: String(folder.ItemId ?? ''),
      name: String(folder.Name ?? ''),
      collectionType: String(folder.CollectionType ?? 'unknown'),
      locations: Array.isArray(folder.Locations)
        ? (folder.Locations as string[])
        : [],
    }));
  }

  /**
   * Get watch history for a specific user
   * Note: Unlike Tautulli, this only returns WHAT was watched, not session details (IP, device, etc.)
   * For full session history, users would need Jellystat or the Playback Reporting plugin.
   */
  async getWatchHistory(userId: string, limit = 500): Promise<JellyfinPlayedItem[]> {
    const params = new URLSearchParams({
      Recursive: 'true',
      IncludeItemTypes: 'Movie,Episode',
      Filters: 'IsPlayed',
      SortBy: 'DatePlayed',
      SortOrder: 'Descending',
      Limit: String(limit),
      Fields: 'MediaSources',
    });

    const response = await fetch(
      `${this.baseUrl}/Users/${userId}/Items?${params}`,
      { headers: this.buildHeaders() }
    );

    if (!response.ok) {
      throw new Error(`Jellyfin watch history failed: ${response.status}`);
    }

    const data = await response.json() as { Items?: Record<string, unknown>[] };
    const items = data.Items ?? [];

    return items.map(item => {
      const userData = item.UserData as Record<string, unknown> | undefined;
      return {
        id: String(item.Id ?? ''),
        name: String(item.Name ?? ''),
        type: String(item.Type ?? ''),
        seriesName: item.SeriesName ? String(item.SeriesName) : undefined,
        parentIndexNumber: item.ParentIndexNumber ? Number(item.ParentIndexNumber) : undefined,
        indexNumber: item.IndexNumber ? Number(item.IndexNumber) : undefined,
        productionYear: item.ProductionYear ? Number(item.ProductionYear) : undefined,
        runTimeTicks: Number(item.RunTimeTicks ?? 0),
        playCount: Number(userData?.PlayCount ?? 0),
        lastPlayedDate: userData?.LastPlayedDate ? String(userData.LastPlayedDate) : null,
      };
    });
  }

  /**
   * Get watch history for all users on the server
   */
  async getAllUsersWatchHistory(limit = 200): Promise<Map<string, JellyfinPlayedItem[]>> {
    const allUsers = await this.getUsers();
    const historyMap = new Map<string, JellyfinPlayedItem[]>();

    for (const user of allUsers) {
      if (user.isDisabled) continue;
      try {
        const history = await this.getWatchHistory(user.id, limit);
        historyMap.set(user.id, history);
      } catch (error) {
        console.error(`Failed to get history for user ${user.name}:`, error);
      }
    }

    return historyMap;
  }

  /**
   * Get activity log entries (requires admin)
   * Useful for detecting login attempts, playback events, etc.
   *
   * Activity types to watch for:
   * - AuthenticationSucceeded - Successful login
   * - AuthenticationFailed - Failed login attempt
   * - SessionStarted - New session
   * - SessionEnded - Session ended
   */
  async getActivityLog(options?: {
    minDate?: Date;
    limit?: number;
    hasUserId?: boolean;
  }): Promise<JellyfinActivityEntry[]> {
    const params = new URLSearchParams();
    if (options?.limit) params.append('limit', String(options.limit));
    if (options?.minDate) params.append('minDate', options.minDate.toISOString());
    if (options?.hasUserId !== undefined) params.append('hasUserId', String(options.hasUserId));

    const response = await fetch(
      `${this.baseUrl}/System/ActivityLog/Entries?${params}`,
      { headers: this.buildHeaders() }
    );

    if (!response.ok) {
      throw new Error(`Jellyfin activity log failed: ${response.status}`);
    }

    const data = await response.json() as { Items?: Record<string, unknown>[] };
    const items = data.Items ?? [];

    return items.map(item => ({
      id: Number(item.Id ?? 0),
      name: String(item.Name ?? ''),
      overview: item.Overview ? String(item.Overview) : undefined,
      shortOverview: item.ShortOverview ? String(item.ShortOverview) : undefined,
      type: String(item.Type ?? ''),
      itemId: item.ItemId ? String(item.ItemId) : undefined,
      userId: item.UserId ? String(item.UserId) : undefined,
      date: String(item.Date ?? ''),
      severity: String(item.Severity ?? 'Information'),
    }));
  }

  static async authenticate(
    serverUrl: string,
    username: string,
    password: string
  ): Promise<JellyfinAuthResult | null> {
    const url = serverUrl.replace(/\/$/, '');
    const authHeader = `MediaBrowser Client="${CLIENT_NAME}", Device="${DEVICE_NAME}", DeviceId="${DEVICE_ID}", Version="${CLIENT_VERSION}"`;

    const response = await fetch(`${url}/Users/AuthenticateByName`, {
      method: 'POST',
      headers: {
        'X-Emby-Authorization': authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        Username: username,
        Pw: password,
      }),
    });

    if (!response.ok) {
      if (response.status === 401) {
        return null; // Invalid credentials
      }
      throw new Error(`Jellyfin authentication failed: ${response.status}`);
    }

    const data = (await response.json()) as JellyfinAuthResponse;

    return {
      id: data.User.Id,
      username: data.User.Name,
      token: data.AccessToken,
      serverId: data.ServerId,
      isAdmin: data.User.Policy.IsAdministrator,
    };
  }

  static async verifyServerAdmin(apiKey: string, serverUrl: string): Promise<boolean> {
    const url = serverUrl.replace(/\/$/, '');
    const authHeader = `MediaBrowser Client="${CLIENT_NAME}", Device="${DEVICE_NAME}", DeviceId="${DEVICE_ID}", Version="${CLIENT_VERSION}", Token="${apiKey}"`;

    const response = await fetch(`${url}/Users/Me`, {
      headers: {
        'X-Emby-Authorization': authHeader,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      return false;
    }

    const user = (await response.json()) as Record<string, unknown>;
    const policy = user.Policy as Record<string, unknown> | undefined;

    return Boolean(policy?.IsAdministrator ?? false);
  }
}
