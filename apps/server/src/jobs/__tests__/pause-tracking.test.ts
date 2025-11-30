/**
 * Pause Tracking Tests
 *
 * Tests the pause accumulation, session grouping, watch completion,
 * and accurate duration calculation functionality using the actual
 * exported functions from poller.ts.
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Session } from '@tracearr/shared';

// Import ACTUAL production functions - not local duplicates
import {
  calculatePauseAccumulation,
  calculateStopDuration,
  checkWatchCompletion,
  shouldGroupWithPreviousSession,
} from '../poller.js';

/**
 * Create a mock session with pause tracking fields
 */
function createTestSession(overrides: Partial<Session> = {}): Session {
  const id = overrides.id ?? randomUUID();
  return {
    id,
    serverId: overrides.serverId ?? randomUUID(),
    userId: overrides.userId ?? randomUUID(),
    sessionKey: overrides.sessionKey ?? `session_${Date.now()}`,
    state: overrides.state ?? 'playing',
    mediaType: overrides.mediaType ?? 'movie',
    mediaTitle: overrides.mediaTitle ?? 'Test Movie',
    grandparentTitle: overrides.grandparentTitle ?? null,
    seasonNumber: overrides.seasonNumber ?? null,
    episodeNumber: overrides.episodeNumber ?? null,
    year: overrides.year ?? 2024,
    thumbPath: overrides.thumbPath ?? null,
    ratingKey: overrides.ratingKey ?? 'movie123',
    externalSessionId: overrides.externalSessionId ?? null,
    startedAt: overrides.startedAt ?? new Date(),
    stoppedAt: overrides.stoppedAt ?? null,
    durationMs: overrides.durationMs ?? null,
    totalDurationMs: overrides.totalDurationMs ?? 7200000, // 2 hours
    progressMs: overrides.progressMs ?? 0,
    // Pause tracking fields
    lastPausedAt: overrides.lastPausedAt ?? null,
    pausedDurationMs: overrides.pausedDurationMs ?? 0,
    referenceId: overrides.referenceId ?? null,
    watched: overrides.watched ?? false,
    // Network/device info
    ipAddress: overrides.ipAddress ?? '192.168.1.1',
    geoCity: overrides.geoCity ?? 'New York',
    geoRegion: overrides.geoRegion ?? 'New York',
    geoCountry: overrides.geoCountry ?? 'US',
    geoLat: overrides.geoLat ?? 40.7128,
    geoLon: overrides.geoLon ?? -74.006,
    playerName: overrides.playerName ?? 'Test Player',
    deviceId: overrides.deviceId ?? `device_${id.slice(0, 8)}`,
    product: overrides.product ?? 'Plex Web',
    device: overrides.device ?? 'Chrome',
    platform: overrides.platform ?? 'Windows',
    quality: overrides.quality ?? '1080p',
    isTranscode: overrides.isTranscode ?? false,
    bitrate: overrides.bitrate ?? 10000,
  };
}

