/**
 * TDD Tests for Issue #82: excludePrivateIps option for all rule types
 *
 * Tests the excludePrivateIps parameter across all applicable rules:
 * - impossible_travel
 * - simultaneous_locations
 * - concurrent_streams
 * (device_velocity is covered in rules-device-velocity-private-ip.test.ts)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RuleEngine } from '../rules.js';
import { createMockSession, createMockRule } from '../../test/fixtures.js';

/**
 * Helper to create a session with a private IP
 */
function createPrivateIpSession(
  serverUserId: string,
  overrides: Partial<Parameters<typeof createMockSession>[0]> = {}
) {
  return createMockSession({
    serverUserId,
    ipAddress: '192.168.1.100',
    geoCity: null,
    geoRegion: null,
    geoCountry: 'Local Network',
    geoLat: null,
    geoLon: null,
    ...overrides,
  });
}

/**
 * Helper to create a session with a public IP and location
 */
function createPublicIpSession(
  serverUserId: string,
  lat: number,
  lon: number,
  overrides: Partial<Parameters<typeof createMockSession>[0]> = {}
) {
  return createMockSession({
    serverUserId,
    ipAddress: '203.0.113.50',
    geoCity: 'Test City',
    geoRegion: 'Test Region',
    geoCountry: 'US',
    geoLat: lat,
    geoLon: lon,
    ...overrides,
  });
}

