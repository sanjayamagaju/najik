import type { CallSignal } from '@/types/protocol';

import { PeerSession } from '../PeerSession';
import {
  FakePeerConnection,
  FakeStream,
  FakeTrack,
  fakeLocalStream,
  flush,
  ManualTimers,
} from '../testing/fakes';

function setup(
  role: 'caller' | 'callee',
  overrides: Partial<ConstructorParameters<typeof PeerSession>[0]> = {},
) {
  const sent: CallSignal[] = [];
  const timers = new ManualTimers();
  let pc!: FakePeerConnection;
  let dtx = false;
  const session = new PeerSession({
    role,
    iceServers: [{ urls: ['stun:stun.example.com'] }],
    createPeerConnection: (config) => {
      pc = new FakePeerConnection(config);
      return pc;
    },
    sendSignal: async (signal) => {
      sent.push(signal);
    },
    getOpusParams: () => ({ fec: true, dtx, stereo: false }),
    timers,
    ...overrides,
  });
  return {
    session,
    pc: () => pc,
    sent,
    timers,
    setDtx: (v: boolean) => {
      dtx = v;
    },
  };
}

const candidate = (c: string): CallSignal => ({
  type: 'candidate',
  candidate: { candidate: c, sdpMid: '0', sdpMLineIndex: 0 },
});

describe('PeerSession — negotiation order', () => {
  it('configures the PeerConnection with the ack ICE servers (max-bundle)', () => {
    const { pc } = setup('caller');
    expect(pc().config).toMatchObject({
      iceServers: [{ urls: ['stun:stun.example.com'] }],
      bundlePolicy: 'max-bundle',
    });
  });

  it('caller: createOffer → setLocal → send offer', async () => {
    const { session, pc, sent } = setup('caller');
    session.addLocalStream(fakeLocalStream(true));
    await session.startOffer();
    expect(pc().log).toEqual(['createOffer', 'setLocal:offer']);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'offer' });
    expect(sent[0]).not.toHaveProperty('iceRestart');
  });

  it('callee: queues candidates that arrive before the offer, then answers and flushes in order', async () => {
    const { session, pc, sent } = setup('callee');
    await session.handleSignal(candidate('c1'));
    await session.handleSignal(candidate('c2'));
    expect(session.queuedCandidateCount).toBe(2);
    expect(pc().candidates).toHaveLength(0);

    await session.handleSignal({ type: 'offer', sdp: 'v=0\r\na=rtpmap:111 opus/48000/2\r\n' });
    expect(pc().log).toEqual([
      'setRemote:offer',
      'addIce:c1',
      'addIce:c2',
      'createAnswer',
      'setLocal:answer',
    ]);
    expect(session.queuedCandidateCount).toBe(0);
    expect(sent).toEqual([{ type: 'answer', sdp: 'v=0\r\na=x-answer\r\n' }]);

    await session.handleSignal(candidate('c3'));
    expect(pc().log.at(-1)).toBe('addIce:c3');
  });

  it('munges Opus FEC/DTX into the remote description before applying it', async () => {
    const { session, pc, setDtx } = setup('callee');
    setDtx(true);
    await session.handleSignal({ type: 'offer', sdp: 'v=0\r\na=rtpmap:111 opus/48000/2\r\n' });
    expect(pc().remoteDescription?.sdp).toContain('a=fmtp:111 useinbandfec=1;usedtx=1;stereo=0');
    setDtx(false);
    expect(session.needsDtxRenegotiation()).toBe(true);
  });

  it('caller: ignores offers (glare-free) and stale answers', async () => {
    const { session, pc, sent } = setup('caller');
    await session.handleSignal({ type: 'offer', sdp: 'x' });
    await session.handleSignal({ type: 'answer', sdp: 'x' }); // no offer outstanding
    expect(pc().log).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('caller: coalesces an offer requested mid-negotiation and sends it after the answer', async () => {
    const { session, pc, sent } = setup('caller');
    await session.startOffer();
    await session.startOffer({ iceRestart: true }); // have-local-offer + restart → rollback path
    expect(pc().log).toContain('setLocal:rollback');

    const { session: s2, pc: pc2, sent: sent2 } = setup('caller');
    await s2.startOffer();
    await s2.startOffer(); // plain renegotiation while waiting: coalesced
    expect(sent2.filter((s) => s.type === 'offer')).toHaveLength(1);
    await s2.handleSignal({ type: 'answer', sdp: 'v=0\r\n' });
    await flush();
    expect(sent2.filter((s) => s.type === 'offer')).toHaveLength(2);
    expect(pc2().log).toEqual([
      'createOffer',
      'setLocal:offer',
      'setRemote:answer',
      'createOffer',
      'setLocal:offer',
    ]);
    expect(sent.length).toBeGreaterThan(0);
  });

  it('callee asks the caller to renegotiate instead of offering', async () => {
    const { session, sent } = setup('callee');
    await session.startOffer();
    expect(sent).toEqual([{ type: 'renegotiate' }]);
  });

  it('caller answers a renegotiate request with an offer (ICE restart only when broken)', async () => {
    const { session, pc, sent } = setup('caller');
    await session.handleSignal({ type: 'renegotiate' });
    expect(sent.at(-1)).toMatchObject({ type: 'offer' });
    expect(sent.at(-1)).not.toHaveProperty('iceRestart');
    await session.handleSignal({ type: 'answer', sdp: 'v=0\r\n' });
    pc().iceConnectionState = 'failed';
    await session.handleSignal({ type: 'renegotiate' });
    expect(sent.at(-1)).toMatchObject({ type: 'offer', iceRestart: true });
  });

  it('sends local candidates with optional usernameFragment only when present', () => {
    const { pc, sent } = setup('caller');
    pc().emitLocalCandidate('cand-a');
    pc().emitLocalCandidate('cand-b', 'ufrag1');
    pc().emit('icecandidate', { candidate: null }); // end of candidates
    expect(sent).toEqual([
      { type: 'candidate', candidate: { candidate: 'cand-a', sdpMid: '0', sdpMLineIndex: 0 } },
      {
        type: 'candidate',
        candidate: {
          candidate: 'cand-b',
          sdpMid: '0',
          sdpMLineIndex: 0,
          usernameFragment: 'ufrag1',
        },
      },
    ]);
  });

  it('reports the remote stream once', () => {
    const onRemoteStream = jest.fn();
    const { pc } = setup('caller', { onRemoteStream });
    const remote = new FakeStream('remote', [
      new FakeTrack('ra', 'audio'),
      new FakeTrack('rv', 'video'),
    ]);
    pc().emitRemoteTrack(remote);
    pc().emitRemoteTrack(remote);
    expect(onRemoteStream).toHaveBeenCalledTimes(1);
  });
});

