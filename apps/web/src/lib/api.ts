import type {
  Server,
  User,
  Session,
  SessionWithDetails,
  ActiveSession,
  Rule,
  Violation,
  ViolationWithDetails,
  DashboardStats,
  PlayStats,
  UserStats,
  LocationStats,
  UserLocation,
  UserDevice,
  Settings,
  PaginatedResponse,
} from '@tracearr/shared';
import { API_BASE_PATH } from '@tracearr/shared';

// Types for Plex server selection
export interface PlexServerConnection {
  uri: string;
  local: boolean;
  address: string;
  port: number;
}

export interface PlexServerInfo {
  name: string;
  platform: string;
  version: string;
  connections: PlexServerConnection[];
}

export interface PlexCheckPinResponse {
  authorized: boolean;
  message?: string;
  // If returning user (auto-connect)
  accessToken?: string;
  refreshToken?: string;
  user?: User;
  // If new user (needs server selection)
  needsServerSelection?: boolean;
  servers?: PlexServerInfo[];
  tempToken?: string;
}

// Token storage keys
const ACCESS_TOKEN_KEY = 'tracearr_access_token';
const REFRESH_TOKEN_KEY = 'tracearr_refresh_token';

// Token management utilities
export const tokenStorage = {
  getAccessToken: (): string | null => localStorage.getItem(ACCESS_TOKEN_KEY),
  getRefreshToken: (): string | null => localStorage.getItem(REFRESH_TOKEN_KEY),
  setTokens: (accessToken: string, refreshToken: string) => {
    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  },
  clearTokens: () => {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  },
};

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_PATH) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    // Add Authorization header if we have a token
    const token = tokenStorage.getAccessToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      credentials: 'include',
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message ?? `Request failed: ${response.status}`);
    }

    return response.json();
  }

  // Setup - check if Tracearr needs initial configuration
  setup = {
    status: () => this.request<{ hasServers: boolean; needsSetup: boolean }>('/setup/status'),
  };

  // Auth
  auth = {
    me: () => this.request<{
      userId: string;
      username: string;
      email: string | null;
      thumbUrl: string | null;
      role: 'owner' | 'guest';
      trustScore: number;
      serverIds: string[];
      // Fallback fields from User type
      id?: string;
      serverId?: string;
      isOwner?: boolean;
    }>('/auth/me'),
    logout: () => this.request<void>('/auth/logout', { method: 'POST' }),

    // Plex OAuth - Step 1: Get PIN
    loginPlex: () =>
      this.request<{ pinId: string; authUrl: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ type: 'plex' }),
      }),

    // Plex OAuth - Step 2: Check PIN and get servers
    checkPlexPin: (pinId: string) =>
      this.request<PlexCheckPinResponse>('/auth/plex/check-pin', {
        method: 'POST',
        body: JSON.stringify({ pinId }),
      }),

    // Plex OAuth - Step 3: Connect with selected server (only for setup)
    connectPlexServer: (data: { tempToken: string; serverUri: string; serverName: string }) =>
      this.request<{ accessToken: string; refreshToken: string; user: User }>('/auth/plex/connect', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    // Jellyfin direct auth
    loginJellyfin: (data: {
      serverUrl: string;
      serverName: string;
      username: string;
      password: string;
    }) =>
      this.request<{
        accessToken: string;
        refreshToken: string;
        user: User;
      }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ type: 'jellyfin', ...data }),
      }),

    // Legacy callback (deprecated, kept for compatibility)
    checkPlexCallback: (data: {
      pinId: string;
      serverUrl: string;
      serverName: string;
    }) =>
      this.request<{
        authorized: boolean;
        message?: string;
        accessToken?: string;
        refreshToken?: string;
        user?: User;
      }>('/auth/callback', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  };

  // Servers
  servers = {
    list: async () => {
      const response = await this.request<{ data: Server[] }>('/servers');
      return response.data;
    },
    create: (data: { name: string; type: string; url: string; token: string }) =>
      this.request<Server>('/servers', { method: 'POST', body: JSON.stringify(data) }),
    delete: (id: string) => this.request<void>(`/servers/${id}`, { method: 'DELETE' }),
    sync: (id: string) =>
      this.request<{
        success: boolean;
        usersAdded: number;
        usersUpdated: number;
        librariesSynced: number;
        errors: string[];
        syncedAt: string;
      }>(`/servers/${id}/sync`, { method: 'POST', body: JSON.stringify({}) }),
  };

  // Users
  users = {
    list: (params?: { page?: number; pageSize?: number }) => {
      const searchParams = new URLSearchParams();
      if (params?.page) searchParams.set('page', String(params.page));
      if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
      return this.request<PaginatedResponse<User>>(`/users?${searchParams.toString()}`);
    },
    get: (id: string) => this.request<User>(`/users/${id}`),
    update: (id: string, data: Partial<User>) =>
      this.request<User>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    sessions: (id: string, params?: { page?: number; pageSize?: number }) => {
      const query = new URLSearchParams(params as Record<string, string>).toString();
      return this.request<PaginatedResponse<Session>>(`/users/${id}/sessions?${query}`);
    },
    locations: async (id: string) => {
      const response = await this.request<{ data: UserLocation[] }>(`/users/${id}/locations`);
      return response.data;
    },
    devices: async (id: string) => {
      const response = await this.request<{ data: UserDevice[] }>(`/users/${id}/devices`);
      return response.data;
    },
  };

  // Sessions
  sessions = {
    list: (params?: { page?: number; pageSize?: number; userId?: string }) => {
      const query = new URLSearchParams(params as Record<string, string>).toString();
      return this.request<PaginatedResponse<SessionWithDetails>>(`/sessions?${query}`);
    },
    getActive: async () => {
      const response = await this.request<{ data: ActiveSession[] }>('/sessions/active');
      return response.data;
    },
    get: (id: string) => this.request<Session>(`/sessions/${id}`),
  };

  // Rules
  rules = {
    list: async () => {
      const response = await this.request<{ data: Rule[] }>('/rules');
      return response.data;
    },
    create: (data: Omit<Rule, 'id' | 'createdAt' | 'updatedAt'>) =>
      this.request<Rule>('/rules', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Partial<Rule>) =>
      this.request<Rule>(`/rules/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) => this.request<void>(`/rules/${id}`, { method: 'DELETE' }),
  };

  // Violations
  violations = {
    list: (params?: {
      page?: number;
      pageSize?: number;
      userId?: string;
      severity?: string;
      acknowledged?: boolean;
    }) => {
      const searchParams = new URLSearchParams();
      if (params?.page) searchParams.set('page', String(params.page));
      if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
      if (params?.userId) searchParams.set('userId', params.userId);
      if (params?.severity) searchParams.set('severity', params.severity);
      if (params?.acknowledged !== undefined) searchParams.set('acknowledged', String(params.acknowledged));
      return this.request<PaginatedResponse<ViolationWithDetails>>(`/violations?${searchParams.toString()}`);
    },
    acknowledge: (id: string) =>
      this.request<Violation>(`/violations/${id}`, { method: 'PATCH' }),
    dismiss: (id: string) => this.request<void>(`/violations/${id}`, { method: 'DELETE' }),
  };

  // Stats
  stats = {
    dashboard: () => this.request<DashboardStats>('/stats/dashboard'),
    plays: async (period?: string) => {
      const response = await this.request<{ data: PlayStats[] }>(`/stats/plays?period=${period ?? 'week'}`);
      return response.data;
    },
    users: async () => {
      const response = await this.request<{ data: UserStats[] }>('/stats/users');
      return response.data;
    },
    locations: async () => {
      const response = await this.request<{ data: LocationStats[] }>('/stats/locations');
      return response.data;
    },
  };

  // Settings
  settings = {
    get: () => this.request<Settings>('/settings'),
    update: (data: Partial<Settings>) =>
      this.request<Settings>('/settings', { method: 'PATCH', body: JSON.stringify(data) }),
  };

  // Import
  import = {
    tautulli: {
      test: (url: string, apiKey: string) =>
        this.request<{ success: boolean; message: string; users?: number; historyRecords?: number }>(
          '/import/tautulli/test',
          { method: 'POST', body: JSON.stringify({ url, apiKey }) }
        ),
      start: (serverId: string) =>
        this.request<{ status: string; message: string }>(
          '/import/tautulli',
          { method: 'POST', body: JSON.stringify({ serverId }) }
        ),
    },
  };
}

export const api = new ApiClient();