describe('RuleEngine - excludePrivateIps option (Issue #82)', () => {
  let ruleEngine: RuleEngine;
  const serverUserId = 'user-123';

  beforeEach(() => {
    ruleEngine = new RuleEngine();
  });

  describe('impossible_travel with excludePrivateIps', () => {
    it('should NOT violate when current session is private IP and excludePrivateIps=true', async () => {
      // Previous session: New York
      const prevSession = createPublicIpSession(serverUserId, 40.7128, -74.006, {
        startedAt: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
        deviceId: 'device-1',
      });

      // Current session: Private IP (would be impossible travel if it had coords)
      const currentSession = createPrivateIpSession(serverUserId, {
        startedAt: new Date(),
        deviceId: 'device-2',
      });

      const rule = createMockRule('impossible_travel', {
        params: { maxSpeedKmh: 500, excludePrivateIps: true },
      });

      const results = await ruleEngine.evaluateSession(currentSession, [rule], [prevSession]);

      // Should NOT violate because current session is from private IP
      expect(results).toHaveLength(0);
    });

    it('should NOT violate when previous session is private IP and excludePrivateIps=true', async () => {
      // Previous session: Private IP
      const prevSession = createPrivateIpSession(serverUserId, {
        startedAt: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
        deviceId: 'device-1',
      });

      // Current session: Los Angeles (far from any previous public session)
      const currentSession = createPublicIpSession(serverUserId, 34.0522, -118.2437, {
        startedAt: new Date(),
        deviceId: 'device-2',
      });

      const rule = createMockRule('impossible_travel', {
        params: { maxSpeedKmh: 500, excludePrivateIps: true },
      });

      const results = await ruleEngine.evaluateSession(currentSession, [rule], [prevSession]);

      // Should NOT violate because previous session (private IP) is filtered out
      expect(results).toHaveLength(0);
    });

    it('should still violate between two public IP sessions with excludePrivateIps=true', async () => {
      // Previous session: New York
      const prevSession = createPublicIpSession(serverUserId, 40.7128, -74.006, {
        ipAddress: '198.51.100.1',
        startedAt: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
        deviceId: 'device-1',
      });

      // Current session: Tokyo (impossible travel from NY in 1 hour)
      const currentSession = createPublicIpSession(serverUserId, 35.6762, 139.6503, {
        ipAddress: '198.51.100.2',
        startedAt: new Date(),
        deviceId: 'device-2',
      });

      const rule = createMockRule('impossible_travel', {
        params: { maxSpeedKmh: 500, excludePrivateIps: true },
      });

      const results = await ruleEngine.evaluateSession(currentSession, [rule], [prevSession]);

      // Should VIOLATE - both sessions are public IPs
      expect(results).toHaveLength(1);
      expect(results[0]!.violated).toBe(true);
    });

    it('should violate with private IPs when excludePrivateIps=false (default)', async () => {
      // This tests backwards compatibility - private IPs with coords should still be evaluated
      // Note: In practice, private IPs have null coords so this wouldn't trigger anyway
      const prevSession = createPublicIpSession(serverUserId, 40.7128, -74.006, {
        startedAt: new Date(Date.now() - 60 * 60 * 1000),
        deviceId: 'device-1',
      });

      const currentSession = createPublicIpSession(serverUserId, 35.6762, 139.6503, {
        startedAt: new Date(),
        deviceId: 'device-2',
      });

      const rule = createMockRule('impossible_travel', {
        params: { maxSpeedKmh: 500, excludePrivateIps: false },
      });

      const results = await ruleEngine.evaluateSession(currentSession, [rule], [prevSession]);

      expect(results).toHaveLength(1);
      expect(results[0]!.violated).toBe(true);
    });
  });

  describe('simultaneous_locations with excludePrivateIps', () => {
    it('should NOT violate when current session is private IP and excludePrivateIps=true', async () => {
      // Active session: New York
      const activeSession = createPublicIpSession(serverUserId, 40.7128, -74.006, {
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-1',
      });

      // Current session: Private IP
      const currentSession = createPrivateIpSession(serverUserId, {
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-2',
      });

      const rule = createMockRule('simultaneous_locations', {
        params: { minDistanceKm: 100, excludePrivateIps: true },
      });

      const results = await ruleEngine.evaluateSession(currentSession, [rule], [activeSession]);

      // Should NOT violate because current session is from private IP
      expect(results).toHaveLength(0);
    });

    it('should NOT violate when active session is private IP and excludePrivateIps=true', async () => {
      // Active session: Private IP
      const activeSession = createPrivateIpSession(serverUserId, {
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-1',
      });

      // Current session: Los Angeles
      const currentSession = createPublicIpSession(serverUserId, 34.0522, -118.2437, {
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-2',
      });

      const rule = createMockRule('simultaneous_locations', {
        params: { minDistanceKm: 100, excludePrivateIps: true },
      });

      const results = await ruleEngine.evaluateSession(currentSession, [rule], [activeSession]);

      // Should NOT violate because active session (private IP) is filtered out
      expect(results).toHaveLength(0);
    });

    it('should still violate between two public IP sessions with excludePrivateIps=true', async () => {
      // Active session: New York
      const activeSession = createPublicIpSession(serverUserId, 40.7128, -74.006, {
        ipAddress: '198.51.100.1',
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-1',
      });

      // Current session: Los Angeles (far from NY)
      const currentSession = createPublicIpSession(serverUserId, 34.0522, -118.2437, {
        ipAddress: '198.51.100.2',
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-2',
      });

      const rule = createMockRule('simultaneous_locations', {
        params: { minDistanceKm: 100, excludePrivateIps: true },
      });

      const results = await ruleEngine.evaluateSession(currentSession, [rule], [activeSession]);

      // Should VIOLATE - both sessions are public IPs at distant locations
      expect(results).toHaveLength(1);
      expect(results[0]!.violated).toBe(true);
    });
  });

  describe('concurrent_streams with excludePrivateIps', () => {
    it('should NOT count private IP session when excludePrivateIps=true', async () => {
      // 2 active sessions from private IPs
      const privateSession1 = createPrivateIpSession(serverUserId, {
        ipAddress: '192.168.1.100',
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-1',
      });
      const privateSession2 = createPrivateIpSession(serverUserId, {
        ipAddress: '192.168.1.101',
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-2',
      });

      // Current session: Also private IP
      const currentSession = createPrivateIpSession(serverUserId, {
        ipAddress: '192.168.1.102',
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-3',
      });

      const rule = createMockRule('concurrent_streams', {
        params: { maxStreams: 2, excludePrivateIps: true },
      });

      const results = await ruleEngine.evaluateSession(
        currentSession,
        [rule],
        [privateSession1, privateSession2]
      );

      // Should NOT violate - all sessions are from private IPs, excluded from count
      expect(results).toHaveLength(0);
    });

    it('should count public IP sessions even when excludePrivateIps=true', async () => {
      // 2 active sessions from public IPs
      const publicSession1 = createPublicIpSession(serverUserId, 40.7128, -74.006, {
        ipAddress: '198.51.100.1',
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-1',
      });
      const publicSession2 = createPublicIpSession(serverUserId, 34.0522, -118.2437, {
        ipAddress: '198.51.100.2',
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-2',
      });

      // Current session: Another public IP
      const currentSession = createPublicIpSession(serverUserId, 51.5074, -0.1278, {
        ipAddress: '198.51.100.3',
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-3',
      });

      const rule = createMockRule('concurrent_streams', {
        params: { maxStreams: 2, excludePrivateIps: true },
      });

      const results = await ruleEngine.evaluateSession(
        currentSession,
        [rule],
        [publicSession1, publicSession2]
      );

      // Should VIOLATE - 3 public IP sessions > max of 2
      expect(results).toHaveLength(1);
      expect(results[0]!.violated).toBe(true);
      expect(results[0]!.data.activeStreamCount).toBe(3);
    });

    it('should count mixed sessions correctly with excludePrivateIps=true', async () => {
      // 1 private + 1 public active session
      const privateSession = createPrivateIpSession(serverUserId, {
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-1',
      });
      const publicSession = createPublicIpSession(serverUserId, 40.7128, -74.006, {
        ipAddress: '198.51.100.1',
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-2',
      });

      // Current session: Public IP
      const currentSession = createPublicIpSession(serverUserId, 34.0522, -118.2437, {
        ipAddress: '198.51.100.2',
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-3',
      });

      const rule = createMockRule('concurrent_streams', {
        params: { maxStreams: 2, excludePrivateIps: true },
      });

      const results = await ruleEngine.evaluateSession(
        currentSession,
        [rule],
        [privateSession, publicSession]
      );

      // Should NOT violate - only 2 public IP sessions (private excluded)
      expect(results).toHaveLength(0);
    });

    it('should count all sessions when excludePrivateIps=false (default)', async () => {
      // 2 private + 1 public active session
      const privateSession1 = createPrivateIpSession(serverUserId, {
        ipAddress: '192.168.1.100',
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-1',
      });
      const privateSession2 = createPrivateIpSession(serverUserId, {
        ipAddress: '192.168.1.101',
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-2',
      });

      // Current session: Private IP
      const currentSession = createPrivateIpSession(serverUserId, {
        ipAddress: '192.168.1.102',
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-3',
      });

      const rule = createMockRule('concurrent_streams', {
        params: { maxStreams: 2, excludePrivateIps: false },
      });

      const results = await ruleEngine.evaluateSession(
        currentSession,
        [rule],
        [privateSession1, privateSession2]
      );

      // Should VIOLATE - 3 sessions > max of 2 (private IPs counted)
      expect(results).toHaveLength(1);
      expect(results[0]!.violated).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle session with private IP but non-null coords (edge case)', async () => {
      // Edge case: Private IP but somehow has coordinates (shouldn't happen normally)
      const edgeCaseSession = createMockSession({
        serverUserId,
        ipAddress: '192.168.1.100',
        geoCity: 'Local',
        geoRegion: 'Local',
        geoCountry: 'Local Network', // This triggers the local network check
        geoLat: 40.7128,
        geoLon: -74.006,
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-1',
      });

      const currentSession = createPublicIpSession(serverUserId, 34.0522, -118.2437, {
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-2',
      });

      const rule = createMockRule('simultaneous_locations', {
        params: { minDistanceKm: 100, excludePrivateIps: true },
      });

      const results = await ruleEngine.evaluateSession(currentSession, [rule], [edgeCaseSession]);

      // Should NOT violate - edge case session is filtered by geoCountry check
      expect(results).toHaveLength(0);
    });

    it('should handle session with public IP that geoip thinks is private', async () => {
      // Edge case: Public-looking IP but geoip identifies as private (e.g., CGNAT)
      const cgnatSession = createMockSession({
        serverUserId,
        ipAddress: '100.64.0.1', // CGNAT range - considered private by geoip
        geoCity: null,
        geoRegion: null,
        geoCountry: 'Local Network',
        geoLat: null,
        geoLon: null,
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-1',
      });

      const currentSession = createPublicIpSession(serverUserId, 34.0522, -118.2437, {
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-2',
      });

      const rule = createMockRule('concurrent_streams', {
        params: { maxStreams: 1, excludePrivateIps: true },
      });

      const results = await ruleEngine.evaluateSession(currentSession, [rule], [cgnatSession]);

      // Should NOT violate - CGNAT session is excluded
      expect(results).toHaveLength(0);
    });
  });
});
