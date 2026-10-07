import { nullCallNativeBridge } from '@/features/calls/native/callNative';
import {
  FakePeerConnection,
  fakeLocalStream,
  flush,
  ManualTimers,
} from '@/services/webrtc/testing/fakes';
import type { Call, CallSignal } from '@/types/protocol';

import { createCallStore } from '../../store/callStore';
import { CallController, type CallControllerDeps, type WsLike } from '../CallController';

type Handler = (data: unknown) => void;

class FakeWs {
  open = true;
  readonly requests: { type: string; data: Record<string, unknown> }[] = [];
  readonly sent: { type: string; data: unknown }[] = [];
  responders: Record<string, (data: Record<string, unknown>) => Promise<unknown>> = {};
  private handlers = new Map<string, Set<Handler>>();
  private authListeners = new Set<
    (ack: { session_id: string }, info: { reconnect: boolean }) => void
  >();
  private stateListeners = new Set<(state: string) => void>();

  request = (type: string, data: Record<string, unknown>) => {
    this.requests.push({ type, data });
    const responder = this.responders[type];
    return responder ? responder(data) : Promise.resolve({});
  };
  send = (type: string, data: unknown) => {
    if (!this.open) return false;
    this.sent.push({ type, data });
    return true;
  };
  isOpen = () => this.open;
  on = (type: string, handler: Handler) => {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(handler);
    return () => set.delete(handler);
  };
  onAuthenticated = (l: (ack: { session_id: string }, info: { reconnect: boolean }) => void) => {
    this.authListeners.add(l);
    return () => this.authListeners.delete(l);
  };
  onStateChange = (l: (s: string) => void) => {
    this.stateListeners.add(l);
    return () => this.stateListeners.delete(l);
  };
  emit(type: string, data: unknown) {
    for (const h of this.handlers.get(type) ?? []) h(data);
  }
  authenticate(reconnect: boolean) {
    for (const l of this.authListeners) l({ session_id: 'sess-me' }, { reconnect });
  }
  signals(): CallSignal[] {
    return this.requests
      .filter((r) => r.type === 'call.signal')
      .map((r) => r.data.signal as CallSignal);
  }
  types(): string[] {
    return this.requests.map((r) => r.type);
  }
}

const ICE = [{ urls: ['turn:turn.example.com:3478'], username: '9999999999:me', credential: 'c' }];
const peerUser = {
  id: 'peer-1',
  username: 'arjun',
  display_name: 'Arjun',
  avatar_color: '#7C5CFF',
  created_at: '',
};

function serverCall(overrides: Partial<Call> = {}): Call {
  return {
    id: 'call-1',
    caller_id: 'me',
    callee_id: 'peer-1',
    media: 'video',
    state: 'ringing',
    created_at: '',
    answered_at: null,
    ended_at: null,
    end_reason: null,
    ...overrides,
  };
}

function setup(overrides: Partial<CallControllerDeps> = {}) {
  FakePeerConnection.instances = [];
  const ws = new FakeWs();
  const timers = new ManualTimers();
  const store = createCallStore();
  const api = {
    iceServers: jest.fn(async () => ({ ice_servers: ICE, ttl_sec: 3600 })),
    getCall: jest.fn(async (id: string) => serverCall({ id, state: 'active' })),
    postMetrics: jest.fn(async () => undefined),
    lookupPeer: jest.fn(() => null),
  };
  const media = {
    ensurePermissions: jest.fn(async () => true),
    acquire: jest.fn(async (m: 'audio' | 'video') => fakeLocalStream(m === 'video')),
    stop: jest.fn(),
    switchCamera: jest.fn(async () => 'environment' as const),
    captureHeight: jest.fn(() => 720),
  };
  const audio = {
    start: jest.fn(),
    startRingback: jest.fn(),
    stopRingback: jest.fn(),
    stop: jest.fn(),
    setSpeaker: jest.fn(),
    startRingtone: jest.fn(),
    stopRingtone: jest.fn(),
  };
  const native = { ...nullCallNativeBridge, dismissIncoming: jest.fn(), startOngoing: jest.fn() };
  const controller = new CallController({
    ws: ws as unknown as WsLike,
    api,
    media,
    audio,
    native,
    createPeerConnection: (config) => new FakePeerConnection(config),
    store,
    newCallId: () => 'call-1',
    myUserId: () => 'me',
    deviceVideoCap: () => '720p',
    networkType: () => 'wifi',
    timers,
    ...overrides,
  });
  controller.install();
  ws.authenticate(false);
  const pc = () => FakePeerConnection.instances[0];
  const phase = () => store.getState().machine.phase;
  return { controller, ws, timers, store, api, media, audio, native, pc, phase };
}

