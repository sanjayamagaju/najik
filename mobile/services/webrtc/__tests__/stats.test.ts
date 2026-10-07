import { iceServersExpiry, iceServersStale, IceServerStore, toRtcIceServers } from '../iceServers';
import { mungeOpus, opusDtxEnabled } from '../sdp';
import { MetricsAggregator } from '../stats/metricsAggregator';
import {
  networkQualityLevel,
  normalizeStats,
  type RawStat,
  toQualitySample,
} from '../stats/normalizeStats';

/** Shape of a libwebrtc stats report as react-native-webrtc returns it (Map id → stats). */
function report(t: number, o: { sent: number; recv: number; lost: number; got: number }) {
  const entries: [string, RawStat][] = [
    ['T01', { id: 'T01', type: 'transport', timestamp: t, selectedCandidatePairId: 'CP1' }],
    [
      'CP1',
      {
        id: 'CP1',
        type: 'candidate-pair',
        timestamp: t,
        state: 'succeeded',
        nominated: true,
        currentRoundTripTime: 0.084,
        availableOutgoingBitrate: 1_450_000,
        localCandidateId: 'LC1',
      },
    ],
    ['CP2', { id: 'CP2', type: 'candidate-pair', timestamp: t, state: 'failed' }],
    ['LC1', { id: 'LC1', type: 'local-candidate', timestamp: t, candidateType: 'relay' }],
    [
      'OV',
      {
        id: 'OV',
        type: 'outbound-rtp',
        kind: 'video',
        timestamp: t,
        bytesSent: o.sent,
        frameWidth: 854,
        frameHeight: 480,
        framesPerSecond: 29,
        qualityLimitationReason: 'bandwidth',
      },
    ],
    ['OA', { id: 'OA', type: 'outbound-rtp', mediaType: 'audio', timestamp: t, bytesSent: 0 }],
    [
      'IV',
      {
        id: 'IV',
        type: 'inbound-rtp',
        kind: 'video',
        timestamp: t,
        bytesReceived: o.recv,
        packetsLost: o.lost,
        packetsReceived: o.got,
        jitter: 0.012,
        frameWidth: 1280,
        frameHeight: 720,
        framesPerSecond: 30,
      },
    ],
    [
      'IA',
      {
        id: 'IA',
        type: 'inbound-rtp',
        kind: 'audio',
        timestamp: t,
        bytesReceived: 0,
        packetsLost: 0,
        packetsReceived: 0,
        jitter: 0.02,
      },
    ],
    [
      'RIV',
      {
        id: 'RIV',
        type: 'remote-inbound-rtp',
        kind: 'video',
        timestamp: t,
        fractionLost: 0.03,
        roundTripTime: 0.09,
      },
    ],
  ];
  return new Map(entries);
}

describe('normalizeStats', () => {
  it('extracts RTT, bandwidth estimate, resolution and limitation from the selected pair', () => {
    const { stats } = normalizeStats(report(1000, { sent: 0, recv: 0, lost: 0, got: 0 }), null, 0);
    expect(stats.rttMs).toBeCloseTo(84);
    expect(stats.availableOutgoingBitrate).toBe(1_450_000);
    expect(stats.outboundVideo).toEqual({ width: 854, height: 480, fps: 29 });
    expect(stats.inboundVideo).toEqual({ width: 1280, height: 720, fps: 30 });
    expect(stats.qualityLimitationReason).toBe('bandwidth');
    expect(stats.outboundLossPct).toBe(3);
    expect(stats.jitterMs).toBe(20); // max(video 12 ms, audio 20 ms)
    expect(stats.localCandidateType).toBe('relay');
    // Rates need two samples.
    expect(stats.outboundKbps).toBeNull();
    expect(stats.inboundLossPct).toBeNull();
  });

  it('computes bitrates and loss as deltas against the previous cursor', () => {
    const first = normalizeStats(report(1000, { sent: 0, recv: 0, lost: 0, got: 0 }), null, 0);
    const second = normalizeStats(
      report(3000, { sent: 250_000, recv: 500_000, lost: 10, got: 190 }),
      first.cursor,
      0,
    );
    expect(second.stats.outboundKbps).toBe(1000); // 250 kB × 8 / 2 s
    expect(second.stats.inboundKbps).toBe(2000);
    expect(second.stats.inboundLossPct).toBe(5);
  });

  it('skips negative deltas (counters reset after a restart)', () => {
    const first = normalizeStats(report(1000, { sent: 900, recv: 900, lost: 5, got: 50 }), null, 0);
    const second = normalizeStats(
      report(3000, { sent: 100, recv: 100, lost: 0, got: 10 }),
      first.cursor,
      0,
    );
    expect(second.stats.outboundKbps).toBeNull();
    expect(second.stats.inboundLossPct).toBeNull();
  });

  it('accepts arrays/objects and falls back to the nominated pair + remote RTT', () => {
    const { stats } = normalizeStats(
      [
        { id: 'p', type: 'candidate-pair', nominated: true, state: 'succeeded', timestamp: 5 },
        { id: 'r', type: 'remote-inbound-rtp', roundTripTime: 0.2, timestamp: 5 },
      ],
      null,
      0,
    );
    expect(stats.rttMs).toBeCloseTo(200);
    expect(stats.availableOutgoingBitrate).toBeNull();
    expect(normalizeStats({}, null, 42).stats.timestamp).toBe(42);
  });

  it('builds the uplink sample for the controller and a 0–4 network level', () => {
    const { stats } = normalizeStats(report(1000, { sent: 0, recv: 0, lost: 0, got: 0 }), null, 0);
    expect(toQualitySample(stats)).toEqual({
      availableOutgoingBitrate: 1_450_000,
      rttMs: stats.rttMs,
      lossPct: 3,
      jitterMs: null,
      qualityLimitationReason: 'bandwidth',
    });
    expect(networkQualityLevel(null)).toBe(4);
    expect(networkQualityLevel({ ...stats, outboundLossPct: 0, jitterMs: 5 })).toBe(4);
    expect(networkQualityLevel(stats)).toBe(3);
    expect(networkQualityLevel({ ...stats, rttMs: 900 })).toBe(1);
    expect(networkQualityLevel({ ...stats, inboundLossPct: 30 })).toBe(0);
  });
});

