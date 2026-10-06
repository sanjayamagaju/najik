export interface User {
  id: string;
  username: string;
  displayName: string;
  avatarHue: number;
  lastSeen: number | null;
  online?: boolean;
}

export type MessageKind = 'text' | 'ping' | 'call';
export type DeliveryStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface CallMeta {
  media: 'audio' | 'video';
  outcome: 'completed' | 'missed' | 'declined' | 'cancelled' | 'failed';
  durationSec: number;
}

export interface Message {
  id: string;
  clientId: string | null;
  senderId: string;
  recipientId: string;
  kind: MessageKind;
  body: string;
  meta: CallMeta | null;
  createdAt: number;
  deliveredAt: number | null;
  readAt: number | null;
  /** Client-only: optimistic send state. */
  pending?: boolean;
  failed?: boolean;
}

export interface Conversation {
  peerId: string;
  peer: User;
  lastMessage: Message;
  unread: number;
}

export type CallMedia = 'audio' | 'video';
