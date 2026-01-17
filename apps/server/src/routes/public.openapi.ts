/**
 * OpenAPI Schema Definitions for Public API
 *
 * Uses @asteasolutions/zod-to-openapi to generate OpenAPI 3.0 documentation.
 * Single source of truth for both validation and documentation.
 */

import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// Extend Zod with OpenAPI support (must be called before defining schemas)
extendZodWithOpenApi(z);

// Create registry for public API
export const registry = new OpenAPIRegistry();

// ============================================================================
// Security Scheme
// ============================================================================

registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  description:
    'API key in format: trr_pub_<token>. Generate from Settings > General in the Tracearr UI.',
});

// ============================================================================
// Reusable Schemas
// ============================================================================

const ServerIdParam = z.uuid().openapi({
  description: 'UUID of a media server',
  example: '550e8400-e29b-41d4-a716-446655440000',
});

const PaginationMeta = z
  .object({
    total: z.number().int().openapi({ description: 'Total number of items', example: 42 }),
    page: z.number().int().openapi({ description: 'Current page number', example: 1 }),
    pageSize: z.number().int().openapi({ description: 'Items per page', example: 25 }),
  })
  .openapi('PaginationMeta');

// ============================================================================
// GET /health
// ============================================================================

const ServerStatus = z
  .object({
    id: z.uuid(),
    name: z.string().openapi({ example: 'Main Plex Server' }),
    type: z.enum(['plex', 'jellyfin', 'emby']),
    online: z.boolean(),
    activeStreams: z.number().int().openapi({ example: 3 }),
  })
  .openapi('ServerStatus');

const HealthResponse = z
  .object({
    status: z.literal('ok'),
    timestamp: z.iso.datetime().openapi({ example: '2024-01-15T12:00:00.000Z' }),
    servers: z.array(ServerStatus),
  })
  .openapi('HealthResponse');

registry.registerPath({
  method: 'get',
  path: '/api/v1/public/health',
  tags: ['Public API'],
  summary: 'System health and server connectivity',
  description: 'Returns system health status and connection state of all configured media servers.',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Health status retrieved successfully',
      content: { 'application/json': { schema: HealthResponse } },
    },
    401: { description: 'Invalid or missing API key' },
  },
});

// ============================================================================
// GET /stats
// ============================================================================

const StatsQuery = z.object({
  serverId: ServerIdParam.optional().openapi({ description: 'Filter to specific server' }),
});

const StatsResponse = z
  .object({
    activeStreams: z
      .number()
      .int()
      .openapi({ description: 'Currently active playback sessions', example: 5 }),
    totalUsers: z.number().int().openapi({ description: 'Total unique users', example: 24 }),
    totalSessions: z
      .number()
      .int()
      .openapi({ description: 'Sessions in last 30 days', example: 1847 }),
    recentViolations: z
      .number()
      .int()
      .openapi({ description: 'Violations in last 7 days', example: 3 }),
    timestamp: z.iso.datetime(),
  })
  .openapi('StatsResponse');

registry.registerPath({
  method: 'get',
  path: '/api/v1/public/stats',
  tags: ['Public API'],
  summary: 'Dashboard overview statistics',
  description: 'Returns aggregate statistics. Optionally filter by server.',
  security: [{ bearerAuth: [] }],
  request: { query: StatsQuery },
  responses: {
    200: {
      description: 'Statistics retrieved successfully',
      content: { 'application/json': { schema: StatsResponse } },
    },
    401: { description: 'Invalid or missing API key' },
  },
});

// ============================================================================
// GET /streams
// ============================================================================

const StreamsQuery = z.object({
  serverId: ServerIdParam.optional().openapi({ description: 'Filter to specific server' }),
  summary: z.coerce.boolean().optional().openapi({
    description:
      'If true, returns only summary statistics (omits data array). Useful for lightweight dashboard polling.',
    example: false,
  }),
});

