/**
 * Poller Pure Functions Tests
 *
 * Tests the extracted pure functions from poller.ts that handle:
 * - Trust score penalties
 * - Pause tracking state transitions
 * - Stop duration calculation
 * - Watch completion detection
 * - Session grouping
 * - Rule applicability
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  getTrustScorePenalty,
  calculatePauseAccumulation,
  calculateStopDuration,
  checkWatchCompletion,
  shouldGroupWithPreviousSession,
  formatQualityString,
  doesRuleApplyToUser,
} from '../poller.js';

describe('Trust Score Penalties', () => {
  describe('getTrustScorePenalty', () => {
    it('should return 20 for HIGH severity', () => {
      expect(getTrustScorePenalty('high')).toBe(20);
    });

    it('should return 10 for WARNING severity', () => {
      expect(getTrustScorePenalty('warning')).toBe(10);
    });

    it('should return 5 for LOW severity', () => {
      expect(getTrustScorePenalty('low')).toBe(5);
    });
  });
});

describe('Pause Tracking', () => {
  describe('calculatePauseAccumulation', () => {
    it('should record lastPausedAt when transitioning from playing to paused', () => {
      const now = new Date();
      const result = calculatePauseAccumulation(
        'playing',
        'paused',
        { lastPausedAt: null, pausedDurationMs: 0 },
        now
      );

      expect(result.lastPausedAt).toEqual(now);
      expect(result.pausedDurationMs).toBe(0);
    });

    it('should accumulate pause duration when transitioning from paused to playing', () => {
      const pauseStart = new Date('2024-01-01T10:00:00Z');
      const resumeTime = new Date('2024-01-01T10:30:00Z'); // 30 minutes later

      const result = calculatePauseAccumulation(
        'paused',
        'playing',
        { lastPausedAt: pauseStart, pausedDurationMs: 0 },
        resumeTime
      );

      expect(result.lastPausedAt).toBeNull();
      expect(result.pausedDurationMs).toBe(30 * 60 * 1000); // 30 minutes in ms
    });

    it('should accumulate multiple pause cycles correctly', () => {
      const times = {
        pause1: new Date('2024-01-01T10:05:00Z'),
        resume1: new Date('2024-01-01T10:10:00Z'), // 5 min pause
        pause2: new Date('2024-01-01T10:15:00Z'),
        resume2: new Date('2024-01-01T10:25:00Z'), // 10 min pause
      };

      // First pause
      let session = { lastPausedAt: null as Date | null, pausedDurationMs: 0 };
      session = calculatePauseAccumulation('playing', 'paused', session, times.pause1);
      expect(session.lastPausedAt).toEqual(times.pause1);

      // First resume - 5 min accumulated
      session = calculatePauseAccumulation('paused', 'playing', session, times.resume1);
      expect(session.pausedDurationMs).toBe(5 * 60 * 1000);

      // Second pause
      session = calculatePauseAccumulation('playing', 'paused', session, times.pause2);
      expect(session.lastPausedAt).toEqual(times.pause2);

      // Second resume - 15 min total (5 + 10)
      session = calculatePauseAccumulation('paused', 'playing', session, times.resume2);
      expect(session.pausedDurationMs).toBe(15 * 60 * 1000);
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

      expect(result.lastPausedAt).toEqual(pausedAt);
      expect(result.pausedDurationMs).toBe(5000);
    });
  });

  describe('calculateStopDuration', () => {
    it('should calculate correct duration for session with no pauses', () => {
      const startedAt = new Date('2024-01-01T10:00:00Z');
      const stoppedAt = new Date('2024-01-01T12:00:00Z'); // 2 hours later

      const result = calculateStopDuration(
        { startedAt, lastPausedAt: null, pausedDurationMs: 0 },
        stoppedAt
      );

      expect(result.durationMs).toBe(2 * 60 * 60 * 1000); // 2 hours
      expect(result.finalPausedDurationMs).toBe(0);
    });

    it('should exclude accumulated pause time from duration', () => {
      const startedAt = new Date('2024-01-01T10:00:00Z');
      const stoppedAt = new Date('2024-01-01T12:00:00Z'); // 2 hours elapsed

      const result = calculateStopDuration(
        {
          startedAt,
          lastPausedAt: null,
          pausedDurationMs: 30 * 60 * 1000, // 30 minutes paused
        },
        stoppedAt
      );

      // 2 hours - 30 minutes = 1.5 hours
      expect(result.durationMs).toBe(1.5 * 60 * 60 * 1000);
      expect(result.finalPausedDurationMs).toBe(30 * 60 * 1000);
    });

    it('should include remaining pause time if stopped while paused', () => {
      const startedAt = new Date('2024-01-01T10:00:00Z');
      const pausedAt = new Date('2024-01-01T11:30:00Z');
      const stoppedAt = new Date('2024-01-01T12:00:00Z');

      const result = calculateStopDuration(
        {
          startedAt,
          lastPausedAt: pausedAt, // Currently paused
          pausedDurationMs: 15 * 60 * 1000, // 15 minutes already accumulated
        },
        stoppedAt
      );

      // Total elapsed: 2 hours
      // Paused: 15 min (previous) + 30 min (current) = 45 min
      // Watch time: 2 hours - 45 min = 1.25 hours
      expect(result.finalPausedDurationMs).toBe(45 * 60 * 1000);
      expect(result.durationMs).toBe(1.25 * 60 * 60 * 1000);
    });

    it('should not return negative duration', () => {
      const startedAt = new Date('2024-01-01T10:00:00Z');
      const stoppedAt = new Date('2024-01-01T10:30:00Z'); // 30 minutes

      const result = calculateStopDuration(
        {
          startedAt,
          lastPausedAt: null,
          pausedDurationMs: 60 * 60 * 1000, // 1 hour paused (more than elapsed!)
        },
        stoppedAt
      );

      // Should be capped at 0
      expect(result.durationMs).toBe(0);
    });
  });
});

describe('Watch Completion Detection', () => {
  describe('checkWatchCompletion', () => {
    it('should return true when progress >= 80%', () => {
      expect(checkWatchCompletion(8000, 10000)).toBe(true); // Exactly 80%
      expect(checkWatchCompletion(9000, 10000)).toBe(true); // 90%
      expect(checkWatchCompletion(10000, 10000)).toBe(true); // 100%
    });

    it('should return false when progress < 80%', () => {
      expect(checkWatchCompletion(7999, 10000)).toBe(false); // Just under 80%
      expect(checkWatchCompletion(5000, 10000)).toBe(false); // 50%
      expect(checkWatchCompletion(1000, 10000)).toBe(false); // 10%
    });

    it('should return false when progressMs is null', () => {
      expect(checkWatchCompletion(null, 10000)).toBe(false);
    });

    it('should return false when totalDurationMs is null', () => {
      expect(checkWatchCompletion(8000, null)).toBe(false);
    });

    it('should return false when both are null', () => {
      expect(checkWatchCompletion(null, null)).toBe(false);
    });
  });
});

describe('Session Grouping', () => {
  describe('shouldGroupWithPreviousSession', () => {
    it('should group with previous session when resuming', () => {
      const previousSessionId = randomUUID();
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const result = shouldGroupWithPreviousSession(
        {
          id: previousSessionId,
          referenceId: null,
          progressMs: 30 * 60 * 1000, // 30 minutes
          watched: false,
          stoppedAt: new Date(), // Recent
        },
        30 * 60 * 1000, // Starting from same position
        oneDayAgo
      );

      expect(result).toBe(previousSessionId);
    });

    it('should use existing referenceId if previous session was already grouped', () => {
      const originalSessionId = randomUUID();
      const previousSessionId = randomUUID();
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const result = shouldGroupWithPreviousSession(
        {
          id: previousSessionId,
          referenceId: originalSessionId, // Already linked
          progressMs: 60 * 60 * 1000,
          watched: false,
          stoppedAt: new Date(),
        },
        60 * 60 * 1000,
        oneDayAgo
      );

      expect(result).toBe(originalSessionId);
    });

    it('should not group if previous session was fully watched', () => {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const result = shouldGroupWithPreviousSession(
        {
          id: randomUUID(),
          referenceId: null,
          progressMs: 90 * 60 * 1000,
          watched: true, // Already watched
          stoppedAt: new Date(),
        },
        0, // Starting fresh
        oneDayAgo
      );

      expect(result).toBeNull();
    });

    it('should not group if previous session is older than 24 hours', () => {
      const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const result = shouldGroupWithPreviousSession(
        {
          id: randomUUID(),
          referenceId: null,
          progressMs: 30 * 60 * 1000,
          watched: false,
          stoppedAt: twoDaysAgo, // Too old
        },
        30 * 60 * 1000,
        oneDayAgo
      );

      expect(result).toBeNull();
    });

    it('should not group if new progress is less than previous (rewinding)', () => {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const result = shouldGroupWithPreviousSession(
        {
          id: randomUUID(),
          referenceId: null,
          progressMs: 60 * 60 * 1000, // 1 hour in
          watched: false,
          stoppedAt: new Date(),
        },
        30 * 60 * 1000, // Only 30 minutes - user rewound
        oneDayAgo
      );

      expect(result).toBeNull();
    });
  });
});

describe('Quality String Formatting', () => {
  describe('formatQualityString', () => {
    it('should format bitrate in Mbps when transcoding bitrate available', () => {
      expect(formatQualityString(8000000, 0, false)).toBe('8Mbps');
      expect(formatQualityString(10000000, 0, true)).toBe('10Mbps');
    });

    it('should fall back to source bitrate when transcode bitrate is 0', () => {
      expect(formatQualityString(0, 12000000, false)).toBe('12Mbps');
    });

    it('should return "Transcoding" when no bitrate but is transcoding', () => {
      expect(formatQualityString(0, 0, true)).toBe('Transcoding');
    });

    it('should return "Direct" when no bitrate and not transcoding', () => {
      expect(formatQualityString(0, 0, false)).toBe('Direct');
    });

    it('should round bitrate correctly', () => {
      expect(formatQualityString(8500000, 0, false)).toBe('9Mbps'); // Rounds up
      expect(formatQualityString(8400000, 0, false)).toBe('8Mbps'); // Rounds down
    });
  });
});

describe('Rule Applicability', () => {
  describe('doesRuleApplyToUser', () => {
    it('should apply global rules (userId=null) to any user', () => {
      const globalRule = { userId: null };
      expect(doesRuleApplyToUser(globalRule, randomUUID())).toBe(true);
      expect(doesRuleApplyToUser(globalRule, randomUUID())).toBe(true);
    });

    it('should apply user-specific rule only to that user', () => {
      const targetUserId = randomUUID();
      const otherUserId = randomUUID();
      const userRule = { userId: targetUserId };

      expect(doesRuleApplyToUser(userRule, targetUserId)).toBe(true);
      expect(doesRuleApplyToUser(userRule, otherUserId)).toBe(false);
    });
  });
});

describe('Integration Scenarios', () => {
  it('should handle complete watch session with multiple pauses', () => {
    // Scenario: Watch 2-hour movie with breaks
    const times = {
      start: new Date('2024-01-01T10:00:00Z'),
      pause1: new Date('2024-01-01T10:30:00Z'),
      resume1: new Date('2024-01-01T10:45:00Z'), // 15 min pause
      pause2: new Date('2024-01-01T11:30:00Z'),
      resume2: new Date('2024-01-01T12:00:00Z'), // 30 min pause
      stop: new Date('2024-01-01T12:45:00Z'),
    };

    // Simulate state transitions
    let session = { lastPausedAt: null as Date | null, pausedDurationMs: 0 };

    session = calculatePauseAccumulation('playing', 'paused', session, times.pause1);
    session = calculatePauseAccumulation('paused', 'playing', session, times.resume1);
    session = calculatePauseAccumulation('playing', 'paused', session, times.pause2);
    session = calculatePauseAccumulation('paused', 'playing', session, times.resume2);

    expect(session.pausedDurationMs).toBe(45 * 60 * 1000); // 45 min total

    // Calculate final duration
    const result = calculateStopDuration(
      { startedAt: times.start, ...session },
      times.stop
    );

    // Wall clock: 2h 45m = 165 min
    // Paused: 45 min
    // Watch time: 120 min
    expect(result.durationMs).toBe(120 * 60 * 1000);
  });

  it('should correctly chain session groups', () => {
    const session1Id = randomUUID();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // First resume - links to session1
    const ref1 = shouldGroupWithPreviousSession(
      {
        id: session1Id,
        referenceId: null,
        progressMs: 30 * 60 * 1000,
        watched: false,
        stoppedAt: new Date(),
      },
      30 * 60 * 1000,
      oneDayAgo
    );
    expect(ref1).toBe(session1Id);

    // Second resume - should still link to original session1
    const session2Id = randomUUID();
    const ref2 = shouldGroupWithPreviousSession(
      {
        id: session2Id,
        referenceId: session1Id, // Already linked to session1
        progressMs: 60 * 60 * 1000,
        watched: false,
        stoppedAt: new Date(),
      },
      60 * 60 * 1000,
      oneDayAgo
    );
    expect(ref2).toBe(session1Id); // Still links to original
  });
});
