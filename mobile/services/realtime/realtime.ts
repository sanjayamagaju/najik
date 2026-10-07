import NetInfo from '@react-native-community/netinfo';
import { AppState, type AppStateStatus } from 'react-native';

import { ingestMessage, isConversationOnScreen } from '@/features/messages/services/ingest';
import { reportDelivered, resetReceiptState } from '@/features/messages/services/receipts';
import { outbox } from '@/features/messages/services/send';
import { stopAllTyping } from '@/features/messages/services/typingSender';
import { handlePingReceived } from '@/features/ping/pingService';
import { startPresenceTracking, stopPresenceTracking } from '@/features/presence/presenceService';
import { setAppBadge } from '@/services/notifications';
import { telemetry } from '@/services/telemetry';
import { wsClient } from '@/services/websocket';
import { getMyUserId } from '@/store/authStore';
import { useConnectionStore } from '@/store/connectionStore';
import { selectTotalUnread, useConversationsStore } from '@/store/conversationsStore';
import { flushUserPersistence } from '@/store/persistence';
import { usePresenceStore } from '@/store/presenceStore';
import { useTypingStore } from '@/store/typingStore';
import { useUiStore } from '@/store/uiStore';
import type { Message } from '@/types/protocol';

import { resync } from './resync';

const PREVIEW_MAX = 120;

function previewFor(message: Message): string {
  if (message.kind === 'ping') return 'Pinged you';
  if (message.kind === 'call')
    return message.meta && 'media' in message.meta && message.meta.media === 'video'
      ? 'Video call'
      : 'Voice call';
  return message.body.length > PREVIEW_MAX
    ? `${message.body.slice(0, PREVIEW_MAX)}…`
    : message.body;
}

function onMessageNew(message: Message): void {
  const { fromPeer } = ingestMessage(message);
  if (!fromPeer) return;
  const conversationId = message.conversation_id;
  if (isConversationOnScreen(conversationId)) return; // read receipt is sent by the visible list
  reportDelivered(conversationId, message.seq);
  const ui = useUiStore.getState();
  if (!ui.appActive || message.kind === 'ping') return; // pings get the full-screen wave instead
  const peer = useConversationsStore.getState().byId[conversationId]?.peer;
  ui.showToast({
    id: `msg-${message.id}`,
    kind: 'message',
    title: peer?.display_name ?? 'New message',
    body: previewFor(message),
    conversationId,
    avatar: peer ? { display_name: peer.display_name, avatar_color: peer.avatar_color } : undefined,
  });
}

let handlersInstalled = false;

/** Installs the permanent WS → store wiring. Called once per process. */
export function installRealtimeHandlers(): void {
  if (handlersInstalled) return;
  handlersInstalled = true;
  const ws = wsClient();

  ws.on('message.new', ({ message }) => onMessageNew(message));
  ws.on('message.receipt', (receipt) => {
    const me = getMyUserId();
    if (me) useConversationsStore.getState().applyReceipt(receipt, me);
  });
  ws.on('typing', ({ conversation_id, user_id, state }) => {
    if (user_id !== getMyUserId()) useTypingStore.getState().apply(conversation_id, state);
  });
  ws.on('presence', (presence) => usePresenceStore.getState().set(presence));
  ws.on('ping.received', ({ message, from }) => {
    if (message.sender_id !== getMyUserId()) handlePingReceived(message, from);
    else ingestMessage(message);
  });

  ws.onStateChange((state) => {
    useConnectionStore.getState().setWsState(state);
    telemetry.breadcrumb('ws', `state → ${state}`);
  });
  ws.onAuthenticated((_ack, { reconnect }) => {
    telemetry.breadcrumb('ws', reconnect ? 'reconnected' : 'connected');
    void resync();
  });
}

let sessionCleanup: (() => void) | null = null;

/** Per-session realtime: socket, network + app-state awareness, presence tracking. */
export function startRealtime(): void {
  stopRealtime();
  const ws = wsClient();
  outbox.reset();

  const netUnsub = NetInfo.addEventListener((state) => {
    const available = state.isConnected !== false && state.isInternetReachable !== false;
    useConnectionStore.getState().setNetworkAvailable(available);
    ws.setNetworkAvailable(available);
    if (available) void outbox.flush();
  });

  const onAppState = (next: AppStateStatus) => {
    // iOS reports a transient `inactive` (control centre, app switcher); ignore it.
    if (next === 'inactive') return;
    const active = next === 'active';
    useUiStore.getState().setAppActive(active);
    ws.setAppState(active ? 'active' : 'background');
    if (active) {
      void outbox.flush();
    } else {
      stopAllTyping();
      flushUserPersistence();
      void setAppBadge(selectTotalUnread(useConversationsStore.getState()));
    }
  };
  const appStateSub = AppState.addEventListener('change', onAppState);
  const initialActive = AppState.currentState !== 'background';
  useUiStore.getState().setAppActive(initialActive);
  ws.setAppState(initialActive ? 'active' : 'background');

  startPresenceTracking();
  ws.start();

  sessionCleanup = () => {
    netUnsub();
    appStateSub.remove();
    stopPresenceTracking();
    stopAllTyping();
    outbox.dispose();
    ws.stop();
    resetReceiptState();
  };
}

export function stopRealtime(): void {
  const cleanup = sessionCleanup;
  sessionCleanup = null;
  cleanup?.();
}
