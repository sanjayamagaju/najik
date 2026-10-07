/**
 * Contract types mirroring docs/PROTOCOL.md (v1). Keep in lock-step with that file.
 * JSON keys are snake_case on the wire and we keep them that way end-to-end to avoid
 * a mapping layer that could drift from the contract.
 */

export type UUID = string;
/** ISO-8601 UTC with milliseconds, e.g. 2026-10-07T09:41:00.123Z */
export type ISODateString = string;

// ───────────────────────────── §1 Errors ─────────────────────────────

export type ApiErrorCode =
  | 'validation_error'
  | 'not_authenticated'
  | 'token_expired'
  | 'token_invalid'
  | 'session_revoked'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'username_taken'
  | 'invalid_credentials'
  | 'rate_limited'
  | 'server_error'
  // client-side synthetic codes (never sent by the server)
  | 'network_error'
  | 'timeout'
  | 'cancelled'
  | 'unknown';

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, string[]>;
  };
}

// ───────────────────────────── §2 Objects ─────────────────────────────

export interface PublicUser {
  id: UUID;
  username: string;
  display_name: string;
  avatar_color: string;
  created_at: ISODateString;
}

export interface Me extends PublicUser {
  email: string | null;
  /** Whether message pushes include a text preview (backend extension). */
  show_message_preview?: boolean;
}

export interface Presence {
  user_id: UUID;
  online: boolean;
  last_seen_at: ISODateString | null;
}

export type MessageKind = 'text' | 'ping' | 'call';

export type CallMedia = 'audio' | 'video';

export type CallOutcome = 'completed' | 'missed' | 'declined' | 'cancelled' | 'failed' | 'busy';

export interface CallMessageMeta {
  call_id: UUID;
  media: CallMedia;
  outcome: CallOutcome;
  duration_sec?: number;
}

export interface Message {
  id: UUID;
  client_id: UUID;
  conversation_id: UUID;
  sender_id: UUID;
  seq: number;
  kind: MessageKind;
  body: string;
  meta: Partial<CallMessageMeta> | Record<string, never>;
  created_at: ISODateString;
}

export interface Conversation {
  id: UUID;
  peer: PublicUser;
  last_message: Message | null;
  last_seq: number;
  unread_count: number;
  my_read_seq: number;
  peer_delivered_seq: number;
  peer_read_seq: number;
  updated_at: ISODateString;
}

export type CallState = 'ringing' | 'active' | 'ended';

export type CallEndReason =
  | 'completed'
  | 'missed'
  | 'declined'
  | 'cancelled'
  | 'failed'
  | 'busy'
  | 'answered_elsewhere'
  | 'timeout';

export interface Call {
  id: UUID;
  caller_id: UUID;
  callee_id: UUID;
  media: CallMedia;
  state: CallState;
  created_at: ISODateString;
  answered_at: ISODateString | null;
  ended_at: ISODateString | null;
  end_reason: CallEndReason | null;
}

export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface IceServers {
  ice_servers: IceServer[];
  ttl_sec: number;
}

/** Derived client-side status (§2). Never stored per message. */
export type MessageStatus = 'sending' | 'failed' | 'sent' | 'delivered' | 'read';

// ───────────────────────────── §3 REST ─────────────────────────────

export type Platform = 'ios' | 'android';

export interface DeviceInfo {
  device_id: UUID;
  platform: Platform;
  name: string;
  app_version: string;
}

export interface Tokens {
  access: string;
  refresh: string;
  access_expires_at: ISODateString;
  refresh_expires_at: ISODateString;
}

export interface Session {
  id: UUID;
  device_name: string;
  platform: Platform;
  app_version: string;
  created_at: ISODateString;
  last_active_at: ISODateString;
  ip_country?: string | null;
  current: boolean;
}

export interface RegisterRequest {
  username: string;
  display_name: string;
  password: string;
  email?: string;
  device: DeviceInfo;
}

export interface LoginRequest {
  username: string;
  password: string;
  device: DeviceInfo;
}

export interface AuthResponse {
  user: Me;
  tokens: Tokens;
}

export interface RefreshResponse {
  tokens: Tokens;
}

export interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
}

export interface UpdateMeRequest {
  display_name?: string;
  email?: string | null;
  show_message_preview?: boolean;
}

export interface ReadReceiptResponse {
  conversation_id: UUID;
  delivered_seq: number;
  read_seq: number;
  unread_count: number;
}

export interface Paginated<T> {
  results: T[];
  next_cursor: string | null;
}

export interface ResultsList<T> {
  results: T[];
}

export interface MessagesPage {
  results: Message[];
  has_more: boolean;
}

export interface MessagesQuery {
  before_seq?: number;
  after_seq?: number;
  limit?: number;
}

export type PushProvider = 'fcm' | 'apns' | 'apns_voip';

/** `GET /calls` rows: a Call plus the other participant. */
export interface CallHistoryItem extends Call {
  peer: PublicUser;
}

