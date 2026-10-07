import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';
import { AppState, Platform } from 'react-native';

import { callsApi, devicesApi, usersApi } from '@/services/api/endpoints';
import { telemetry } from '@/services/telemetry';
import { audioSession } from '@/services/webrtc/audioSession';
import { deviceVideoCap } from '@/services/webrtc/deviceClass';
import {
  acquireLocalMedia,
  captureHeightOf,
  ensureMediaPermissions,
  stopStream,
  switchCamera,
} from '@/services/webrtc/media';
import {
  notifyAudioSessionActivated,
  notifyAudioSessionDeactivated,
  createPeerConnection,
} from '@/services/webrtc/rtc';
import { wsClient } from '@/services/websocket';
import { getMyUserId, useAuthStore } from '@/store/authStore';
import { useConversationsStore } from '@/store/conversationsStore';
import { toast } from '@/store/uiStore';
import type { CallMedia } from '@/types/protocol';
import { haptics } from '@/utils/haptics';

import { createCallNativeBridge } from '../native/callNative';
import { ensureCallChannel, setCallPushSink } from '../push';
import { callStore } from '../store/callStore';

import { CallController, toPeer } from './CallController';

/** The process-wide call controller with real dependencies. */

export const callNative = createCallNativeBridge();

let lastNetType = 'unknown';

function netKey(state: NetInfoState): {
  type: string;
  isConnected: boolean | null;
  details: string | null;
} {
  const details = state.details as { ipAddress?: string; ssid?: string } | null;
  return {
    type: state.type,
    isConnected: state.isConnected,
    details: details?.ipAddress ?? details?.ssid ?? null,
  };
}

export const callController = new CallController({
  ws: wsClient(),
  api: {
    iceServers: () => callsApi.iceServers(),
    getCall: (id) => callsApi.get(id),
    postMetrics: (id, body) => callsApi.postMetrics(id, body),
    lookupPeer: (id) =>
      Object.values(useConversationsStore.getState().byId).find((c) => c.peer.id === id)?.peer ??
      null,
  },
  media: {
    ensurePermissions: ensureMediaPermissions,
    acquire: acquireLocalMedia,
    stop: stopStream,
    switchCamera,
    captureHeight: captureHeightOf,
  },
  audio: audioSession,
  native: callNative,
  createPeerConnection,
  store: callStore,
  newCallId: () => Crypto.randomUUID(),
  myUserId: getMyUserId,
  deviceVideoCap,
  networkType: () => lastNetType,
  isAppActive: () => AppState.currentState === 'active',
  log: (message, data) => telemetry.debug('call', message, data),
  breadcrumb: (message, data) => telemetry.breadcrumb('call', message, data),
  haptic: (kind) => {
    if (kind === 'connected') haptics.success();
    else if (kind === 'ended') haptics.medium();
    else haptics.selection();
  },
  onAudioSession: (active) =>
    active ? notifyAudioSessionActivated() : notifyAudioSessionDeactivated(),
});

let installed = false;

/**
 * Installs the permanent call wiring (WS events, native call actions, push sink, AppState and
 * NetInfo). Called once per process from the root layout, like `installRealtimeHandlers`.
 */
export function installCallHandlers(): void {
  if (installed) return;
  installed = true;
  callController.install();
  setCallPushSink({
    incoming: (p) => {
      if (useAuthStore.getState().status === 'signedIn') {
        callController.handleIncomingPush(p, { nativeRinging: false });
      }
    },
    ended: (callId, reason) => callController.handlePushEnded(callId, reason),
  });
  void ensureCallChannel();

  AppState.addEventListener('change', (next) => {
    if (next === 'inactive') return;
    callController.onAppStateChange(next === 'active');
  });
  NetInfo.addEventListener((state) => {
    lastNetType = state.type;
    callController.onNetworkChange(netKey(state));
  });
  callNative.onVoipToken((token) => void uploadVoipToken(token));
}

// ───────────────────────── iOS VoIP token (PushKit) ─────────────────────────

let uploadedVoipToken: string | null = null;

async function uploadVoipToken(token: string): Promise<void> {
  if (Platform.OS !== 'ios' || useAuthStore.getState().status !== 'signedIn') return;
  if (uploadedVoipToken === token) return;
  try {
    await devicesApi.putPushToken('apns_voip', token);
    uploadedVoipToken = token;
    telemetry.breadcrumb('push', 'voip token registered');
  } catch (error) {
    telemetry.warn('push', 'voip token upload failed', { error: String(error) });
  }
}

/** After sign-in: register PushKit and upload the VoIP token (`apns_voip`). */
export function registerVoipToken(): void {
  if (Platform.OS !== 'ios' || !callNative.available) return;
  callNative.registerVoip();
  const token = callNative.getVoipToken();
  if (token) void uploadVoipToken(token);
}

/** Before logout (still authorized). */
export async function unregisterVoipToken(): Promise<void> {
  const had = uploadedVoipToken;
  uploadedVoipToken = null;
  if (!had) return;
  try {
    await devicesApi.deletePushToken('apns_voip');
  } catch (error) {
    telemetry.warn('push', 'voip token unregister failed', { error: String(error) });
  }
}

/** Forced logout: no server calls possible. */
export function forgetVoipToken(): void {
  uploadedVoipToken = null;
}

/** Session end: hang up anything live and clear call state. */
export function resetCalls(): void {
  callController.reset();
}

/** Dial from a route/button: resolves the peer profile (cache first) then starts the call. */
export async function startOutgoingCall(
  peerId: string,
  media: CallMedia,
  conversationId: string | null,
): Promise<boolean> {
  let peer = Object.values(useConversationsStore.getState().byId).find(
    (c) => c.peer.id === peerId,
  )?.peer;
  if (!peer) {
    try {
      peer = await usersApi.get(peerId);
    } catch {
      toast.error("Couldn't start the call", 'Check your connection and try again.');
      return false;
    }
  }
  const conversation =
    conversationId ??
    Object.values(useConversationsStore.getState().byId).find((c) => c.peer.id === peerId)?.id ??
    null;
  await callController.startOutgoing({ peer: toPeer(peer), media, conversationId: conversation });
  return true;
}