const Stream = z
  .object({
    id: z.uuid(),
    serverId: z.uuid(),
    serverName: z.string().openapi({ example: 'Main Plex Server' }),
    // User info
    username: z.string().openapi({ example: 'John Doe' }),
    userThumb: z
      .string()
      .nullable()
      .openapi({ description: 'User avatar URL', example: 'https://plex.tv/users/abc123/avatar' }),
    // Media info
    mediaTitle: z.string().openapi({ example: 'Inception' }),
    mediaType: z.enum(['movie', 'episode', 'track', 'live', 'photo', 'unknown']),
    showTitle: z
      .string()
      .nullable()
      .openapi({ description: 'Show name for episodes', example: 'Breaking Bad' }),
    seasonNumber: z.number().int().nullable().openapi({ example: 5 }),
    episodeNumber: z.number().int().nullable().openapi({ example: 16 }),
    year: z.number().int().nullable().openapi({ example: 2010 }),
    thumbPath: z
      .string()
      .nullable()
      .openapi({ description: 'Media thumbnail path', example: '/library/metadata/12345/thumb' }),
    durationMs: z
      .number()
      .int()
      .nullable()
      .openapi({ description: 'Total duration in milliseconds', example: 8880000 }),
    // Playback state
    state: z.enum(['playing', 'paused', 'stopped']),
    progressMs: z
      .number()
      .int()
      .openapi({ description: 'Playback position in milliseconds', example: 3600000 }),
    startedAt: z.iso.datetime(),
    // Transcode info
    isTranscode: z
      .boolean()
      .nullable()
      .openapi({ description: 'Whether stream is being transcoded', example: false }),
    videoDecision: z
      .string()
      .nullable()
      .openapi({ description: 'Video transcode decision', example: 'directplay' }),
    audioDecision: z
      .string()
      .nullable()
      .openapi({ description: 'Audio transcode decision', example: 'transcode' }),
    bitrate: z
      .number()
      .int()
      .nullable()
      .openapi({ description: 'Stream bitrate in kbps', example: 20000 }),
    // Device info
    device: z.string().nullable().openapi({ example: 'Apple TV' }),
    player: z
      .string()
      .nullable()
      .openapi({ description: 'Player/client name', example: 'Plex for Apple TV' }),
    product: z
      .string()
      .nullable()
      .openapi({ description: 'Client product name', example: 'Plex for Apple TV' }),
    platform: z.string().nullable().openapi({ description: 'Platform/OS', example: 'tvOS' }),
  })
  .openapi('Stream');

const ServerStreamSummary = z
  .object({
    serverId: z.uuid(),
    serverName: z.string().openapi({ example: 'Main Plex Server' }),
    total: z.number().int().openapi({ example: 3 }),
    transcodes: z
      .number()
      .int()
      .openapi({ description: 'Streams with video/audio transcoding', example: 1 }),
    directStreams: z
      .number()
      .int()
      .openapi({ description: 'Streams with container remuxing only', example: 1 }),
    directPlays: z
      .number()
      .int()
      .openapi({ description: 'Streams playing native format', example: 1 }),
    totalBitrate: z
      .string()
      .openapi({ description: 'Total bandwidth for this server', example: '22.5 Mbps' }),
  })
  .openapi('ServerStreamSummary');

const StreamsSummary = z
  .object({
    total: z.number().int().openapi({ description: 'Total active streams', example: 5 }),
    transcodes: z
      .number()
      .int()
      .openapi({ description: 'Streams with video/audio transcoding', example: 2 }),
    directStreams: z
      .number()
      .int()
      .openapi({ description: 'Streams with container remuxing only', example: 1 }),
    directPlays: z
      .number()
      .int()
      .openapi({ description: 'Streams playing native format', example: 2 }),
    totalBitrate: z
      .string()
      .openapi({ description: 'Total bandwidth of all streams', example: '45.2 Mbps' }),
    byServer: z.array(ServerStreamSummary).openapi({ description: 'Breakdown by server' }),
  })
  .openapi('StreamsSummary');

const StreamsResponse = z
  .object({
    data: z
      .array(Stream)
      .openapi({ description: 'Array of active streams (omitted when summary=true)' }),
    summary: StreamsSummary,
  })
  .openapi('StreamsResponse');

const StreamsSummaryOnlyResponse = z
  .object({
    summary: StreamsSummary,
  })
  .openapi('StreamsSummaryOnlyResponse');