/** `POST /calls/{id}/metrics` body (§3 Calls). */
export interface CallMetricsBody {
  rtt_ms_avg: number | null;
  jitter_ms_avg: number | null;
  packet_loss_pct_avg: number | null;
  bitrate_kbps_avg_up: number | null;
  bitrate_kbps_avg_down: number | null;
  video_quality_changes: number;
  reconnects: number;
  duration_sec: number;
  network_type: string;
  selected_video_quality: VideoQualityPref;
  selected_audio_quality: AudioQualityPref;
}

// ───────────────────────────── §4 WebSocket ─────────────────────────────

export type AppStateValue = 'active' | 'background';

export interface WsAuthAck {
  user_id: UUID;
  session_id: UUID;
  server_time: ISODateString;
  heartbeat_sec: number;
}

export interface WsAckError {
  code: string;
  message: string;
  retry_after_sec?: number;
  details?: Record<string, string[]>;
}

export type VideoQualityPref = 'auto' | '144p' | '240p' | '360p' | '480p' | '720p' | '1080p';
export type AudioQualityPref = 'auto' | 'low' | 'medium' | 'high';

export interface CallIceCandidate {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  /** Optional (backend schema): lets the peer drop candidates from a previous ICE generation. */
  usernameFragment?: string;
}

/**
 * `call.signal` payloads. The backend validates these strictly: any field not listed here is
 * rejected (`offer.iceRestart` and `candidate.usernameFragment` are the only optional extras).
 */
export type CallSignal =
  | { type: 'offer'; sdp: string; iceRestart?: boolean }
  | { type: 'answer'; sdp: string }
  | { type: 'candidate'; candidate: CallIceCandidate }
  | { type: 'renegotiate' }
  | { type: 'quality'; video: VideoQualityPref; audio: AudioQualityPref };

/**
 * Client → server requests (§4.2). `ack` is the payload of a successful ack;
 * `void` means the server sends no meaningful ack data (the frame may be sent without an id).
 */
export interface ClientRequestMap {
  'app.state': { data: { state: AppStateValue }; ack: void };
  'message.send': {
    data: { conversation_id: UUID; client_id: UUID; body: string };
    ack: { message: Message };
  };
  'message.delivered': { data: { conversation_id: UUID; seq: number }; ack: void };
  'message.read': { data: { conversation_id: UUID; seq: number }; ack: void };
  typing: { data: { conversation_id: UUID; state: 'start' | 'stop' }; ack: void };
  'presence.subscribe': { data: { user_ids: UUID[] }; ack: { presence: Presence[] } };
  'ping.send': { data: { conversation_id: UUID; client_id: UUID }; ack: { message: Message } };
  'call.invite': {
    data: { call_id: UUID; callee_id: UUID; media: CallMedia };
    /** Backend sends `ice_servers` as a plain array in call acks. */
    ack: { call: Call; ice_servers: IceServer[] };
  };
  'call.ringing': { data: { call_id: UUID }; ack: void };
  'call.accept': { data: { call_id: UUID }; ack: { call: Call; ice_servers: IceServer[] } };
  'call.decline': { data: { call_id: UUID }; ack: void };
  'call.hangup': {
    data: { call_id: UUID; reason?: 'completed' | 'cancelled' | 'failed' };
    ack: void;
  };
  'call.signal': { data: { call_id: UUID; signal: CallSignal }; ack: void };
  'call.media_state': {
    data: { call_id: UUID; audio_muted: boolean; video_enabled: boolean };
    ack: void;
  };
}

export type ClientRequestType = keyof ClientRequestMap;

/** Server → client pushes (§4.3). */
export interface ServerEventMap {
  'message.new': { message: Message };
  'message.receipt': {
    conversation_id: UUID;
    user_id: UUID;
    delivered_seq: number;
    read_seq: number;
  };
  typing: { conversation_id: UUID; user_id: UUID; state: 'start' | 'stop' };
  presence: Presence;
  'ping.received': { message: Message; from: PublicUser };
  'call.incoming': { call: Call; caller: PublicUser; ice_servers: IceServer[] };
  'call.ringing': { call_id: UUID };
  'call.accepted': { call_id: UUID; session_id: UUID };
  'call.ended': { call_id: UUID; reason: CallEndReason };
  'call.signal': { call_id: UUID; signal: CallSignal };
  'call.media_state': {
    call_id: UUID;
    user_id: UUID;
    audio_muted: boolean;
    video_enabled: boolean;
  };
  'session.revoked': Record<string, never>;
}

export type ServerEventType = keyof ServerEventMap;

// ───────────────────────────── §5 Push payloads ─────────────────────────────

export type PushPayload =
  | {
      type: 'message';
      conversation_id: UUID;
      message_id: UUID;
      sender_name: string;
      preview: string;
    }
  | { type: 'ping'; conversation_id: UUID; sender_name: string }
  | {
      type: 'call.incoming';
      call_id: UUID;
      caller_id: UUID;
      caller_name: string;
      media: CallMedia;
      expires_at: ISODateString;
    }
  | { type: 'call.ended'; call_id: UUID; reason: CallEndReason };

export type PushType = PushPayload['type'];