async function connectOutgoing(t: ReturnType<typeof setup>, media: 'audio' | 'video' = 'video') {
  t.ws.responders['call.invite'] = async () => ({ call: serverCall({ media }), ice_servers: ICE });
  await t.controller.startOutgoing({ peer: peerUser, media, conversationId: 'conv-1' });
  t.ws.emit('call.ringing', { call_id: 'call-1' });
  t.ws.emit('call.accepted', { call_id: 'call-1', session_id: 'sess-peer' });
  await flush();
  await t.controller['session']?.handleSignal({ type: 'answer', sdp: 'v=0\r\n' });
  t.pc()!.setIceState('connected');
  await flush();
}

describe('CallController — outgoing', () => {
  it('invites with a client call id and sends the offer only after call.accepted', async () => {
    const t = setup();
    t.ws.responders['call.invite'] = async () => ({ call: serverCall(), ice_servers: ICE });
    await t.controller.startOutgoing({ peer: peerUser, media: 'video', conversationId: 'conv-1' });

    expect(t.ws.requests[0]).toEqual({
      type: 'call.invite',
      data: { call_id: 'call-1', callee_id: 'peer-1', media: 'video' },
    });
    expect(t.phase()).toBe('outgoing');
    expect(t.store.getState().localStreamUrl).toBe('stream://local');

    t.ws.emit('call.ringing', { call_id: 'call-1' });
    expect(t.phase()).toBe('ringing');
    expect(t.audio.startRingback).toHaveBeenCalled();
    // No PeerConnection and no signal while ringing (the server would reject it).
    expect(FakePeerConnection.instances).toHaveLength(0);
    expect(t.ws.signals()).toEqual([]);

    t.ws.emit('call.accepted', { call_id: 'call-1', session_id: 'sess-peer' });
    await flush();
    expect(t.phase()).toBe('connecting');
    expect(t.pc()!.config).toMatchObject({ iceServers: [{ urls: ICE[0]!.urls }] });
    expect(t.ws.signals()[0]).toMatchObject({ type: 'offer' });
    expect(t.audio.stopRingback).toHaveBeenCalled();
  });

  it('connects on ICE connected, starts the ongoing-call service, ends with metrics upload', async () => {
    const t = setup();
    await connectOutgoing(t);
    expect(t.phase()).toBe('connected');
    expect(t.native.startOngoing).toHaveBeenCalledWith('call-1', 'Arjun', true);

    await t.timers.advance(65_000);
    t.controller.hangup();
    expect(t.ws.requests.at(-1)).toEqual({
      type: 'call.hangup',
      data: { call_id: 'call-1', reason: 'completed' },
    });
    expect(t.phase()).toBe('ended');
    expect(t.store.getState().machine.endReason).toBe('completed');
    expect(t.pc()!.closed).toBe(true);
    expect(t.media.stop).toHaveBeenCalled();
    await flush();
    expect(t.api.postMetrics).toHaveBeenCalledWith(
      'call-1',
      expect.objectContaining({ duration_sec: 65, network_type: 'wifi', reconnects: 0 }),
    );
  });

  it('retries the metrics upload on transient failures', async () => {
    const t = setup();
    t.api.postMetrics.mockRejectedValueOnce(Object.assign(new Error('net'), { status: 0 }));
    await connectOutgoing(t);
    t.controller.hangup();
    await flush();
    expect(t.api.postMetrics).toHaveBeenCalledTimes(1);
    await t.timers.advance(2_000);
    expect(t.api.postMetrics).toHaveBeenCalledTimes(2);
  });

  it('busy callee: ack with an ended call ends as busy', async () => {
    const t = setup();
    t.ws.responders['call.invite'] = async () => ({
      call: serverCall({ state: 'ended', end_reason: 'busy' }),
      ice_servers: ICE,
    });
    await t.controller.startOutgoing({ peer: peerUser, media: 'audio', conversationId: null });
    expect(t.store.getState().machine.endReason).toBe('busy');
    t.ws.emit('call.ended', { call_id: 'call-1', reason: 'busy' }); // follow-up event: no-op
    expect(t.store.getState().machine.endReason).toBe('busy');
  });

  it('caller already in a call: ack error busy', async () => {
    const t = setup();
    t.ws.responders['call.invite'] = async () => {
      throw Object.assign(new Error('busy'), { code: 'busy' });
    };
    await t.controller.startOutgoing({ peer: peerUser, media: 'audio', conversationId: null });
    expect(t.store.getState().machine.endReason).toBe('in_another_call');
  });

  it('permission denied never invites', async () => {
    const t = setup();
    t.media.ensurePermissions.mockResolvedValueOnce(false);
    await t.controller.startOutgoing({ peer: peerUser, media: 'video', conversationId: null });
    expect(t.store.getState().machine.endReason).toBe('permission_denied');
    expect(t.ws.types()).not.toContain('call.invite');
  });

  it('cancelling while ringing sends hangup{cancelled}', async () => {
    const t = setup();
    t.ws.responders['call.invite'] = async () => ({ call: serverCall(), ice_servers: ICE });
    await t.controller.startOutgoing({ peer: peerUser, media: 'audio', conversationId: null });
    t.controller.hangup();
    expect(t.ws.requests.at(-1)).toEqual({
      type: 'call.hangup',
      data: { call_id: 'call-1', reason: 'cancelled' },
    });
    expect(t.api.postMetrics).not.toHaveBeenCalled();
  });
});

