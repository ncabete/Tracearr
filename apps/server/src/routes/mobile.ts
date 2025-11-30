/**
 * Mobile routes - Mobile app pairing, authentication, and session management
 *
 * Settings endpoints (owner only):
 * - GET /mobile - Get mobile config (token, sessions)
 * - POST /mobile/enable - Enable mobile access, generate token
 * - POST /mobile/disable - Disable mobile access
 * - POST /mobile/rotate - Rotate token (invalidates old)
 * - DELETE /mobile/sessions - Revoke all mobile sessions
 *
 * Auth endpoints (mobile app):
 * - POST /mobile/pair - Exchange mobile token for JWT
 * - POST /mobile/refresh - Refresh mobile JWT
 */

import type { FastifyPluginAsync } from 'fastify';
import { createHash, randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { MobileConfig, MobileSession, MobilePairResponse } from '@tracearr/shared';
import { db } from '../db/client.js';
import { mobileTokens, mobileSessions, servers, users } from '../db/schema.js';

// Token format: trr_mob_<32 random bytes as base64url>
const MOBILE_TOKEN_PREFIX = 'trr_mob_';

// Redis key prefixes for mobile refresh tokens
const MOBILE_REFRESH_PREFIX = 'tracearr:mobile_refresh:';
const MOBILE_REFRESH_TTL = 90 * 24 * 60 * 60; // 90 days

// Mobile JWT expiry (longer than web)
const MOBILE_ACCESS_EXPIRY = '7d';

// Schemas
const mobilePairSchema = z.object({
  token: z.string().min(1),
  deviceName: z.string().min(1).max(100),
  deviceId: z.string().min(1).max(100),
  platform: z.enum(['ios', 'android']),
});

const mobileRefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

/**
 * Generate a new mobile access token
 */
function generateMobileToken(): string {
  const randomPart = randomBytes(32).toString('base64url');
  return `${MOBILE_TOKEN_PREFIX}${randomPart}`;
}

/**
 * Hash a token using SHA-256
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Generate a refresh token
 */
function generateRefreshToken(): string {
  return randomBytes(32).toString('hex');
}

export const mobileRoutes: FastifyPluginAsync = async (app) => {
  // ============================================
  // Settings endpoints (owner only)
  // ============================================

  /**
   * GET /mobile - Get mobile config
   */
  app.get('/', { preHandler: [app.authenticate] }, async (request, reply) => {
    const authUser = request.user;

    if (authUser.role !== 'owner') {
      return reply.forbidden('Only server owners can access mobile settings');
    }

    // Get mobile token
    const tokenRow = await db.select().from(mobileTokens).limit(1);

    // Get mobile sessions
    const sessionsRows = await db.select().from(mobileSessions);

    // Get server name
    const serverRow = await db.select({ name: servers.name }).from(servers).limit(1);
    const serverName = serverRow[0]?.name || 'Tracearr';

    const sessions: MobileSession[] = sessionsRows.map((s) => ({
      id: s.id,
      deviceName: s.deviceName,
      deviceId: s.deviceId,
      platform: s.platform,
      expoPushToken: s.expoPushToken,
      lastSeenAt: s.lastSeenAt,
      createdAt: s.createdAt,
    }));

    const config: MobileConfig = {
      isEnabled: tokenRow.length > 0 && tokenRow[0]!.isEnabled,
      token: null, // Never return the actual token in GET, must enable to see
      serverName,
      sessions,
    };

    return config;
  });

  /**
   * POST /mobile/enable - Enable mobile access and generate/return token
   */
  app.post('/enable', { preHandler: [app.authenticate] }, async (request, reply) => {
    const authUser = request.user;

    if (authUser.role !== 'owner') {
      return reply.forbidden('Only server owners can enable mobile access');
    }

    // Check if token already exists
    const existingToken = await db.select().from(mobileTokens).limit(1);

    let plainToken: string;

    if (existingToken.length > 0 && existingToken[0]!.isEnabled) {
      // Token exists and is enabled - can't retrieve the plain token, must rotate
      return reply.badRequest('Mobile access is already enabled. Use rotate to get a new token.');
    } else if (existingToken.length > 0) {
      // Token exists but disabled - generate new token and enable
      plainToken = generateMobileToken();
      const tokenHash = hashToken(plainToken);

      await db
        .update(mobileTokens)
        .set({
          tokenHash,
          isEnabled: true,
          rotatedAt: new Date(),
        })
        .where(eq(mobileTokens.id, existingToken[0]!.id));
    } else {
      // No token exists - create new
      plainToken = generateMobileToken();
      const tokenHash = hashToken(plainToken);

      await db.insert(mobileTokens).values({
        tokenHash,
        isEnabled: true,
      });
    }

    // Get server name
    const serverRow = await db.select({ name: servers.name }).from(servers).limit(1);
    const serverName = serverRow[0]?.name || 'Tracearr';

    // Get current sessions
    const sessionsRows = await db.select().from(mobileSessions);
    const sessions: MobileSession[] = sessionsRows.map((s) => ({
      id: s.id,
      deviceName: s.deviceName,
      deviceId: s.deviceId,
      platform: s.platform,
      expoPushToken: s.expoPushToken,
      lastSeenAt: s.lastSeenAt,
      createdAt: s.createdAt,
    }));

    const config: MobileConfig = {
      isEnabled: true,
      token: plainToken, // Return the plain token only on enable/rotate
      serverName,
      sessions,
    };

    app.log.info({ userId: authUser.userId }, 'Mobile access enabled');

    return config;
  });

  /**
   * POST /mobile/disable - Disable mobile access
   */
  app.post('/disable', { preHandler: [app.authenticate] }, async (request, reply) => {
    const authUser = request.user;

    if (authUser.role !== 'owner') {
      return reply.forbidden('Only server owners can disable mobile access');
    }

    // Disable token (don't delete, in case they want to re-enable)
    await db.update(mobileTokens).set({ isEnabled: false });

    // Revoke all mobile sessions (delete from DB and Redis)
    const sessionsRows = await db.select().from(mobileSessions);
    for (const session of sessionsRows) {
      await app.redis.del(`${MOBILE_REFRESH_PREFIX}${session.refreshTokenHash}`);
    }
    await db.delete(mobileSessions);

    app.log.info({ userId: authUser.userId }, 'Mobile access disabled');

    return { success: true };
  });

  /**
   * POST /mobile/rotate - Rotate token (invalidates old sessions)
   */
  app.post('/rotate', { preHandler: [app.authenticate] }, async (request, reply) => {
    const authUser = request.user;

    if (authUser.role !== 'owner') {
      return reply.forbidden('Only server owners can rotate mobile token');
    }

    // Check if mobile is enabled
    const existingToken = await db.select().from(mobileTokens).limit(1);
    if (existingToken.length === 0 || !existingToken[0]!.isEnabled) {
      return reply.badRequest('Mobile access is not enabled');
    }

    // Generate new token
    const plainToken = generateMobileToken();
    const tokenHash = hashToken(plainToken);

    await db
      .update(mobileTokens)
      .set({
        tokenHash,
        rotatedAt: new Date(),
      })
      .where(eq(mobileTokens.id, existingToken[0]!.id));

    // Revoke all existing sessions
    const sessionsRows = await db.select().from(mobileSessions);
    for (const session of sessionsRows) {
      await app.redis.del(`${MOBILE_REFRESH_PREFIX}${session.refreshTokenHash}`);
    }
    await db.delete(mobileSessions);

    // Get server name
    const serverRow = await db.select({ name: servers.name }).from(servers).limit(1);
    const serverName = serverRow[0]?.name || 'Tracearr';

    const config: MobileConfig = {
      isEnabled: true,
      token: plainToken, // Return new token
      serverName,
      sessions: [], // All sessions revoked
    };

    app.log.info({ userId: authUser.userId }, 'Mobile token rotated');

    return config;
  });

  /**
   * DELETE /mobile/sessions - Revoke all mobile sessions
   */
  app.delete('/sessions', { preHandler: [app.authenticate] }, async (request, reply) => {
    const authUser = request.user;

    if (authUser.role !== 'owner') {
      return reply.forbidden('Only server owners can revoke mobile sessions');
    }

    // Delete all sessions from Redis and DB
    const sessionsRows = await db.select().from(mobileSessions);
    for (const session of sessionsRows) {
      await app.redis.del(`${MOBILE_REFRESH_PREFIX}${session.refreshTokenHash}`);
    }
    await db.delete(mobileSessions);

    app.log.info({ userId: authUser.userId, count: sessionsRows.length }, 'All mobile sessions revoked');

    return { success: true, revokedCount: sessionsRows.length };
  });

  // ============================================
  // Auth endpoints (mobile app)
  // ============================================

  /**
   * POST /mobile/pair - Exchange mobile token for JWT
   */
  app.post('/pair', async (request, reply) => {
    const body = mobilePairSchema.safeParse(request.body);
    if (!body.success) {
      return reply.badRequest('Invalid pairing request');
    }

    const { token, deviceName, deviceId, platform } = body.data;

    // Verify token starts with correct prefix
    if (!token.startsWith(MOBILE_TOKEN_PREFIX)) {
      return reply.unauthorized('Invalid mobile token');
    }

    // Hash the token and look it up
    const tokenHash = hashToken(token);
    const tokenRow = await db
      .select()
      .from(mobileTokens)
      .where(eq(mobileTokens.tokenHash, tokenHash))
      .limit(1);

    if (tokenRow.length === 0 || !tokenRow[0]!.isEnabled) {
      return reply.unauthorized('Invalid or disabled mobile token');
    }

    // Get the owner user
    const ownerRow = await db
      .select()
      .from(users)
      .where(eq(users.isOwner, true))
      .limit(1);

    if (ownerRow.length === 0) {
      return reply.internalServerError('No owner account found');
    }

    const owner = ownerRow[0]!;

    // Get all server IDs for the JWT
    const allServers = await db.select({ id: servers.id }).from(servers);
    const serverIds = allServers.map((s) => s.id);

    // Get server name and URL for response
    const serverRow = await db.select({ name: servers.name }).from(servers).limit(1);
    const serverName = serverRow[0]?.name || 'Tracearr';

    // Generate access token with mobile-specific expiry
    const accessToken = app.jwt.sign(
      {
        userId: owner.id,
        username: owner.username,
        role: 'owner',
        serverIds,
        mobile: true, // Flag to identify mobile tokens
      },
      { expiresIn: MOBILE_ACCESS_EXPIRY }
    );

    // Generate refresh token
    const refreshToken = generateRefreshToken();
    const refreshTokenHash = hashToken(refreshToken);

    // Check if device already has a session (by deviceId)
    const existingSession = await db
      .select()
      .from(mobileSessions)
      .where(eq(mobileSessions.deviceId, deviceId))
      .limit(1);

    if (existingSession.length > 0) {
      // Update existing session
      const oldHash = existingSession[0]!.refreshTokenHash;
      await app.redis.del(`${MOBILE_REFRESH_PREFIX}${oldHash}`);

      await db
        .update(mobileSessions)
        .set({
          refreshTokenHash,
          deviceName,
          platform,
          lastSeenAt: new Date(),
        })
        .where(eq(mobileSessions.id, existingSession[0]!.id));
    } else {
      // Create new session
      await db.insert(mobileSessions).values({
        refreshTokenHash,
        deviceName,
        deviceId,
        platform,
      });
    }

    // Store refresh token in Redis
    await app.redis.setex(
      `${MOBILE_REFRESH_PREFIX}${refreshTokenHash}`,
      MOBILE_REFRESH_TTL,
      JSON.stringify({ userId: owner.id, deviceId })
    );

    app.log.info({ deviceName, platform, deviceId }, 'Mobile device paired');

    const response: MobilePairResponse = {
      accessToken,
      refreshToken,
      server: {
        name: serverName,
        url: '', // Client already knows the URL since they made the request
      },
      user: {
        userId: owner.id,
        username: owner.username,
        role: 'owner',
      },
    };

    return response;
  });

  /**
   * POST /mobile/refresh - Refresh mobile JWT
   */
  app.post('/refresh', async (request, reply) => {
    const body = mobileRefreshSchema.safeParse(request.body);
    if (!body.success) {
      return reply.badRequest('Invalid refresh request');
    }

    const { refreshToken } = body.data;
    const refreshTokenHash = hashToken(refreshToken);

    // Check Redis for valid refresh token
    const stored = await app.redis.get(`${MOBILE_REFRESH_PREFIX}${refreshTokenHash}`);
    if (!stored) {
      return reply.unauthorized('Invalid or expired refresh token');
    }

    const { userId, deviceId } = JSON.parse(stored) as { userId: string; deviceId: string };

    // Verify user still exists and is owner
    const userRow = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (userRow.length === 0 || !userRow[0]!.isOwner) {
      await app.redis.del(`${MOBILE_REFRESH_PREFIX}${refreshTokenHash}`);
      return reply.unauthorized('User no longer valid');
    }

    const user = userRow[0]!;

    // Verify mobile session still exists
    const sessionRow = await db
      .select()
      .from(mobileSessions)
      .where(eq(mobileSessions.refreshTokenHash, refreshTokenHash))
      .limit(1);

    if (sessionRow.length === 0) {
      await app.redis.del(`${MOBILE_REFRESH_PREFIX}${refreshTokenHash}`);
      return reply.unauthorized('Session has been revoked');
    }

    // Get all server IDs
    const allServers = await db.select({ id: servers.id }).from(servers);
    const serverIds = allServers.map((s) => s.id);

    // Generate new access token
    const accessToken = app.jwt.sign(
      {
        userId: user.id,
        username: user.username,
        role: 'owner',
        serverIds,
        mobile: true,
      },
      { expiresIn: MOBILE_ACCESS_EXPIRY }
    );

    // Rotate refresh token
    const newRefreshToken = generateRefreshToken();
    const newRefreshTokenHash = hashToken(newRefreshToken);

    // Update session with new refresh token
    await db
      .update(mobileSessions)
      .set({
        refreshTokenHash: newRefreshTokenHash,
        lastSeenAt: new Date(),
      })
      .where(eq(mobileSessions.id, sessionRow[0]!.id));

    // Update Redis
    await app.redis.del(`${MOBILE_REFRESH_PREFIX}${refreshTokenHash}`);
    await app.redis.setex(
      `${MOBILE_REFRESH_PREFIX}${newRefreshTokenHash}`,
      MOBILE_REFRESH_TTL,
      JSON.stringify({ userId, deviceId })
    );

    return {
      accessToken,
      refreshToken: newRefreshToken,
    };
  });
};