registry.registerPath({
  method: 'get',
  path: '/api/v1/public/streams',
  tags: ['Public API'],
  summary: 'Currently active playback sessions',
  description: `Returns all active streams with aggregated statistics.

**Response modes:**
- Default: Returns \`{ data: [...], summary: {...} }\`
- With \`summary=true\`: Returns \`{ summary: {...} }\` only (lighter payload for dashboards)

**Summary includes:**
- Total stream counts and transcode breakdown
- Per-server statistics with bandwidth
- Formatted bitrate strings (e.g., "45.2 Mbps")`,
  security: [{ bearerAuth: [] }],
  request: { query: StreamsQuery },
  responses: {
    200: {
      description: 'Active streams retrieved successfully',
      content: {
        'application/json': {
          schema: z.union([StreamsResponse, StreamsSummaryOnlyResponse]),
        },
      },
    },
    401: { description: 'Invalid or missing API key' },
  },
});

// ============================================================================
// GET /users
// ============================================================================

const UsersQuery = z.object({
  page: z.coerce.number().int().positive().default(1).openapi({ example: 1 }),
  pageSize: z.coerce.number().int().positive().max(100).default(25).openapi({ example: 25 }),
  serverId: ServerIdParam.optional().openapi({ description: 'Filter to specific server' }),
});

const User = z
  .object({
    id: z.uuid(),
    username: z.string().openapi({ example: 'john_doe' }),
    displayName: z.string().openapi({ example: 'John Doe' }),
    role: z.enum(['owner', 'admin', 'viewer', 'member', 'disabled', 'pending']),
    trustScore: z.number().int().openapi({ description: '0-100 trust score', example: 95 }),
    totalViolations: z.number().int().openapi({ example: 2 }),
    serverId: z.uuid(),
    serverName: z.string(),
    lastActivityAt: z.iso.datetime().nullable(),
    sessionCount: z.number().int().openapi({ example: 147 }),
    createdAt: z.iso.datetime(),
  })
  .openapi('User');

const UsersResponse = z
  .object({
    data: z.array(User),
    meta: PaginationMeta,
  })
  .openapi('UsersResponse');

registry.registerPath({
  method: 'get',
  path: '/api/v1/public/users',
  tags: ['Public API'],
  summary: 'User list with activity summary',
  description:
    'Returns paginated list of users with activity metrics. Optionally filter by server.',
  security: [{ bearerAuth: [] }],
  request: { query: UsersQuery },
  responses: {
    200: {
      description: 'Users retrieved successfully',
      content: { 'application/json': { schema: UsersResponse } },
    },
    401: { description: 'Invalid or missing API key' },
  },
});

// ============================================================================
// GET /violations
// ============================================================================

const ViolationsQuery = z.object({
  page: z.coerce.number().int().positive().default(1).openapi({ example: 1 }),
  pageSize: z.coerce.number().int().positive().max(100).default(25).openapi({ example: 25 }),
  serverId: ServerIdParam.optional().openapi({ description: 'Filter to specific server' }),
  severity: z
    .enum(['low', 'warning', 'high'])
    .optional()
    .openapi({ description: 'Filter by severity' }),
  acknowledged: z.coerce
    .boolean()
    .optional()
    .openapi({ description: 'Filter by acknowledged status' }),
});

const Violation = z
  .object({
    id: z.uuid(),
    serverId: z.uuid(),
    serverName: z.string(),
    severity: z.enum(['low', 'warning', 'high']),
    acknowledged: z.boolean(),
    data: z.record(z.string(), z.unknown()).openapi({ description: 'Violation-specific data' }),
    createdAt: z.iso.datetime(),
    rule: z.object({
      id: z.uuid(),
      type: z.string().openapi({ example: 'concurrent_streams' }),
      name: z.string().openapi({ example: 'Max 2 concurrent streams' }),
    }),
    user: z.object({
      id: z.uuid(),
      username: z.string(),
    }),
  })
  .openapi('Violation');

const ViolationsResponse = z
  .object({
    data: z.array(Violation),
    meta: PaginationMeta,
  })
  .openapi('ViolationsResponse');