describe('CallController — incoming', () => {
  function ring(t: ReturnType<typeof setup>, id = 'call-9') {
    t.ws.emit('call.incoming', {
      call: serverCall({ id, caller_id: 'peer-1', callee_id: 'me', media: 'audio' }),
      caller: peerUser,
      ice_servers: ICE,
    });
  }

  it('rings, reports call.ringing, and plays the ringtone', () => {
    const t = setup();
    ring(t);
    expect(t.phase()).toBe('incoming');
    expect(t.ws.sent).toContainEqual({ type: 'call.ringing', data: { call_id: 'call-9' } });
    expect(t.audio.startRingtone).toHaveBeenCalled();
  });

  it('backgrounded Android app rings through the full-screen notification, not audio', () => {
    const showIncoming = jest.fn();
    const t = setup({
      native: { ...nullCallNativeBridge, available: true, showIncoming },
      isAppActive: () => false,
    });
    ring(t);
    expect(showIncoming).toHaveBeenCalledWith(
      expect.objectContaining({ call_id: 'call-9', caller_name: 'Arjun', media: 'audio' }),
    );
    expect(t.audio.startRingtone).not.toHaveBeenCalled();
    expect(t.store.getState().nativeRinging).toBe(true);
  });

  it('buffers signals that race ahead of the accept ack and applies them in order', async () => {
    const t = setup();
    ring(t);
    let resolveAck!: (v: unknown) => void;
    t.ws.responders['call.accept'] = () => new Promise((r) => (resolveAck = r));
    const accepting = t.controller.accept();
    await flush();
    // The caller got call.accepted first and already sent its offer + candidates.
    t.ws.emit('call.signal', {
      call_id: 'call-9',
      signal: { type: 'candidate', candidate: { candidate: 'c1', sdpMid: '0', sdpMLineIndex: 0 } },
    });
    t.ws.emit('call.signal', { call_id: 'call-9', signal: { type: 'offer', sdp: 'v=0\r\n' } });
    t.ws.emit('call.signal', {
      call_id: 'call-9',
      signal: { type: 'candidate', candidate: { candidate: 'c2', sdpMid: '0', sdpMLineIndex: 0 } },
    });
    await flush();
    expect(FakePeerConnection.instances).toHaveLength(0);

    resolveAck({ call: serverCall({ id: 'call-9', state: 'active' }), ice_servers: ICE });
    await accepting;
    await flush(20);
    expect(t.pc()!.log).toEqual([
      'setRemote:offer',
      'addIce:c1',
      'createAnswer',
      'setLocal:answer',
      'addIce:c2',
    ]);
    expect(t.ws.signals()).toContainEqual({ type: 'answer', sdp: 'v=0\r\na=x-answer\r\n' });
    expect(t.audio.stopRingtone).toHaveBeenCalled();
  });

  it('accept after the caller cancelled (call_not_found) ends as cancelled', async () => {
    const t = setup();
    ring(t);
    t.ws.responders['call.accept'] = async () => {
      throw Object.assign(new Error('gone'), { code: 'call_not_found' });
    };
    await t.controller.accept();
    expect(t.store.getState().machine.endReason).toBe('cancelled');
    expect(FakePeerConnection.instances).toHaveLength(0);
  });

  it('answered on another device: call.accepted with another session ends silently', () => {
    const t = setup();
    ring(t);
    t.ws.emit('call.accepted', { call_id: 'call-9', session_id: 'sess-other' });
    expect(t.store.getState().machine.endReason).toBe('answered_elsewhere');
    t.ws.emit('call.ended', { call_id: 'call-9', reason: 'answered_elsewhere' });
    expect(t.store.getState().machine.endReason).toBe('answered_elsewhere');
    expect(t.audio.stopRingtone).toHaveBeenCalled();
  });

  it('a second incoming call during a call is auto-declined as busy', async () => {
    const t = setup();
    await connectOutgoing(t);
    ring(t, 'call-2');
    expect(t.ws.requests.at(-1)).toEqual({ type: 'call.decline', data: { call_id: 'call-2' } });
    expect(t.store.getState().machine.callId).toBe('call-1');
    expect(t.phase()).toBe('connected');
  });

  it('declining sends call.decline', () => {
    const t = setup();
    ring(t);
    t.controller.decline();
    expect(t.ws.requests.at(-1)).toEqual({ type: 'call.decline', data: { call_id: 'call-9' } });
    expect(t.store.getState().machine.endReason).toBe('declined');
  });

  it('push + WS for the same call ring once; an expired push is ignored', () => {
    const t = setup();
    t.controller.handleIncomingPush(
      {
        call_id: 'call-9',
        caller_id: 'peer-1',
        caller_name: 'Arjun',
        media: 'audio',
        expires_at: new Date(t.timers.now() + 30_000).toISOString(),
      },
      { nativeRinging: false },
    );
    ring(t);
    expect(t.audio.startRingtone).toHaveBeenCalledTimes(1);

    const t2 = setup();
    t2.controller.handleIncomingPush(
      {
        call_id: 'x',
        caller_id: 'p',
        caller_name: '',
        media: 'audio',
        expires_at: new Date(0).toISOString(),
      },
      { nativeRinging: false },
    );
    expect(t2.phase()).toBe('idle');
  });

  it('cold start: a buffered native Answer accepts once the socket authenticates', async () => {
    const actions = [
      {
        action: 'answer' as const,
        callId: 'call-9',
        callerId: 'peer-1',
        callerName: 'Arjun',
        media: 'audio',
        expiresAt: '',
      },
    ];
    const t = setup({
      native: { ...nullCallNativeBridge, consumePendingActions: () => actions.splice(0) },
    });
    t.api.getCall.mockResolvedValue(serverCall({ id: 'call-9', state: 'ringing' }));
    t.ws.responders['call.accept'] = async () => ({
      call: serverCall({ id: 'call-9', state: 'active' }),
      ice_servers: ICE,
    });
    t.ws.authenticate(false);
    await flush(20);
    expect(t.ws.types()).toContain('call.accept');
    expect(t.phase()).toBe('connecting');
    expect(FakePeerConnection.instances).toHaveLength(1);
  });

  it('the ring safety timer ends a call whose timeout event was lost', async () => {
    const t = setup();
    ring(t);
    await t.timers.advance(56_000);
    expect(t.store.getState().machine.endReason).toBe('missed');
  });
});