describe('MetricsAggregator', () => {
  it('averages samples and produces the PROTOCOL metrics body', () => {
    const agg = new MetricsAggregator();
    const base = normalizeStats(report(1000, { sent: 0, recv: 0, lost: 0, got: 0 }), null, 0).stats;
    agg.addSample({
      ...base,
      rttMs: 100,
      jitterMs: 10,
      inboundLossPct: 2,
      outboundKbps: 800,
      inboundKbps: 1200,
    });
    agg.addSample({
      ...base,
      rttMs: 200,
      jitterMs: 30,
      inboundLossPct: 4,
      outboundKbps: 600,
      inboundKbps: null,
    });
    agg.recordReconnect();
    agg.recordVideoQualityChange();
    agg.recordVideoQualityChange();
    expect(
      agg.summary({
        durationSec: 61.4,
        networkType: 'cellular-and-something-long',
        selectedVideo: '720p',
        selectedAudio: 'auto',
      }),
    ).toEqual({
      rtt_ms_avg: 150,
      jitter_ms_avg: 20,
      packet_loss_pct_avg: 3,
      bitrate_kbps_avg_up: 700,
      bitrate_kbps_avg_down: 1200,
      video_quality_changes: 2,
      reconnects: 1,
      duration_sec: 61,
      network_type: 'cellular-and-som',
      selected_video_quality: '720p',
      selected_audio_quality: 'auto',
    });
  });

  it('reports nulls when nothing was sampled', () => {
    const body = new MetricsAggregator().summary({
      durationSec: 0,
      networkType: 'wifi',
      selectedVideo: 'auto',
      selectedAudio: 'auto',
    });
    expect(body.rtt_ms_avg).toBeNull();
    expect(body.packet_loss_pct_avg).toBeNull();
    expect(body.reconnects).toBe(0);
  });
});

describe('SDP Opus munging', () => {
  const sdp = [
    'v=0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111 63',
    'a=rtpmap:111 opus/48000/2',
    'a=fmtp:111 minptime=10;useinbandfec=1',
    'a=rtpmap:63 red/48000/2',
    '',
  ].join('\r\n');

  it('sets FEC/DTX/stereo on existing fmtp, preserving other params and CRLF', () => {
    const out = mungeOpus(sdp, { fec: true, dtx: true, stereo: false });
    expect(out).toContain('a=fmtp:111 minptime=10;useinbandfec=1;usedtx=1;stereo=0\r\n');
    expect(out.split('\r\n')).toHaveLength(sdp.split('\r\n').length);
    expect(opusDtxEnabled(out)).toBe(true);
    expect(opusDtxEnabled(mungeOpus(out, { fec: true, dtx: false, stereo: false }))).toBe(false);
  });

  it('inserts an fmtp line when missing and leaves non-Opus SDP alone', () => {
    const lower = 'v=0\na=rtpmap:109 opus/48000/2\n';
    expect(mungeOpus(lower, { fec: true, dtx: false, stereo: false })).toContain(
      'a=fmtp:109 useinbandfec=1;usedtx=0;stereo=0',
    );
    expect(mungeOpus('v=0\r\nm=video 9\r\n', { fec: true, dtx: true, stereo: false })).toBe(
      'v=0\r\nm=video 9\r\n',
    );
  });
});

describe('ICE servers', () => {
  const servers = [
    { urls: ['stun:turn.example.com:3478'] },
    {
      urls: ['turn:turn.example.com:3478?transport=udp'],
      username: '2000000:user',
      credential: 'x',
    },
  ];

  it('reads the TURN REST expiry from the username', () => {
    expect(iceServersExpiry(servers)).toBe(2_000_000_000);
    expect(iceServersExpiry([{ urls: ['stun:x'] }])).toBeNull();
    expect(iceServersStale(servers, 2_000_000_000 - 10 * 60_000)).toBe(false);
    expect(iceServersStale(servers, 2_000_000_000 - 60_000)).toBe(true);
  });

  it('maps to RTCIceServer and drops empty entries', () => {
    expect(toRtcIceServers([...servers, { urls: [] }])).toEqual([
      { urls: ['stun:turn.example.com:3478'] },
      {
        urls: ['turn:turn.example.com:3478?transport=udp'],
        username: '2000000:user',
        credential: 'x',
      },
    ]);
  });

  it('refreshes stale credentials via GET /calls/ice-servers and keeps old ones on failure', async () => {
    let now = 2_000_000_000;
    const fresh = [{ urls: ['turn:new'], username: '9999999:user', credential: 'y' }];
    const fetchFresh = jest
      .fn()
      .mockResolvedValueOnce(fresh)
      .mockRejectedValueOnce(new Error('offline'));
    const store = new IceServerStore(fetchFresh, () => now);
    store.set(servers);
    expect(await store.ensureFresh()).toEqual({ servers: fresh, refreshed: true });
    now = 9_999_999_000;
    expect(await store.ensureFresh()).toEqual({ servers: fresh, refreshed: false });
    expect(fetchFresh).toHaveBeenCalledTimes(2);
  });
});
