import type { PushPayload } from '@/types/protocol';

type Raw = Record<string, unknown>;

const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/**
 * Validates a push `data` object (PROTOCOL §5) into the typed union. FCM data values are all
 * strings; unknown or malformed payloads return null and are ignored.
 */
export function parsePushPayload(data: unknown): PushPayload | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Raw;
  switch (d.type) {
    case 'message':
      return str(d.conversation_id) && str(d.message_id)
        ? {
            type: 'message',
            conversation_id: d.conversation_id,
            message_id: d.message_id,
            sender_name: str(d.sender_name) ? d.sender_name : '',
            preview: typeof d.preview === 'string' ? d.preview : '',
          }
        : null;
    case 'ping':
      return str(d.conversation_id)
        ? {
            type: 'ping',
            conversation_id: d.conversation_id,
            sender_name: str(d.sender_name) ? d.sender_name : '',
          }
        : null;
    case 'call.incoming':
      return str(d.call_id) && str(d.caller_id) && (d.media === 'audio' || d.media === 'video')
        ? {
            type: 'call.incoming',
            call_id: d.call_id,
            caller_id: d.caller_id,
            caller_name: str(d.caller_name) ? d.caller_name : '',
            media: d.media,
            expires_at: str(d.expires_at) ? d.expires_at : '',
          }
        : null;
    case 'call.ended':
      return str(d.call_id) && str(d.reason)
        ? {
            type: 'call.ended',
            call_id: d.call_id,
            reason: d.reason as Extract<PushPayload, { type: 'call.ended' }>['reason'],
          }
        : null;
    default:
      return null;
  }
}

/**
 * Pulls the data dictionary out of an expo-notifications request. Depending on platform and
 * whether the push carried a `notification` block, it can live in `content.data`, the FCM
 * `remoteMessage.data` or the raw APNs `payload`.
 */
export function extractPushData(request: {
  content: { data?: Record<string, unknown> | null };
  trigger: unknown;
}): Raw | null {
  const trigger = (request.trigger ?? null) as {
    type?: string;
    remoteMessage?: { data?: Record<string, string> };
    payload?: Raw;
  } | null;
  const fromContent = request.content.data;
  if (fromContent && typeof fromContent === 'object' && 'type' in fromContent) return fromContent;
  if (trigger?.remoteMessage?.data && 'type' in trigger.remoteMessage.data)
    return trigger.remoteMessage.data;
  if (trigger?.payload && typeof trigger.payload === 'object' && 'type' in trigger.payload)
    return trigger.payload;
  return null;
}
