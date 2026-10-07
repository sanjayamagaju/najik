import type {
  AuthResponse,
  Call,
  CallHistoryItem,
  CallMetricsBody,
  ChangePasswordRequest,
  Conversation,
  IceServers,
  LoginRequest,
  Me,
  Message,
  MessagesPage,
  MessagesQuery,
  Paginated,
  Presence,
  PublicUser,
  PushProvider,
  ReadReceiptResponse,
  RegisterRequest,
  ResultsList,
  Session,
  UpdateMeRequest,
  UUID,
} from '@/types/protocol';

import { apiClient } from './instance';

interface RequestOptions {
  signal?: AbortSignal;
}

const enc = encodeURIComponent;

export const authApi = {
  async register(body: RegisterRequest): Promise<AuthResponse> {
    const { data } = await apiClient().post<AuthResponse>('/auth/register', body, {
      skipAuth: true,
    });
    return data;
  },
  async login(body: LoginRequest): Promise<AuthResponse> {
    const { data } = await apiClient().post<AuthResponse>('/auth/login', body, { skipAuth: true });
    return data;
  },
  async logout(): Promise<void> {
    await apiClient().post('/auth/logout', {}, { maxRetries: 0 });
  },
  async changePassword(body: ChangePasswordRequest): Promise<void> {
    await apiClient().post('/auth/password', body);
  },
  async sessions(): Promise<Session[]> {
    const { data } = await apiClient().get<ResultsList<Session>>('/auth/sessions');
    return data.results;
  },
  async revokeSession(id: UUID): Promise<void> {
    await apiClient().delete(`/auth/sessions/${enc(id)}`);
  },
  async revokeOtherSessions(): Promise<void> {
    await apiClient().post('/auth/sessions/revoke-others', {}, { idempotent: true });
  },
};

export const usersApi = {
  async me(): Promise<Me> {
    const { data } = await apiClient().get<Me>('/users/me');
    return data;
  },
  async updateMe(body: UpdateMeRequest): Promise<Me> {
    const { data } = await apiClient().patch<Me>('/users/me', body);
    return data;
  },
  async deleteMe(password: string): Promise<void> {
    await apiClient().delete('/users/me', { data: { password }, maxRetries: 0 });
  },
  async search(
    q: string,
    options: RequestOptions & { limit?: number } = {},
  ): Promise<PublicUser[]> {
    const { data } = await apiClient().get<ResultsList<PublicUser>>('/users/search', {
      params: { q, limit: options.limit ?? 20 },
      signal: options.signal,
      maxRetries: 0,
    });
    return data.results;
  },
  async get(id: UUID): Promise<PublicUser> {
    const { data } = await apiClient().get<PublicUser>(`/users/${enc(id)}`);
    return data;
  },
};

export const conversationsApi = {
  async list(
    params: { cursor?: string | null; limit?: number } = {},
  ): Promise<Paginated<Conversation>> {
    const { data } = await apiClient().get<Paginated<Conversation>>('/conversations', {
      params: { cursor: params.cursor ?? undefined, limit: params.limit ?? 30 },
    });
    return data;
  },
  /** get-or-create (200 or 201). */
  async open(userId: UUID): Promise<Conversation> {
    const { data } = await apiClient().post<Conversation>(
      '/conversations',
      { user_id: userId },
      { idempotent: true },
    );
    return data;
  },
  async get(id: UUID): Promise<Conversation> {
    const { data } = await apiClient().get<Conversation>(`/conversations/${enc(id)}`);
    return data;
  },
  async messages(
    id: UUID,
    query: MessagesQuery = {},
    options: RequestOptions = {},
  ): Promise<MessagesPage> {
    const { data } = await apiClient().get<MessagesPage>(`/conversations/${enc(id)}/messages`, {
      params: { ...query, limit: Math.min(query.limit ?? 50, 100) },
      signal: options.signal,
    });
    return data;
  },
  /** REST fallback for `message.send`; idempotent by client_id (same client_id → same message). */
  async sendMessage(id: UUID, body: { client_id: UUID; body: string }): Promise<Message> {
    const { data } = await apiClient().post<Message>(`/conversations/${enc(id)}/messages`, body, {
      idempotent: true,
    });
    return data;
  },
  /** REST fallback for the read receipt. Watermarks only move forward, so retries are safe. */
  async markRead(id: UUID, seq: number): Promise<ReadReceiptResponse> {
    const { data } = await apiClient().post<ReadReceiptResponse>(
      `/conversations/${enc(id)}/read`,
      { seq },
      { idempotent: true },
    );
    return data;
  },
  /** REST fallback for `ping.send` (rate-limited server-side). */
  async ping(id: UUID, clientId: UUID): Promise<Message> {
    const { data } = await apiClient().post<Message>(
      `/conversations/${enc(id)}/ping`,
      { client_id: clientId },
      { idempotent: true, maxRetries: 1 },
    );
    return data;
  },
};

export const presenceApi = {
  async get(userIds: UUID[]): Promise<Presence[]> {
    if (userIds.length === 0) return [];
    const { data } = await apiClient().get<ResultsList<Presence>>('/presence', {
      params: { user_ids: userIds.join(',') },
    });
    return data.results;
  },
};

export const devicesApi = {
  async putPushToken(provider: PushProvider, token: string): Promise<void> {
    await apiClient().put('/devices/push-token', { provider, token });
  },
  async deletePushToken(provider: PushProvider): Promise<void> {
    await apiClient().delete('/devices/push-token', { data: { provider }, maxRetries: 0 });
  },
};

export const callsApi = {
  /** Fresh short-lived TURN credentials (used when the ones from the call ack are stale). */
  async iceServers(): Promise<IceServers> {
    const { data } = await apiClient().get<IceServers>('/calls/ice-servers', { maxRetries: 1 });
    return data;
  },
  async history(params: { cursor?: string | null } = {}): Promise<Paginated<CallHistoryItem>> {
    const { data } = await apiClient().get<Paginated<CallHistoryItem>>('/calls', {
      params: { cursor: params.cursor ?? undefined },
    });
    return data;
  },
  async get(id: UUID): Promise<Call> {
    const { data } = await apiClient().get<Call>(`/calls/${enc(id)}`, { maxRetries: 1 });
    return data;
  },
  /** Best-effort quality summary; the server upserts per (call, user) so retries are safe. */
  async postMetrics(id: UUID, body: CallMetricsBody): Promise<void> {
    await apiClient().post(`/calls/${enc(id)}/metrics`, body, { idempotent: true, maxRetries: 0 });
  },
};
