/**
 * Concurrent Streams Hardening Tests
 *
 * TDD tests for Issue #67: False positive violations when watching back-to-back episodes
 *
 * These tests verify fixes for:
 * 1. Stale recentSessions - stopped sessions with state='playing' in snapshot
 * 2. Self-exclusion - triggering session should not count itself
 * 3. Empty string deviceId - should be treated same as null
 * 4. stoppedAt field - sessions with stoppedAt should be excluded even if state='playing'
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RuleEngine } from '../rules.js';
import { createMockSession, createMockRule } from '../../test/fixtures.js';

describe('RuleEngine - Concurrent Streams Hardening (Issue #67)', () => {
  let ruleEngine: RuleEngine;
  const serverUserId = 'user-123';

  beforeEach(() => {
    ruleEngine = new RuleEngine();
  });

  describe('stale recentSessions snapshot bug', () => {
    it('should NOT count stopped sessions even if state is still "playing" in snapshot', async () => {
      // This simulates the stale snapshot bug where a session was stopped in DB
      // but the recentSessions snapshot still has state='playing'
      const staleSession = createMockSession({
        id: 'stale-session-1',
        serverUserId,
        state: 'playing', // Stale state - session was actually stopped
        stoppedAt: new Date(), // But stoppedAt is set - this should take precedence
        deviceId: 'device-1',
      });

      const currentSession = createMockSession({
        id: 'current-session',
        serverUserId,
        state: 'playing',
        deviceId: 'device-2', // Different device
      });

      const rule = createMockRule('concurrent_streams', {
        params: { maxStreams: 1 },
      });

      const results = await ruleEngine.evaluateSession(currentSession, [rule], [staleSession]);

      // Should NOT violate - stale session has stoppedAt set, so it's not active
      // Only current session counts = 1 stream, at limit
      expect(results).toHaveLength(0);
    });

    it('should filter out sessions with stoppedAt before counting concurrent streams', async () => {
      // Multiple stopped sessions in snapshot
      const stoppedSessions = [
        createMockSession({
          id: 'stopped-1',
          serverUserId,
          state: 'playing', // Stale
          stoppedAt: new Date(Date.now() - 60000), // Stopped 1 min ago
          deviceId: 'device-1',
        }),
        createMockSession({
          id: 'stopped-2',
          serverUserId,
          state: 'playing', // Stale
          stoppedAt: new Date(Date.now() - 30000), // Stopped 30 sec ago
          deviceId: 'device-2',
        }),
      ];

      const currentSession = createMockSession({
        id: 'current',
        serverUserId,
        state: 'playing',
        deviceId: 'device-3',
      });

      const rule = createMockRule('concurrent_streams', {
        params: { maxStreams: 2 },
      });

      const results = await ruleEngine.evaluateSession(currentSession, [rule], stoppedSessions);

      // Should NOT violate - both snapshot sessions are stopped
      // Only current session counts = 1 stream, under limit of 2
      expect(results).toHaveLength(0);
    });

    it('should correctly count mix of active and stopped sessions', async () => {
      const mixedSessions = [
        createMockSession({
          id: 'active-1',
          serverUserId,
          state: 'playing',
          stoppedAt: null, // Truly active
          deviceId: 'device-1',
        }),
        createMockSession({
          id: 'stopped-1',
          serverUserId,
          state: 'playing', // Stale state
          stoppedAt: new Date(), // But stopped
          deviceId: 'device-2',
        }),
        createMockSession({
          id: 'active-2',
          serverUserId,
          state: 'playing',
          stoppedAt: null, // Truly active
          deviceId: 'device-3',
        }),
      ];

      const currentSession = createMockSession({
        id: 'current',
        serverUserId,
        state: 'playing',
        deviceId: 'device-4',
      });

      const rule = createMockRule('concurrent_streams', {
        params: { maxStreams: 3 },
      });

      const results = await ruleEngine.evaluateSession(currentSession, [rule], mixedSessions);

      // Should violate: 2 active + 1 current = 3, at limit... wait, that's at limit
      // Let me adjust: maxStreams: 2
      // 2 active + 1 current = 3 > 2 = VIOLATION
      // But stopped session should NOT count

      // Recalculating with maxStreams: 3
      // 2 active from snapshot + 1 current = 3, which is AT limit (not over)
      // So no violation
      expect(results).toHaveLength(0);
    });
  });

  describe('self-exclusion bug', () => {
    it('should NOT count the triggering session if it appears in recentSessions', async () => {
      // This can happen due to race conditions or replication lag
      // The current session might already be visible in the recentSessions query
      const currentSession = createMockSession({
        id: 'current-session',
        serverUserId,
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-1',
      });

      // recentSessions includes the current session (race condition)
      const recentSessions = [
        currentSession, // Self-reference - should be excluded
        createMockSession({
          id: 'other-session',
          serverUserId,
          state: 'playing',
          stoppedAt: null,
          deviceId: 'device-2',
        }),
      ];

      const rule = createMockRule('concurrent_streams', {
        params: { maxStreams: 2 },
      });

      const results = await ruleEngine.evaluateSession(currentSession, [rule], recentSessions);

      // Should NOT violate:
      // - Current session should be excluded from recentSessions by ID
      // - 1 other session + 1 current = 2, at limit
      expect(results).toHaveLength(0);
    });

    it('should correctly count when triggering session ID is in recentSessions', async () => {
      const currentSession = createMockSession({
        id: 'session-abc',
        serverUserId,
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-1',
      });

      // Two other sessions plus the current session in the list
      const recentSessions = [
        createMockSession({
          id: 'session-abc', // Same ID as current - should be excluded
          serverUserId,
          state: 'playing',
          stoppedAt: null,
          deviceId: 'device-1',
        }),
        createMockSession({
          id: 'session-def',
          serverUserId,
          state: 'playing',
          stoppedAt: null,
          deviceId: 'device-2',
        }),
        createMockSession({
          id: 'session-ghi',
          serverUserId,
          state: 'playing',
          stoppedAt: null,
          deviceId: 'device-3',
        }),
      ];

      const rule = createMockRule('concurrent_streams', {
        params: { maxStreams: 2 },
      });

      const results = await ruleEngine.evaluateSession(currentSession, [rule], recentSessions);

      // Should violate:
      // - session-abc excluded (same ID as current)
      // - session-def counts as 1
      // - session-ghi counts as 2
      // - current adds 1 = 3 total
      // 3 > 2 = VIOLATION
      expect(results).toHaveLength(1);
      expect(results[0]!.data.activeStreamCount).toBe(3);
    });
  });

  describe('empty string deviceId handling', () => {
    it('should treat empty string deviceId same as null - no exclusion', async () => {
      const session1 = createMockSession({
        id: 'session-1',
        serverUserId,
        state: 'playing',
        stoppedAt: null,
        deviceId: '', // Empty string
      });

      const currentSession = createMockSession({
        id: 'session-2',
        serverUserId,
        state: 'playing',
        stoppedAt: null,
        deviceId: '', // Also empty string - should NOT be excluded
      });

      const rule = createMockRule('concurrent_streams', {
        params: { maxStreams: 1 },
      });

      const results = await ruleEngine.evaluateSession(currentSession, [rule], [session1]);

      // Should violate: empty string deviceIds cannot be used for exclusion
      // Both sessions count = 2 > 1 = VIOLATION
      expect(results).toHaveLength(1);
      expect(results[0]!.data.activeStreamCount).toBe(2);
    });

    it('should NOT exclude when one session has empty string and other has valid deviceId', async () => {
      const session1 = createMockSession({
        id: 'session-1',
        serverUserId,
        state: 'playing',
        stoppedAt: null,
        deviceId: '', // Empty string
      });

      const currentSession = createMockSession({
        id: 'session-2',
        serverUserId,
        state: 'playing',
        stoppedAt: null,
        deviceId: 'valid-device-id',
      });

      const rule = createMockRule('concurrent_streams', {
        params: { maxStreams: 1 },
      });

      const results = await ruleEngine.evaluateSession(currentSession, [rule], [session1]);

      // Should violate: can't determine if same device when one is empty
      expect(results).toHaveLength(1);
      expect(results[0]!.data.activeStreamCount).toBe(2);
    });
  });

  describe('back-to-back episode scenario (Issue #67 reproduction)', () => {
    it('should NOT violate when user watches consecutive episodes on same device', async () => {
      // Simulates the exact scenario from Issue #67:
      // User is watching Episode 1, then Episode 2 starts (media change)
      // The old session (Episode 1) is stopped but still in recentSessions snapshot

      const deviceId = 'same-device-123';

      // Episode 1 session - just stopped (media change)
      const episode1Session = createMockSession({
        id: 'episode-1-session',
        serverUserId,
        state: 'playing', // Stale - still shows playing in snapshot
        stoppedAt: new Date(), // But it was stopped
        deviceId,
        ratingKey: 'episode-1',
        mediaTitle: 'Episode 1',
      });

      // Episode 2 session - the new session being evaluated
      const episode2Session = createMockSession({
        id: 'episode-2-session',
        serverUserId,
        state: 'playing',
        stoppedAt: null, // Active
        deviceId, // Same device!
        ratingKey: 'episode-2',
        mediaTitle: 'Episode 2',
      });

      const rule = createMockRule('concurrent_streams', {
        params: { maxStreams: 3 },
      });

      const results = await ruleEngine.evaluateSession(episode2Session, [rule], [episode1Session]);

      // Should NOT violate:
      // - Episode 1 has stoppedAt set, should be excluded
      // - Only Episode 2 counts = 1 stream
      // 1 <= 3 = NO VIOLATION
      expect(results).toHaveLength(0);
    });

    it('should NOT violate during rapid episode transitions', async () => {
      const deviceId = 'binge-device';

      // Simulates watching 5 episodes back-to-back
      // All previous episodes are stopped but might appear in stale snapshot
      const staleEpisodeSessions = [1, 2, 3, 4].map((ep) =>
        createMockSession({
          id: `episode-${ep}-session`,
          serverUserId,
          state: 'playing', // All stale
          stoppedAt: new Date(Date.now() - (5 - ep) * 60000), // Stopped at different times
          deviceId, // All same device
          ratingKey: `episode-${ep}`,
          mediaTitle: `Episode ${ep}`,
        })
      );

      // Episode 5 - currently watching
      const currentEpisode = createMockSession({
        id: 'episode-5-session',
        serverUserId,
        state: 'playing',
        stoppedAt: null,
        deviceId,
        ratingKey: 'episode-5',
        mediaTitle: 'Episode 5',
      });

      const rule = createMockRule('concurrent_streams', {
        params: { maxStreams: 3 },
      });

      const results = await ruleEngine.evaluateSession(
        currentEpisode,
        [rule],
        staleEpisodeSessions
      );

      // Should NOT violate:
      // - All 4 previous episodes have stoppedAt set
      // - Only current episode counts = 1 stream
      expect(results).toHaveLength(0);
    });
  });

  describe('simultaneous_locations - same fixes needed', () => {
    it('should NOT count stopped sessions for simultaneous locations', async () => {
      const stoppedSession = createMockSession({
        id: 'stopped-session',
        serverUserId,
        state: 'playing', // Stale
        stoppedAt: new Date(), // But stopped
        deviceId: 'device-1',
        geoLat: 35.6762, // Tokyo
        geoLon: 139.6503,
      });

      const currentSession = createMockSession({
        id: 'current-session',
        serverUserId,
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-2',
        geoLat: 40.7128, // New York
        geoLon: -74.006,
      });

      const rule = createMockRule('simultaneous_locations', {
        params: { minDistanceKm: 100 },
      });

      const results = await ruleEngine.evaluateSession(currentSession, [rule], [stoppedSession]);

      // Should NOT violate - stopped session should be excluded
      expect(results).toHaveLength(0);
    });

    it('should exclude self from simultaneous locations check', async () => {
      const currentSession = createMockSession({
        id: 'session-self',
        serverUserId,
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-1',
        geoLat: 40.7128,
        geoLon: -74.006,
      });

      // recentSessions includes self (race condition)
      const recentSessions = [
        currentSession, // Self
        createMockSession({
          id: 'other-session',
          serverUserId,
          state: 'playing',
          stoppedAt: null,
          deviceId: 'device-2',
          geoLat: 40.7128, // Same location
          geoLon: -74.006,
        }),
      ];

      const rule = createMockRule('simultaneous_locations', {
        params: { minDistanceKm: 100 },
      });

      const results = await ruleEngine.evaluateSession(currentSession, [rule], recentSessions);

      // Should NOT violate - self should be excluded, other is same location
      expect(results).toHaveLength(0);
    });
  });

  describe('impossible_travel - same device exclusion', () => {
    it('should exclude same device from impossible travel check', async () => {
      const deviceId = 'mobile-device-vpn';

      // Previous session - NYC
      const previousSession = createMockSession({
        id: 'session-1',
        serverUserId,
        deviceId,
        geoLat: 40.7128, // NYC
        geoLon: -74.006,
        startedAt: new Date(Date.now() - 30 * 60 * 1000), // 30 min ago
      });

      // Current session - London (VPN switch, same device)
      const currentSession = createMockSession({
        id: 'session-2',
        serverUserId,
        deviceId, // Same device!
        geoLat: 51.5074, // London
        geoLon: -0.1278,
        startedAt: new Date(),
      });

      const rule = createMockRule('impossible_travel', {
        params: { maxSpeedKmh: 500 },
      });

      const results = await ruleEngine.evaluateSession(currentSession, [rule], [previousSession]);

      // Should NOT violate - same device can appear in different locations (VPN, mobile network)
      expect(results).toHaveLength(0);
    });
  });
});
