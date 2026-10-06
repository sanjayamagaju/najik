import type { Socket } from 'socket.io-client';
import { useChat } from '../stores/chat';
import { useCall } from '../stores/call';
import { useToasts } from '../stores/toast';
import { haptic } from '../lib/native';
import { sounds } from '../lib/sounds';
import type { Message, User } from '../types';
import type { SignalPayload } from '../webrtc/CallSession';

const typingTimers = new Map<string, number>();

/** Connects socket events to the stores. Returns an unbind function. */
export function bindRealtime(socket: Socket, opts: { onUnauthorized: () => void }): () => void {
  const chat = useChat.getState;
  const call = useCall.getState;

  let everConnected = false;

  const handlers: Record<string, (...args: never[]) => void> = {
    connect: () => {
      if (everConnected) {
        // Catch up on anything missed while offline (the server doesn't replay).
        chat().invalidateThreads();
        void (async () => {
          await chat().loadConversations().catch(() => {});
          const peer = chat().activePeerId;
          if (peer) {
            await chat().loadThread(peer).catch(() => {}); // merges with what's on screen
            chat().markRead(peer);
          }
        })();
        call().onSocketReconnect();
      }
      everConnected = true;
    },

    connect_error: (err: Error) => {
      if (err.message === 'unauthorized') opts.onUnauthorized();
    },

    'message:new': (m: Message) => {
      const s = chat();
      const fromPeer = m.senderId !== s.meId;
      const wasKnown = Object.values(s.threads).some((t) => t.messages.some((x) => x.id === m.id));
      s.receive(m);
      if (!fromPeer || wasKnown) return;

      if (m.kind === 'ping') {
        sounds.ping();
        haptic.ping();
        return;
      }
      if (m.kind === 'call') return;

      const viewing = s.activePeerId === m.senderId && document.visibilityState === 'visible';
      if (viewing) {
        sounds.messageIn();
        return;
      }
      sounds.messageIn();
      haptic.tap();
      void s.ensureUser(m.senderId).then((user) => {
        if (!user) return;
        useToasts.getState().push({
          tone: 'message',
          title: user.displayName,
          description: m.body,
          user,
          onClick: () => window.dispatchEvent(new CustomEvent('najik:open-chat', { detail: user.id })),
        });
      });
    },

    'message:status': (p: { ids: string[]; status: 'delivered' | 'read'; at: number }) => {
      chat().applyStatus(p.ids, p.status, p.at);
    },

    'conversation:read': (p: { peerId: string }) => {
      chat().clearUnread(p.peerId);
    },

    typing: (p: { from: string; typing: boolean }) => {
      chat().setTyping(p.from, p.typing);
      window.clearTimeout(typingTimers.get(p.from));
      // Safety net in case the "stopped typing" event is lost.
      if (p.typing) typingTimers.set(p.from, window.setTimeout(() => chat().setTyping(p.from, false), 6000));
    },

    presence: (p: { userId: string; online: boolean; lastSeen: number | null }) => {
      chat().setPresence(p.userId, p.online, p.lastSeen);
      if (!p.online) chat().setTyping(p.userId, false);
    },

    'call:incoming': (p: { callId: string; from: User; media: 'audio' | 'video' }) => {
      chat().upsertUser(p.from);
      call().onIncoming(p);
    },
    'call:accepted': (p: { callId: string }) => call().onAccepted(p),
    'call:ringing': (p: { callId: string }) => call().onRinging(p),
    'call:signal': (p: { callId: string; payload: SignalPayload }) => call().onSignal(p),
    'call:ended': (p: { callId: string; reason: string }) => call().onEnded(p),
    'call:peer-reconnecting': (p: { callId: string }) => call().onPeerSignaling(p, true),
    'call:peer-reconnected': (p: { callId: string }) => call().onPeerSignaling(p, false),
  };

  for (const [event, fn] of Object.entries(handlers)) socket.on(event, fn as (...args: unknown[]) => void);
  return () => {
    for (const [event, fn] of Object.entries(handlers)) socket.off(event, fn as (...args: unknown[]) => void);
  };
}