describe('PeerSession — ICE restart', () => {
  it('restarts immediately on failed (caller: refreshes servers, re-offers with iceRestart)', async () => {
    const refresh = jest
      .fn()
      .mockResolvedValue([{ urls: ['turn:new'], username: 'u', credential: 'c' }]);
    const { pc, sent } = setup('caller', { refreshIceServers: refresh });
    pc().setIceState('failed');
    await flush();
    expect(refresh).toHaveBeenCalled();
    expect(pc().configuration).toEqual({
      iceServers: [{ urls: ['turn:new'], username: 'u', credential: 'c' }],
    });
    expect(sent.at(-1)).toMatchObject({ type: 'offer', iceRestart: true });
  });

  it('waits out a transient disconnect before restarting', async () => {
    const { pc, sent, timers } = setup('caller');
    pc().setIceState('disconnected');
    await timers.advance(2_000);
    pc().setIceState('connected');
    await timers.advance(5_000);
    expect(sent).toEqual([]);

    pc().setIceState('disconnected');
    await timers.advance(2_600);
    expect(sent.at(-1)).toMatchObject({ type: 'offer', iceRestart: true });
  });

  it('rate-limits restarts and coalesces bursts into one delayed restart', async () => {
    const { session, sent, timers } = setup('caller');
    await session.restartIce('ws_reconnect');
    await session.handleSignal({ type: 'answer', sdp: 'v=0\r\n' });
    await session.restartIce('network_change');
    await session.restartIce('network_change');
    expect(sent.filter((s) => s.type === 'offer')).toHaveLength(1);
    await timers.advance(3_000);
    expect(sent.filter((s) => s.type === 'offer')).toHaveLength(2);
  });

  it('callee restart = renegotiate request', async () => {
    const { session, sent } = setup('callee');
    await session.restartIce('ws_reconnect');
    expect(sent).toEqual([{ type: 'renegotiate' }]);
  });

  it('close() stops everything and is idempotent', async () => {
    const { session, pc, sent, timers } = setup('caller');
    pc().setIceState('disconnected');
    session.close();
    session.close();
    await timers.advance(10_000);
    expect(pc().closed).toBe(true);
    expect(sent).toEqual([]);
    await session.handleSignal(candidate('late'));
    expect(pc().candidates).toEqual([]);
  });
});

describe('PeerSession — encodings', () => {
  it('applies video params with setParameters (no renegotiation)', async () => {
    const { session, pc } = setup('caller');
    session.addLocalStream(fakeLocalStream(true));
    await session.applyVideoEncoding({
      tier: '360p',
      maxBitrate: 550_000,
      maxFramerate: 24,
      scaleResolutionDownBy: 2,
    });
    const video = pc().senders.find((s) => s.track?.kind === 'video')!;
    expect(video.params).toEqual({
      encodings: [
        { active: true, maxBitrate: 550_000, maxFramerate: 24, scaleResolutionDownBy: 2 },
      ],
      degradationPreference: 'balanced',
    });
    expect(pc().log).toEqual([]);
  });

  it('applies the Opus bitrate with high priority on the audio sender', async () => {
    const { session, pc } = setup('caller');
    session.addLocalStream(fakeLocalStream(false));
    await session.applyAudioEncoding({
      preset: 'medium',
      maxBitrate: 32_000,
      dtx: false,
      fec: true,
    });
    const audio = pc().senders[0]!;
    expect(audio.params.encodings[0]).toMatchObject({ maxBitrate: 32_000, priority: 'high' });
    expect(
      await session.applyVideoEncoding({
        tier: '720p',
        maxBitrate: 1,
        maxFramerate: 1,
        scaleResolutionDownBy: 1,
      }),
    ).toBe(false);
  });
});