registry.registerPath({
  method: 'get',
  path: '/api/v1/public/violations',
  tags: ['Public API'],
  summary: 'Violations list with filtering',
  description:
    'Returns paginated rule violations. Filter by server, severity, or acknowledged status.',
  security: [{ bearerAuth: [] }],
  request: { query: ViolationsQuery },
  responses: {
    200: {
      description: 'Violations retrieved successfully',
      content: { 'application/json': { schema: ViolationsResponse } },
    },
    401: { description: 'Invalid or missing API key' },
  },
});

// ============================================================================
// GET /history
// ============================================================================

const HistoryQuery = z.object({
  page: z.coerce.number().int().positive().default(1).openapi({ example: 1 }),
  pageSize: z.coerce.number().int().positive().max(100).default(25).openapi({ example: 25 }),
  serverId: ServerIdParam.optional().openapi({ description: 'Filter to specific server' }),
  state: z
    .enum(['playing', 'paused', 'stopped'])
    .optional()
    .openapi({ description: 'Filter by playback state' }),
  mediaType: z
    .enum(['movie', 'episode', 'track', 'live', 'photo', 'unknown'])
    .optional()
    .openapi({ description: 'Filter by media type' }),
  startDate: z.coerce
    .date()
    .optional()
    .openapi({ description: 'Filter sessions after this date (ISO 8601)' }),
  endDate: z.coerce
    .date()
    .optional()
    .openapi({ description: 'Filter sessions before this date (ISO 8601)' }),
});

const SessionHistory = z
  .object({
    id: z.uuid(),
    serverId: z.uuid(),
    serverName: z.string(),
    state: z.enum(['playing', 'paused', 'stopped']),
    mediaType: z.enum(['movie', 'episode', 'track', 'live', 'photo', 'unknown']),
    mediaTitle: z.string().openapi({ example: 'Inception' }),
    showTitle: z
      .string()
      .nullable()
      .openapi({ description: 'Show name for episodes', example: 'Breaking Bad' }),
    seasonNumber: z.number().int().nullable().openapi({ example: 5 }),
    episodeNumber: z.number().int().nullable().openapi({ example: 16 }),
    year: z.number().int().nullable().openapi({ example: 2010 }),
    durationMs: z.number().int().nullable().openapi({ description: 'Watch duration in ms' }),
    progressMs: z.number().int().nullable().openapi({ description: 'Playback position in ms' }),
    startedAt: z.iso.datetime(),
    stoppedAt: z.iso.datetime().nullable(),
    device: z.string().nullable(),
    player: z.string().nullable(),
    user: z.object({
      id: z.uuid(),
      username: z.string(),
    }),
  })
  .openapi('SessionHistory');

const HistoryResponse = z
  .object({
    data: z.array(SessionHistory),
    meta: PaginationMeta,
  })
  .openapi('HistoryResponse');

registry.registerPath({
  method: 'get',
  path: '/api/v1/public/history',
  tags: ['Public API'],
  summary: 'Session history with filtering',
  description:
    'Returns paginated session history. Filter by server, state, media type, or date range.',
  security: [{ bearerAuth: [] }],
  request: { query: HistoryQuery },
  responses: {
    200: {
      description: 'History retrieved successfully',
      content: { 'application/json': { schema: HistoryResponse } },
    },
    401: { description: 'Invalid or missing API key' },
  },
});

// ============================================================================
// Document Generator
// ============================================================================

export function generateOpenAPIDocument(): unknown {
  const generator = new OpenApiGeneratorV3(registry.definitions);

  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      title: 'Tracearr API',
      version: '1.0.0',
      description: `
External API for third-party integrations (Homarr, Home Assistant, etc.).

## Authentication

All endpoints require Bearer token authentication:

\`\`\`
Authorization: Bearer trr_pub_<your_token>
\`\`\`

Generate your API key in **Settings > General** within the Tracearr UI.

## Pagination

Paginated endpoints support \`page\` (1-indexed) and \`pageSize\` (max 100, default 25).

## Filtering

Most endpoints support \`serverId\` to filter results to a specific media server.
      `.trim(),
      contact: {
        name: 'Tracearr',
        url: 'https://github.com/connorgallopo/Tracearr',
      },
    },
  });
}