describe('CallController — resilience & quality', () => {
  it('ICE restart after the WebSocket reconnects within the grace window', async () => {
    const t = setup();
    await connectOutgoing(t);
    const before = t.ws.signals().length;
    t.ws.authenticate(true);
    await flush(20);
    expect(t.api.getCall).toHaveBeenCalledWith('call-1');
    const after = t.ws.signals().slice(before);
    expect(after).toEqual([expect.objectContaining({ type: 'offer', iceRestart: true })]);
  });

  it('after a reconnect, a call the server already ended is closed with its reason', async () => {
    const t = setup();
    await connectOutgoing(t);
    t.api.getCall.mockResolvedValueOnce(serverCall({ state: 'ended', end_reason: 'failed' }));
    t.ws.authenticate(true);
    await flush(20);
    expect(t.store.getState().machine.endReason).toBe('failed');
  });

  it('ICE drop shows reconnecting, counts a reconnect and recovers', async () => {
    const t = setup();
    await connectOutgoing(t);
    t.pc()!.setIceState('disconnected');
    expect(t.phase()).toBe('reconnecting');
    t.pc()!.setIceState('connected');
    expect(t.phase()).toBe('connected');
    expect(t.store.getState().machine.reconnects).toBe(1);
  });

  it('gives up after 30 s without media', async () => {
    const t = setup();
    await connectOutgoing(t);
    t.pc()!.setIceState('disconnected');
    await t.timers.advance(31_000);
    expect(t.store.getState().machine.endReason).toBe('failed');
    expect(t.ws.requests.at(-1)).toEqual({
      type: 'call.hangup',
      data: { call_id: 'call-1', reason: 'failed' },
    });
  });

  it('applies the peer quality request live via setParameters', async () => {
    const t = setup();
    await connectOutgoing(t);
    t.ws.emit('call.signal', {
      call_id: 'call-1',
      signal: { type: 'quality', video: '240p', audio: 'low' },
    });
    await flush();
    const video = t.pc()!.senders.find((s) => s.track?.kind === 'video')!;
    expect(video.params.encodings[0]).toMatchObject({
      maxBitrate: 300_000,
      maxFramerate: 20,
      scaleResolutionDownBy: 3,
    });
    const audio = t.pc()!.senders.find((s) => s.track?.kind === 'audio')!;
    expect(audio.params.encodings[0]).toMatchObject({ maxBitrate: 16_000 });
    expect(t.store.getState().sendDecision?.video.tier).toBe('240p');
  });

  it('sends my receive preference to the peer', async () => {
    const t = setup();
    await connectOutgoing(t);
    t.controller.setVideoPreference('480p');
    await flush();
    expect(t.ws.signals().at(-1)).toEqual({ type: 'quality', video: '480p', audio: 'auto' });
  });

  it('mute / camera toggles flip tracks and publish call.media_state', async () => {
    const t = setup();
    await connectOutgoing(t);
    t.controller.toggleMute();
    t.controller.toggleCamera();
    expect(t.ws.sent.filter((s) => s.type === 'call.media_state').at(-1)).toEqual({
      type: 'call.media_state',
      data: { call_id: 'call-1', audio_muted: true, video_enabled: false },
    });
    t.ws.emit('call.media_state', {
      call_id: 'call-1',
      user_id: 'peer-1',
      audio_muted: true,
      video_enabled: false,
    });
    expect(t.store.getState()).toMatchObject({ remoteAudioMuted: true, remoteVideoEnabled: false });
  });

  it('samples stats every 2 s into the store', async () => {
    const t = setup();
    await connectOutgoing(t);
    t.pc()!.statsReport = new Map([
      [
        'p',
        {
          id: 'p',
          type: 'candidate-pair',
          selected: true,
          currentRoundTripTime: 0.05,
          availableOutgoingBitrate: 2_000_000,
          timestamp: 1,
        },
      ],
    ]);
    await t.timers.advance(2_000);
    expect(t.store.getState().stats?.rttMs).toBeCloseTo(50);
    expect(t.store.getState().networkLevel).toBe(4);
  });

  it('ended twice / late events after hang-up are harmless', async () => {
    const t = setup();
    await connectOutgoing(t);
    t.ws.emit('call.ended', { call_id: 'call-1', reason: 'completed' });
    t.ws.emit('call.ended', { call_id: 'call-1', reason: 'failed' });
    t.ws.emit('call.signal', { call_id: 'call-1', signal: { type: 'renegotiate' } });
    expect(t.store.getState().machine.endReason).toBe('completed');
    t.controller.dismissEnded();
    expect(t.phase()).toBe('idle');
  });
});