describe('Pause Tracking', () => {
  describe('Pause Accumulation Logic', () => {
    it('should record lastPausedAt when transitioning from playing to paused', () => {
      const now = new Date();
      const existingSession = { lastPausedAt: null, pausedDurationMs: 0 };

      const result = calculatePauseAccumulation('playing', 'paused', existingSession, now);

      expect(result.lastPausedAt).toEqual(now);
      expect(result.pausedDurationMs).toBe(0);
    });

    it('should accumulate pause duration when transitioning from paused to playing', () => {
      const pauseStart = new Date('2024-01-01T10:00:00Z');
      const resumeTime = new Date('2024-01-01T10:30:00Z'); // 30 minutes later
      const existingSession = { lastPausedAt: pauseStart, pausedDurationMs: 0 };

      const result = calculatePauseAccumulation('paused', 'playing', existingSession, resumeTime);

      expect(result.lastPausedAt).toBeNull();
      expect(result.pausedDurationMs).toBe(30 * 60 * 1000); // 30 minutes in ms
    });

    it('should accumulate multiple pause cycles correctly', () => {
      // Simulate: play -> pause (5min) -> play -> pause (10min) -> play
      const times = {
        start: new Date('2024-01-01T10:00:00Z'),
        pause1: new Date('2024-01-01T10:05:00Z'),
        resume1: new Date('2024-01-01T10:10:00Z'), // 5 min pause
        pause2: new Date('2024-01-01T10:15:00Z'),
        resume2: new Date('2024-01-01T10:25:00Z'), // 10 min pause
      };

      // First pause
      let session = { lastPausedAt: null as Date | null, pausedDurationMs: 0 };
      session = calculatePauseAccumulation('playing', 'paused', session, times.pause1);
      expect(session.lastPausedAt).toEqual(times.pause1);

      // First resume
      session = calculatePauseAccumulation('paused', 'playing', session, times.resume1);
      expect(session.pausedDurationMs).toBe(5 * 60 * 1000); // 5 minutes

      // Second pause
      session = calculatePauseAccumulation('playing', 'paused', session, times.pause2);
      expect(session.lastPausedAt).toEqual(times.pause2);
      expect(session.pausedDurationMs).toBe(5 * 60 * 1000); // Still 5 minutes (not yet resumed)

      // Second resume
      session = calculatePauseAccumulation('paused', 'playing', session, times.resume2);
      expect(session.pausedDurationMs).toBe(15 * 60 * 1000); // 5 + 10 = 15 minutes
      expect(session.lastPausedAt).toBeNull();
    });

    it('should not change anything for playing to playing transition', () => {
      const now = new Date();
      const existingSession = { lastPausedAt: null, pausedDurationMs: 5000 };

      const result = calculatePauseAccumulation('playing', 'playing', existingSession, now);

      expect(result.lastPausedAt).toBeNull();
      expect(result.pausedDurationMs).toBe(5000);
    });

    it('should not change anything for paused to paused transition', () => {
      const pausedAt = new Date('2024-01-01T10:00:00Z');
      const now = new Date('2024-01-01T10:30:00Z');
      const existingSession = { lastPausedAt: pausedAt, pausedDurationMs: 5000 };

      const result = calculatePauseAccumulation('paused', 'paused', existingSession, now);

      // Should preserve existing state
      expect(result.lastPausedAt).toEqual(pausedAt);
      expect(result.pausedDurationMs).toBe(5000);
    });
  });

  describe('Duration Calculation on Stop', () => {
    it('should calculate correct duration for session with no pauses', () => {
      const startedAt = new Date('2024-01-01T10:00:00Z');
      const stoppedAt = new Date('2024-01-01T12:00:00Z'); // 2 hours later
      const session = { startedAt, lastPausedAt: null, pausedDurationMs: 0 };

      const result = calculateStopDuration(session, stoppedAt);

      expect(result.durationMs).toBe(2 * 60 * 60 * 1000); // 2 hours
      expect(result.finalPausedDurationMs).toBe(0);
    });

    it('should exclude accumulated pause time from duration', () => {
      const startedAt = new Date('2024-01-01T10:00:00Z');
      const stoppedAt = new Date('2024-01-01T12:00:00Z'); // 2 hours elapsed
      const session = {
        startedAt,
        lastPausedAt: null, // Not currently paused
        pausedDurationMs: 30 * 60 * 1000, // 30 minutes paused total
      };

      const result = calculateStopDuration(session, stoppedAt);

      // 2 hours elapsed - 30 minutes paused = 1.5 hours actual watch time
      expect(result.durationMs).toBe(1.5 * 60 * 60 * 1000);
      expect(result.finalPausedDurationMs).toBe(30 * 60 * 1000);
    });

    it('should include remaining pause time if stopped while paused', () => {
      const startedAt = new Date('2024-01-01T10:00:00Z');
      const pausedAt = new Date('2024-01-01T11:30:00Z'); // Paused at 1.5 hours
      const stoppedAt = new Date('2024-01-01T12:00:00Z'); // Stopped 30 min later (while still paused)
      const session = {
        startedAt,
        lastPausedAt: pausedAt, // Currently paused
        pausedDurationMs: 15 * 60 * 1000, // 15 minutes already accumulated
      };

      const result = calculateStopDuration(session, stoppedAt);

      // Total elapsed: 2 hours
      // Paused time: 15 min (previous) + 30 min (current pause) = 45 min
      // Watch time: 2 hours - 45 min = 1.25 hours
      expect(result.finalPausedDurationMs).toBe(45 * 60 * 1000);
      expect(result.durationMs).toBe(1.25 * 60 * 60 * 1000);
    });

    it('should not return negative duration', () => {
      const startedAt = new Date('2024-01-01T10:00:00Z');
      const stoppedAt = new Date('2024-01-01T10:30:00Z'); // 30 minutes elapsed
      const session = {
        startedAt,
        lastPausedAt: null,
        pausedDurationMs: 60 * 60 * 1000, // 1 hour paused (more than elapsed!)
      };

      const result = calculateStopDuration(session, stoppedAt);

      // Should be capped at 0, not negative
      expect(result.durationMs).toBe(0);
    });

    it('should handle real-world scenario: movie with dinner break', () => {
      // User starts watching a 2-hour movie
      // Watches 45 minutes, pauses for 1-hour dinner, watches remaining 75 minutes
      const startedAt = new Date('2024-01-01T18:00:00Z');
      const stoppedAt = new Date('2024-01-01T21:00:00Z'); // 3 hours wall clock time
      const session = {
        startedAt,
        lastPausedAt: null,
        pausedDurationMs: 60 * 60 * 1000, // 1 hour dinner pause
      };

      const result = calculateStopDuration(session, stoppedAt);

      // 3 hours elapsed - 1 hour paused = 2 hours watch time
      expect(result.durationMs).toBe(2 * 60 * 60 * 1000);
    });
  });

  describe('Watch Completion Detection', () => {
    it('should mark as watched when progress >= 80%', () => {
      const totalDurationMs = 7200000; // 2 hours
      const progressMs = 5760000; // 80% (1.6 hours)

      const isWatched = checkWatchCompletion(progressMs, totalDurationMs);

      expect(isWatched).toBe(true);
    });

    it('should not mark as watched when progress < 80%', () => {
      const totalDurationMs = 7200000; // 2 hours
      const progressMs = 5000000; // ~69%

      const isWatched = checkWatchCompletion(progressMs, totalDurationMs);

      expect(isWatched).toBe(false);
    });

    it('should mark as watched when progress > 80%', () => {
      const totalDurationMs = 7200000; // 2 hours
      const progressMs = 7000000; // ~97%

      const isWatched = checkWatchCompletion(progressMs, totalDurationMs);

      expect(isWatched).toBe(true);
    });

    it('should not mark as watched when progressMs is null', () => {
      const isWatched = checkWatchCompletion(null, 7200000);
      expect(isWatched).toBe(false);
    });

    it('should not mark as watched when totalDurationMs is null', () => {
      const isWatched = checkWatchCompletion(5760000, null);
      expect(isWatched).toBe(false);
    });

    it('should handle edge case at exactly 80%', () => {
      const totalDurationMs = 100000;
      const progressMs = 80000; // Exactly 80%

      const isWatched = checkWatchCompletion(progressMs, totalDurationMs);

      expect(isWatched).toBe(true);
    });

    it('should handle edge case just below 80%', () => {
      const totalDurationMs = 100000;
      const progressMs = 79999; // Just under 80%

      const isWatched = checkWatchCompletion(progressMs, totalDurationMs);

      expect(isWatched).toBe(false);
    });
  });

  describe('Session Grouping (referenceId)', () => {
    it('should group with previous session when resuming same content', () => {
      const previousSessionId = randomUUID();
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const previousSession = {
        id: previousSessionId,
        referenceId: null,
        progressMs: 1800000, // 30 minutes
        watched: false,
        stoppedAt: new Date(), // Recent
      };

      const newProgressMs = 1800000; // Starting from same position (resume)

      const referenceId = shouldGroupWithPreviousSession(previousSession, newProgressMs, oneDayAgo);

      expect(referenceId).toBe(previousSessionId);
    });

    it('should use existing referenceId if previous session was already grouped', () => {
      const originalSessionId = randomUUID();
      const previousSessionId = randomUUID();
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const previousSession = {
        id: previousSessionId,
        referenceId: originalSessionId, // Already linked to an earlier session
        progressMs: 3600000, // 1 hour
        watched: false,
        stoppedAt: new Date(),
      };

      const newProgressMs = 3600000; // Resuming

      const referenceId = shouldGroupWithPreviousSession(previousSession, newProgressMs, oneDayAgo);

      // Should link to the ORIGINAL session, not the immediate previous
      expect(referenceId).toBe(originalSessionId);
    });

    it('should not group if previous session was fully watched', () => {
      const previousSession = {
        id: randomUUID(),
        referenceId: null,
        progressMs: 7000000, // Almost finished
        watched: true, // Marked as watched
        stoppedAt: new Date(),
      };

      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const newProgressMs = 0; // Starting fresh

      const referenceId = shouldGroupWithPreviousSession(previousSession, newProgressMs, oneDayAgo);

      expect(referenceId).toBeNull();
    });

    it('should not group if previous session is older than 24 hours', () => {
      const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const previousSession = {
        id: randomUUID(),
        referenceId: null,
        progressMs: 1800000,
        watched: false,
        stoppedAt: twoDaysAgo, // Too old
      };

      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const newProgressMs = 1800000;

      const referenceId = shouldGroupWithPreviousSession(previousSession, newProgressMs, oneDayAgo);

      expect(referenceId).toBeNull();
    });

    it('should not group if new session starts before previous progress (not a resume)', () => {
      const previousSession = {
        id: randomUUID(),
        referenceId: null,
        progressMs: 3600000, // 1 hour in
        watched: false,
        stoppedAt: new Date(),
      };

      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const newProgressMs = 1800000; // Only 30 minutes - user rewound

      const referenceId = shouldGroupWithPreviousSession(previousSession, newProgressMs, oneDayAgo);

      expect(referenceId).toBeNull();
    });

    it('should group if new progress is greater than previous (continued watching)', () => {
      const previousSessionId = randomUUID();
      const previousSession = {
        id: previousSessionId,
        referenceId: null,
        progressMs: 1800000, // 30 minutes
        watched: false,
        stoppedAt: new Date(),
      };

      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const newProgressMs = 2000000; // 33 minutes - slightly ahead

      const referenceId = shouldGroupWithPreviousSession(previousSession, newProgressMs, oneDayAgo);

      expect(referenceId).toBe(previousSessionId);
    });
  });

  describe('Session Type Initialization', () => {
    it('should initialize new session with correct pause tracking fields', () => {
      const session = createTestSession();

      expect(session.lastPausedAt).toBeNull();
      expect(session.pausedDurationMs).toBe(0);
      expect(session.referenceId).toBeNull();
      expect(session.watched).toBe(false);
    });

    it('should set lastPausedAt if session starts in paused state', () => {
      // When a new session is created while already paused
      const now = new Date();
      const session = createTestSession({
        state: 'paused',
        lastPausedAt: now, // Should be set on creation if starting paused
      });

      expect(session.state).toBe('paused');
      expect(session.lastPausedAt).toEqual(now);
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle complete watch session with pauses correctly', () => {
      // Scenario: Watch a 2-hour movie with breaks
      // 10:00 - Start watching
      // 10:30 - Pause (30 min watched)
      // 10:45 - Resume (15 min pause)
      // 11:30 - Pause (45 more min watched, 75 total)
      // 12:00 - Resume (30 min pause)
      // 12:45 - Finish (45 more min watched, 120 total = full movie)

      const times = {
        start: new Date('2024-01-01T10:00:00Z'),
        pause1: new Date('2024-01-01T10:30:00Z'),
        resume1: new Date('2024-01-01T10:45:00Z'),
        pause2: new Date('2024-01-01T11:30:00Z'),
        resume2: new Date('2024-01-01T12:00:00Z'),
        stop: new Date('2024-01-01T12:45:00Z'),
      };

      // Simulate state changes
      let session = { lastPausedAt: null as Date | null, pausedDurationMs: 0 };

      // First pause
      session = calculatePauseAccumulation('playing', 'paused', session, times.pause1);
      // First resume
      session = calculatePauseAccumulation('paused', 'playing', session, times.resume1);
      expect(session.pausedDurationMs).toBe(15 * 60 * 1000); // 15 min

      // Second pause
      session = calculatePauseAccumulation('playing', 'paused', session, times.pause2);
      // Second resume
      session = calculatePauseAccumulation('paused', 'playing', session, times.resume2);
      expect(session.pausedDurationMs).toBe(45 * 60 * 1000); // 15 + 30 = 45 min

      // Calculate final duration
      const finalSession = {
        startedAt: times.start,
        lastPausedAt: session.lastPausedAt,
        pausedDurationMs: session.pausedDurationMs,
      };

      const result = calculateStopDuration(finalSession, times.stop);

      // Wall clock: 2h 45m = 165 min
      // Paused: 45 min
      // Watch time: 120 min = 2 hours (full movie)
      expect(result.durationMs).toBe(120 * 60 * 1000);
      expect(result.finalPausedDurationMs).toBe(45 * 60 * 1000);
    });

    it('should handle session stopped while paused', () => {
      const times = {
        start: new Date('2024-01-01T10:00:00Z'),
        pause: new Date('2024-01-01T10:30:00Z'),
        stop: new Date('2024-01-01T11:00:00Z'), // Never resumed
      };

      let session = { lastPausedAt: null as Date | null, pausedDurationMs: 0 };

      // Pause
      session = calculatePauseAccumulation('playing', 'paused', session, times.pause);

      // Stop while still paused
      const finalSession = {
        startedAt: times.start,
        lastPausedAt: session.lastPausedAt,
        pausedDurationMs: session.pausedDurationMs,
      };

      const result = calculateStopDuration(finalSession, times.stop);

      // Wall clock: 1 hour
      // Paused: 30 min (from pause to stop)
      // Watch time: 30 min
      expect(result.finalPausedDurationMs).toBe(30 * 60 * 1000);
      expect(result.durationMs).toBe(30 * 60 * 1000);
    });

    it('should correctly chain session groups across multiple days', () => {
      const userId = randomUUID();
      const ratingKey = 'movie123';

      // Day 1: Watch 30 minutes
      const session1Id = randomUUID();
      const session1 = createTestSession({
        id: session1Id,
        userId,
        ratingKey,
        progressMs: 30 * 60 * 1000, // 30 minutes
        watched: false,
        stoppedAt: new Date('2024-01-01T22:00:00Z'),
      });

      // Day 2: Resume and watch 30 more minutes (60 min total)
      const oneDayAgo = new Date('2024-01-01T21:00:00Z'); // Cutoff for grouping
      const ref1 = shouldGroupWithPreviousSession(
        {
          id: session1.id,
          referenceId: session1.referenceId,
          progressMs: session1.progressMs,
          watched: session1.watched,
          stoppedAt: session1.stoppedAt,
        },
        30 * 60 * 1000, // Starting where we left off
        oneDayAgo
      );

      expect(ref1).toBe(session1Id); // Links to first session

      // Day 3: Resume and finish
      const session2Id = randomUUID();
      const session2 = createTestSession({
        id: session2Id,
        userId,
        ratingKey,
        referenceId: session1Id, // Linked to session 1
        progressMs: 60 * 60 * 1000, // 60 minutes
        watched: false,
        stoppedAt: new Date('2024-01-02T22:00:00Z'),
      });

      const oneDayAgo2 = new Date('2024-01-02T21:00:00Z');
      const ref2 = shouldGroupWithPreviousSession(
        {
          id: session2.id,
          referenceId: session2.referenceId, // Already has referenceId from session 1
          progressMs: session2.progressMs,
          watched: session2.watched,
          stoppedAt: session2.stoppedAt,
        },
        60 * 60 * 1000,
        oneDayAgo2
      );

      // Should still point to original session1, not session2
      expect(ref2).toBe(session1Id);
    });
  });
});
