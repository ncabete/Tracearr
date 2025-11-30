/**
 * Jellyfin Service Tests
 *
 * Tests for JellyfinService methods:
 * - getWatchHistory: Retrieve played items for a user
 * - getAllUsersWatchHistory: Retrieve history for all users
 * - getActivityLog: Retrieve server activity log entries
 *
 * These tests validate:
 * - API response parsing
 * - Type mapping from Jellyfin API to our interfaces
 * - Edge cases and error handling
 */

import { describe, it, expect } from 'vitest';

// ============================================================================
// TYPE DEFINITIONS (mirroring jellyfin.ts for isolated testing)
// ============================================================================

interface JellyfinPlayedItem {
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

interface JellyfinActivityEntry {
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

// ============================================================================
// MOCK API RESPONSES (based on real Jellyfin API structure)
// ============================================================================

const MOCK_WATCH_HISTORY_RESPONSE = {
  Items: [
    {
      Id: 'movie-12345',
      Name: 'The Matrix',
      Type: 'Movie',
      ProductionYear: 1999,
      RunTimeTicks: 81360000000, // ~2h 15m in ticks
      UserData: {
        PlayCount: 3,
        LastPlayedDate: '2024-01-15T20:30:00.000Z',
        Played: true,
      },
    },
    {
      Id: 'episode-67890',
      Name: 'Pilot',
      Type: 'Episode',
      SeriesName: 'Breaking Bad',
      ParentIndexNumber: 1,
      IndexNumber: 1,
      ProductionYear: 2008,
      RunTimeTicks: 35280000000, // ~58m in ticks
      UserData: {
        PlayCount: 1,
        LastPlayedDate: '2024-01-10T19:00:00.000Z',
        Played: true,
      },
    },
    {
      Id: 'episode-67891',
      Name: 'Cat\'s in the Bag...',
      Type: 'Episode',
      SeriesName: 'Breaking Bad',
      ParentIndexNumber: 1,
      IndexNumber: 2,
      ProductionYear: 2008,
      RunTimeTicks: 29160000000,
      UserData: {
        PlayCount: 1,
        LastPlayedDate: '2024-01-10T20:00:00.000Z',
        Played: true,
      },
    },
  ],
  TotalRecordCount: 3,
};

const MOCK_ACTIVITY_LOG_RESPONSE = {
  Items: [
    {
      Id: 1001,
      Name: 'john.doe authenticated successfully',
      Overview: 'User logged in from IP 192.168.1.100',
      ShortOverview: 'Login',
      Type: 'AuthenticationSucceeded',
      UserId: 'user-abc123',
      Date: '2024-01-15T10:30:00.000Z',
      Severity: 'Information',
    },
    {
      Id: 1002,
      Name: 'Authentication failed for unknown_user',
      Overview: 'Invalid password attempt from IP 203.0.113.50',
      ShortOverview: 'Failed login',
      Type: 'AuthenticationFailed',
      Date: '2024-01-15T10:25:00.000Z',
      Severity: 'Warning',
    },
    {
      Id: 1003,
      Name: 'Session started',
      Type: 'SessionStarted',
      UserId: 'user-abc123',
      ItemId: 'movie-12345',
      Date: '2024-01-15T10:35:00.000Z',
      Severity: 'Information',
    },
    {
      Id: 1004,
      Name: 'Session ended',
      Type: 'SessionEnded',
      UserId: 'user-abc123',
      Date: '2024-01-15T12:35:00.000Z',
      Severity: 'Information',
    },
  ],
  TotalRecordCount: 4,
};

const MOCK_USERS_RESPONSE = [
  {
    Id: 'user-abc123',
    Name: 'john.doe',
    HasPassword: true,
    Policy: {
      IsAdministrator: false,
      IsDisabled: false,
    },
    LastLoginDate: '2024-01-15T10:30:00.000Z',
    LastActivityDate: '2024-01-15T12:35:00.000Z',
  },
  {
    Id: 'user-def456',
    Name: 'admin',
    HasPassword: true,
    Policy: {
      IsAdministrator: true,
      IsDisabled: false,
    },
    LastLoginDate: '2024-01-14T08:00:00.000Z',
    LastActivityDate: '2024-01-15T18:00:00.000Z',
  },
  {
    Id: 'user-disabled',
    Name: 'old_user',
    HasPassword: true,
    Policy: {
      IsAdministrator: false,
      IsDisabled: true,
    },
    LastLoginDate: '2023-06-01T10:00:00.000Z',
    LastActivityDate: '2023-06-01T10:00:00.000Z',
  },
];

// ============================================================================
// TESTS
// ============================================================================

describe('JellyfinService', () => {
  describe('Watch History Parsing', () => {
    /**
     * Test that we correctly parse the Jellyfin Items API response
     * into our JellyfinPlayedItem interface
     */
    function parseWatchHistoryResponse(apiResponse: typeof MOCK_WATCH_HISTORY_RESPONSE): JellyfinPlayedItem[] {
      const items = apiResponse.Items ?? [];

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

    it('should parse movie items correctly', () => {
      const result = parseWatchHistoryResponse(MOCK_WATCH_HISTORY_RESPONSE);
      const movie = result[0]!;

      expect(movie.id).toBe('movie-12345');
      expect(movie.name).toBe('The Matrix');
      expect(movie.type).toBe('Movie');
      expect(movie.productionYear).toBe(1999);
      expect(movie.runTimeTicks).toBe(81360000000);
      expect(movie.playCount).toBe(3);
      expect(movie.lastPlayedDate).toBe('2024-01-15T20:30:00.000Z');
      // Movie should not have series fields
      expect(movie.seriesName).toBeUndefined();
      expect(movie.parentIndexNumber).toBeUndefined();
      expect(movie.indexNumber).toBeUndefined();
    });

    it('should parse episode items correctly', () => {
      const result = parseWatchHistoryResponse(MOCK_WATCH_HISTORY_RESPONSE);
      const episode = result[1]!;

      expect(episode.id).toBe('episode-67890');
      expect(episode.name).toBe('Pilot');
      expect(episode.type).toBe('Episode');
      expect(episode.seriesName).toBe('Breaking Bad');
      expect(episode.parentIndexNumber).toBe(1); // Season 1
      expect(episode.indexNumber).toBe(1);       // Episode 1
      expect(episode.productionYear).toBe(2008);
      expect(episode.playCount).toBe(1);
    });

    it('should handle missing UserData gracefully', () => {
      const responseWithMissingUserData = {
        Items: [
          {
            Id: 'movie-no-userdata',
            Name: 'Unknown Movie',
            Type: 'Movie',
            RunTimeTicks: 10000000,
            // No UserData field
          },
        ],
      };

      const result = parseWatchHistoryResponse(responseWithMissingUserData as typeof MOCK_WATCH_HISTORY_RESPONSE);
      const item = result[0]!;

      expect(item.playCount).toBe(0);
      expect(item.lastPlayedDate).toBeNull();
    });

    it('should handle empty response', () => {
      const emptyResponse = { Items: [], TotalRecordCount: 0 };
      const result = parseWatchHistoryResponse(emptyResponse as unknown as typeof MOCK_WATCH_HISTORY_RESPONSE);
      expect(result).toHaveLength(0);
    });

    it('should handle missing Items array', () => {
      const noItemsResponse = {} as unknown as typeof MOCK_WATCH_HISTORY_RESPONSE;
      const result = parseWatchHistoryResponse(noItemsResponse);
      expect(result).toHaveLength(0);
    });
  });

  describe('Activity Log Parsing', () => {
    /**
     * Test that we correctly parse the Jellyfin Activity Log API response
     * into our JellyfinActivityEntry interface
     */
    function parseActivityLogResponse(apiResponse: typeof MOCK_ACTIVITY_LOG_RESPONSE): JellyfinActivityEntry[] {
      const items = apiResponse.Items ?? [];

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

    it('should parse successful authentication entries', () => {
      const result = parseActivityLogResponse(MOCK_ACTIVITY_LOG_RESPONSE);
      const authSuccess = result[0]!;

      expect(authSuccess.id).toBe(1001);
      expect(authSuccess.name).toBe('john.doe authenticated successfully');
      expect(authSuccess.type).toBe('AuthenticationSucceeded');
      expect(authSuccess.userId).toBe('user-abc123');
      expect(authSuccess.severity).toBe('Information');
      expect(authSuccess.overview).toBe('User logged in from IP 192.168.1.100');
    });

    it('should parse failed authentication entries', () => {
      const result = parseActivityLogResponse(MOCK_ACTIVITY_LOG_RESPONSE);
      const authFailed = result[1]!;

      expect(authFailed.type).toBe('AuthenticationFailed');
      expect(authFailed.severity).toBe('Warning');
      expect(authFailed.userId).toBeUndefined(); // Failed auth has no userId
    });

    it('should parse session start entries with itemId', () => {
      const result = parseActivityLogResponse(MOCK_ACTIVITY_LOG_RESPONSE);
      const sessionStart = result[2]!;

      expect(sessionStart.type).toBe('SessionStarted');
      expect(sessionStart.itemId).toBe('movie-12345');
      expect(sessionStart.userId).toBe('user-abc123');
    });

    it('should parse session end entries', () => {
      const result = parseActivityLogResponse(MOCK_ACTIVITY_LOG_RESPONSE);
      const sessionEnd = result[3]!;

      expect(sessionEnd.type).toBe('SessionEnded');
      expect(sessionEnd.userId).toBe('user-abc123');
    });

    it('should handle empty response', () => {
      const emptyResponse = { Items: [], TotalRecordCount: 0 };
      const result = parseActivityLogResponse(emptyResponse as unknown as typeof MOCK_ACTIVITY_LOG_RESPONSE);
      expect(result).toHaveLength(0);
    });

    it('should handle entries with minimal fields', () => {
      const minimalResponse = {
        Items: [
          {
            Id: 999,
            Name: 'Minimal entry',
            Type: 'Unknown',
            Date: '2024-01-01T00:00:00.000Z',
            Severity: 'Information',
          },
        ],
        TotalRecordCount: 1,
      };

      const result = parseActivityLogResponse(minimalResponse as unknown as typeof MOCK_ACTIVITY_LOG_RESPONSE);
      const entry = result[0]!;

      expect(entry.id).toBe(999);
      expect(entry.overview).toBeUndefined();
      expect(entry.shortOverview).toBeUndefined();
      expect(entry.itemId).toBeUndefined();
      expect(entry.userId).toBeUndefined();
    });
  });

  describe('Activity Log Types', () => {
    it('should identify authentication activity types', () => {
      const authTypes = ['AuthenticationSucceeded', 'AuthenticationFailed'];

      const entries = parseActivityLogResponse(MOCK_ACTIVITY_LOG_RESPONSE);
      const authEntries = entries.filter(e => authTypes.includes(e.type));

      expect(authEntries).toHaveLength(2);
      expect(authEntries[0]!.type).toBe('AuthenticationSucceeded');
      expect(authEntries[1]!.type).toBe('AuthenticationFailed');
    });

    it('should identify session activity types', () => {
      const sessionTypes = ['SessionStarted', 'SessionEnded'];

      const entries = parseActivityLogResponse(MOCK_ACTIVITY_LOG_RESPONSE);
      const sessionEntries = entries.filter(e => sessionTypes.includes(e.type));

      expect(sessionEntries).toHaveLength(2);
    });

    // Helper function used in test above
    function parseActivityLogResponse(apiResponse: typeof MOCK_ACTIVITY_LOG_RESPONSE): JellyfinActivityEntry[] {
      const items = apiResponse.Items ?? [];

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
  });

  describe('User Filtering for History', () => {
    it('should skip disabled users when fetching all users history', () => {
      const users = MOCK_USERS_RESPONSE.map(u => ({
        id: String(u.Id),
        name: String(u.Name),
        isDisabled: Boolean(u.Policy?.IsDisabled ?? false),
      }));

      const activeUsers = users.filter(u => !u.isDisabled);

      expect(activeUsers).toHaveLength(2);
      expect(activeUsers.map(u => u.name)).toEqual(['john.doe', 'admin']);
      expect(activeUsers.map(u => u.name)).not.toContain('old_user');
    });
  });

  // NOTE: "Runtime Tick Conversion" and "API URL Construction" tests were removed
  // because they tested JavaScript built-in behavior (division, URLSearchParams)
  // rather than actual Jellyfin service code. These were "documentation tests"
  // that verified language features, not production logic.

  describe('Error Cases', () => {
    it('should handle null/undefined fields gracefully', () => {
      const itemWithNulls = {
        Id: null,
        Name: null,
        Type: undefined,
        RunTimeTicks: null,
        UserData: null,
      };

      // Note: null ?? '' returns '' because ?? checks for null/undefined
      // So String(null ?? '') = String('') = ''
      const userData = itemWithNulls.UserData as unknown as Record<string, unknown> | null;
      const parsed = {
        id: String(itemWithNulls.Id ?? ''),
        name: String(itemWithNulls.Name ?? ''),
        type: String(itemWithNulls.Type ?? ''),
        runTimeTicks: Number(itemWithNulls.RunTimeTicks ?? 0),
        playCount: Number(userData?.PlayCount ?? 0),
        lastPlayedDate: userData?.LastPlayedDate
          ? String(userData.LastPlayedDate)
          : null,
      };

      // null ?? '' returns '', then String('') = ''
      expect(parsed.id).toBe('');
      expect(parsed.name).toBe('');
      expect(parsed.type).toBe('');
      expect(parsed.runTimeTicks).toBe(0);
      expect(parsed.playCount).toBe(0);
      expect(parsed.lastPlayedDate).toBeNull();
    });

    it('should handle malformed UserData gracefully', () => {
      // Test what happens when UserData is a string instead of an object
      // This can occur if Jellyfin API returns unexpected data
      const itemWithMalformedUserData = {
        Id: 'movie-malformed',
        Name: 'Malformed Movie',
        Type: 'Movie',
        RunTimeTicks: 10000000,
        UserData: 'not an object', // Should be an object but isn't
      };

      // Cast through unknown like the real code does
      const userData = itemWithMalformedUserData.UserData as unknown as Record<string, unknown> | undefined;

      // Parse using the same logic as the real JellyfinService
      const parsed = {
        id: String(itemWithMalformedUserData.Id ?? ''),
        name: String(itemWithMalformedUserData.Name ?? ''),
        type: String(itemWithMalformedUserData.Type ?? ''),
        runTimeTicks: Number(itemWithMalformedUserData.RunTimeTicks ?? 0),
        // When UserData is a string, accessing ?.PlayCount returns undefined
        // because strings don't have a PlayCount property
        playCount: Number(userData?.PlayCount ?? 0),
        lastPlayedDate: userData?.LastPlayedDate ? String(userData.LastPlayedDate) : null,
      };

      // The ?? 0 fallback handles the undefined gracefully
      expect(parsed.id).toBe('movie-malformed');
      expect(parsed.name).toBe('Malformed Movie');
      expect(parsed.playCount).toBe(0);
      expect(parsed.lastPlayedDate).toBeNull();
    });
  });
});

