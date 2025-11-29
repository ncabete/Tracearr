/**
 * Core type definitions for Tracearr
 */

// Server types
export type ServerType = 'plex' | 'jellyfin';

export interface Server {
  id: string;
  name: string;
  type: ServerType;
  url: string;
  createdAt: Date;
  updatedAt: Date;
}

// User types
export interface User {
  id: string;
  serverId: string;
  externalId: string;
  username: string;
  email: string | null;
  thumbUrl: string | null;
  isOwner: boolean;
  allowGuest: boolean;
  trustScore: number;
  createdAt: Date;
  updatedAt: Date;
}

export type UserRole = 'owner' | 'guest';

export interface AuthUser {
  userId: string;
  username: string;
  role: UserRole;
  serverIds: string[];
}

// Session types
export type SessionState = 'playing' | 'paused' | 'stopped';
export type MediaType = 'movie' | 'episode' | 'track';

export interface Session {
  id: string;
  serverId: string;
  userId: string;
  sessionKey: string;
  state: SessionState;
  mediaType: MediaType;
  mediaTitle: string;
  // Enhanced media metadata for episodes
  grandparentTitle: string | null; // Show name (for episodes)
  seasonNumber: number | null; // Season number (for episodes)
  episodeNumber: number | null; // Episode number (for episodes)
  year: number | null; // Release year
  thumbPath: string | null; // Poster path (e.g., /library/metadata/123/thumb)
  ratingKey: string | null; // Plex/Jellyfin media identifier
  externalSessionId: string | null; // Tautulli reference_id for dedup
  startedAt: Date;
  stoppedAt: Date | null;
  durationMs: number | null; // Actual watch duration
  totalDurationMs: number | null; // Total media length
  progressMs: number | null; // Current playback position
  ipAddress: string;
  geoCity: string | null;
  geoCountry: string | null;
  geoLat: number | null;
  geoLon: number | null;
  playerName: string | null; // Friendly device name
  deviceId: string | null; // Unique device identifier (machineIdentifier)
  product: string | null; // Product/app name (e.g., "Plex for iOS")
  device: string | null; // Device type (e.g., "iPhone")
  platform: string | null;
  quality: string | null;
  isTranscode: boolean;
  bitrate: number | null;
}

export interface ActiveSession extends Session {
  user: Pick<User, 'id' | 'username' | 'thumbUrl'>;
  server: Pick<Server, 'id' | 'name' | 'type'>;
}

// Session with user/server details (from paginated API)
export interface SessionWithDetails extends Omit<Session, 'ratingKey' | 'externalSessionId' | 'totalDurationMs' | 'progressMs'> {
  username: string;
  userThumb: string | null;
  serverName: string;
  serverType: ServerType;
}

// Rule types
export type RuleType =
  | 'impossible_travel'
  | 'simultaneous_locations'
  | 'device_velocity'
  | 'concurrent_streams'
  | 'geo_restriction';

export interface ImpossibleTravelParams {
  maxSpeedKmh: number;
  ignoreVpnRanges?: boolean;
}

export interface SimultaneousLocationsParams {
  minDistanceKm: number;
}

export interface DeviceVelocityParams {
  maxIps: number;
  windowHours: number;
}

export interface ConcurrentStreamsParams {
  maxStreams: number;
}

export interface GeoRestrictionParams {
  blockedCountries: string[];
}

export type RuleParams =
  | ImpossibleTravelParams
  | SimultaneousLocationsParams
  | DeviceVelocityParams
  | ConcurrentStreamsParams
  | GeoRestrictionParams;

export interface Rule {
  id: string;
  name: string;
  type: RuleType;
  params: RuleParams;
  userId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Violation types
export type ViolationSeverity = 'low' | 'warning' | 'high';

export interface Violation {
  id: string;
  ruleId: string;
  userId: string;
  sessionId: string;
  severity: ViolationSeverity;
  data: Record<string, unknown>;
  createdAt: Date;
  acknowledgedAt: Date | null;
}

export interface ViolationWithDetails extends Violation {
  rule: Pick<Rule, 'id' | 'name' | 'type'>;
  user: Pick<User, 'id' | 'username' | 'thumbUrl'>;
}

// Stats types
export interface DashboardStats {
  activeStreams: number;
  todayPlays: number;
  watchTimeHours: number;
  alertsLast24h: number;
}

export interface PlayStats {
  date: string;
  count: number;
}

export interface UserStats {
  userId: string;
  username: string;
  thumbUrl: string | null;
  playCount: number;
  watchTimeHours: number;
}

export interface LocationStats {
  city: string;
  country: string;
  lat: number;
  lon: number;
  count: number;
}

export interface LibraryStats {
  movies: number;
  shows: number;
  episodes: number;
  tracks: number;
}

// Settings types
export interface Settings {
  allowGuestAccess: boolean;
  discordWebhookUrl: string | null;
  customWebhookUrl: string | null;
  notifyOnViolation: boolean;
  notifyOnSessionStart: boolean;
  notifyOnSessionStop: boolean;
  notifyOnServerDown: boolean;
  // Poller settings
  pollerEnabled: boolean;
  pollerIntervalMs: number;
  // Tautulli integration
  tautulliUrl: string | null;
  tautulliApiKey: string | null;
}

// Tautulli import types
export interface TautulliImportProgress {
  status: 'idle' | 'fetching' | 'processing' | 'complete' | 'error';
  totalRecords: number;
  processedRecords: number;
  importedRecords: number;
  skippedRecords: number;
  errorRecords: number;
  currentPage: number;
  totalPages: number;
  message: string;
}

export interface TautulliImportResult {
  success: boolean;
  imported: number;
  skipped: number;
  errors: number;
  message: string;
}

// WebSocket event types
export interface ServerToClientEvents {
  'session:started': (session: ActiveSession) => void;
  'session:stopped': (sessionId: string) => void;
  'session:updated': (session: ActiveSession) => void;
  'violation:new': (violation: ViolationWithDetails) => void;
  'stats:updated': (stats: DashboardStats) => void;
  'import:progress': (progress: TautulliImportProgress) => void;
}

export interface ClientToServerEvents {
  'subscribe:sessions': () => void;
  'unsubscribe:sessions': () => void;
}

// API response types
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
}
