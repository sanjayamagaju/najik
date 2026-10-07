import { scaleDownFor, tierForBitrate, tierForHeight, videoSpec } from '../quality/ladder';
import { QualityController, type QualitySample } from '../quality/QualityController';

const good = (availableOutgoingBitrate: number | null = 10_000_000): QualitySample => ({
  availableOutgoingBitrate,
  rttMs: 60,
  lossPct: 0,
  jitterMs: 5,
  qualityLimitationReason: 'none',
});

const bad: QualitySample = {
  availableOutgoingBitrate: null,
  rttMs: 120,
  lossPct: 7, // ≥ 5 % ⇒ bad, < 15 % ⇒ not severe
  jitterMs: 10,
  qualityLimitationReason: 'none',
};

const severe = (availableOutgoingBitrate: number | null = null): QualitySample => ({
  availableOutgoingBitrate,
  rttMs: 1_200,
  lossPct: 25,
  jitterMs: 40,
  qualityLimitationReason: 'bandwidth',
});

const neutral: QualitySample = { ...good(), lossPct: 3 };

/** Burn the warm-up window with neutral-but-not-bad samples. */
function warm(qc: QualityController, n = 3): void {
  for (let i = 0; i < n; i++) qc.addSample(neutral);
}

describe('ladder helpers', () => {
  it('maps heights, bitrates and scale factors', () => {
    expect(tierForHeight(720)).toBe('720p');
    expect(tierForHeight(714)).toBe('720p');
    expect(tierForHeight(1080)).toBe('1080p');
    expect(tierForHeight(200)).toBe('144p');
    expect(tierForHeight(0)).toBeNull();
    expect(tierForBitrate(1_000_000)).toBe('480p');
    expect(tierForBitrate(10)).toBe('144p');
    expect(scaleDownFor('360p', 720)).toBe(2);
    expect(scaleDownFor('720p', 720)).toBe(1);
    expect(scaleDownFor('1080p', 720)).toBe(1); // never upscales
  });
});

describe('QualityController — Auto', () => {
  it('starts at 720p clamped by device and capture caps', () => {
    expect(new QualityController().decision().video.tier).toBe('720p');
    expect(new QualityController({ deviceCap: '480p' }).decision().video.tier).toBe('480p');
    expect(new QualityController({ captureHeight: 360 }).decision().video.tier).toBe('360p');
  });

  it('applies the preset encoding (bitrate, fps, scale from capture)', () => {
    const d = new QualityController({ captureHeight: 720, initialVideo: '360p' }).decision();
    expect(d.video).toEqual({
      tier: '360p',
      maxBitrate: 550_000,
      maxFramerate: 24,
      scaleResolutionDownBy: 2,
    });
    expect(d.audio).toEqual({ preset: 'high', maxBitrate: 64_000, dtx: false, fec: true });
  });

  it('downgrades fast: one bad sample is tolerated, two in a row step down', () => {
    const qc = new QualityController();
    warm(qc);
    expect(qc.addSample(bad).video.tier).toBe('720p');
    expect(qc.addSample(bad).video.tier).toBe('480p');
  });

  it('a good sample in between resets the bad streak', () => {
    const qc = new QualityController();
    warm(qc);
    qc.addSample(bad);
    qc.addSample(good());
    expect(qc.addSample(bad).video.tier).toBe('720p');
  });

  it('upgrades slowly: needs 10 good samples AND 1.3× headroom for the next tier', () => {
    const qc = new QualityController({ initialVideo: '480p', captureHeight: 1080 });
    warm(qc);
    const needed = videoSpec('720p').maxBitrate * 1.3;
    for (let i = 0; i < 9; i++) expect(qc.addSample(good(needed)).video.tier).toBe('480p');
    expect(qc.addSample(good(needed)).video.tier).toBe('720p');
  });

  it('does not upgrade without headroom, but upgrades as soon as headroom appears', () => {
    const qc = new QualityController({ initialVideo: '480p' });
    warm(qc);
    const short = videoSpec('720p').maxBitrate * 1.2;
    for (let i = 0; i < 12; i++) qc.addSample(good(short));
    expect(qc.decision().video.tier).toBe('480p');
    expect(qc.addSample(good(videoSpec('720p').maxBitrate * 1.3)).video.tier).toBe('720p');
  });

  it('never upgrades without a bandwidth estimate', () => {
    const qc = new QualityController({ initialVideo: '360p' });
    for (let i = 0; i < 30; i++) qc.addSample(good(null));
    expect(qc.decision().video.tier).toBe('360p');
  });

  it('never exceeds the device cap (low-end → 480p) or the capture resolution', () => {
    const low = new QualityController({
      deviceCap: '480p',
      initialVideo: '480p',
      captureHeight: 1080,
    });
    for (let i = 0; i < 40; i++) low.addSample(good());
    expect(low.decision().video.tier).toBe('480p');

    const cam = new QualityController({ initialVideo: '480p', captureHeight: 720 });
    for (let i = 0; i < 40; i++) cam.addSample(good());
    expect(cam.decision().video.tier).toBe('720p');
  });

  it('severe congestion jumps straight to a tier that fits the estimate', () => {
    const qc = new QualityController({ captureHeight: 1080, initialVideo: '1080p' });
    warm(qc);
    qc.addSample(severe(400_000));
    // 400 kbps × 0.85 = 340 kbps ⇒ 240p (300 kbps)
    expect(qc.addSample(severe(400_000)).video.tier).toBe('240p');
  });

  it('ignores bitrate-only badness during BWE warm-up', () => {
    const qc = new QualityController();
    const lowEstimate = { ...good(), availableOutgoingBitrate: 300_000 };
    expect(qc.addSample(lowEstimate).video.tier).toBe('720p');
    expect(qc.addSample(lowEstimate).video.tier).toBe('720p');
    expect(qc.addSample(lowEstimate).video.tier).toBe('720p');
    qc.addSample(lowEstimate);
    expect(qc.addSample(lowEstimate).video.tier).not.toBe('720p');
  });

  it('treats cpu/bandwidth quality limitation as bad', () => {
    const qc = new QualityController();
    warm(qc);
    const cpu = { ...good(), qualityLimitationReason: 'cpu' as const };
    expect(qc.grade(cpu)).toBe('bad');
    qc.addSample(cpu);
    expect(qc.addSample(cpu).video.tier).toBe('480p');
  });

  it('pauses video grading while the camera is off', () => {
    const qc = new QualityController();
    warm(qc);
    qc.setVideoActive(false);
    qc.addSample(bad);
    qc.addSample(bad);
    expect(qc.decision().video.tier).toBe('720p');
  });

  it('counts applied tier changes for metrics', () => {
    const qc = new QualityController();
    warm(qc);
    qc.addSample(bad);
    qc.addSample(bad);
    qc.addSample(bad);
    qc.addSample(bad);
    expect(qc.videoTierChanges).toBe(2);
  });
});

describe('QualityController — peer requested caps', () => {
  it('applies min(requested cap, Auto) — a lower request caps immediately', () => {
    const qc = new QualityController();
    const d = qc.setRemotePreference('360p', 'auto');
    expect(d.video.tier).toBe('360p');
    expect(d.videoCap).toBe('360p');
    expect(d.autoLimited).toBe(false);
  });

  it('a manual request jumps to the requested tier, bounded by device/capture caps', () => {
    const qc = new QualityController({ initialVideo: '360p', captureHeight: 720 });
    expect(qc.setRemotePreference('1080p', 'auto').video.tier).toBe('720p');
    expect(qc.decision().autoLimited).toBe(false); // capped by capture, not by the network
  });

  it('holds a manual cap through ordinary congestion', () => {
    const qc = new QualityController();
    qc.setRemotePreference('720p', 'auto');
    warm(qc);
    for (let i = 0; i < 6; i++) qc.addSample(bad);
    expect(qc.decision().video.tier).toBe('720p');
    expect(qc.decision().autoLimited).toBe(false);
  });

  it('undercuts a manual cap under severe congestion (Auto-limited) and recovers', () => {
    const qc = new QualityController({ captureHeight: 720 });
    qc.setRemotePreference('720p', 'auto');
    warm(qc);
    qc.addSample(severe());
    const limited = qc.addSample(severe());
    expect(limited.video.tier).toBe('480p');
    expect(limited.autoLimited).toBe(true);

    for (let i = 0; i < 10; i++) qc.addSample(good());
    const recovered = qc.decision();
    expect(recovered.video.tier).toBe('720p');
    expect(recovered.autoLimited).toBe(false);
  });

  it('back to "auto" keeps the current tier and resumes Auto rules', () => {
    const qc = new QualityController();
    qc.setRemotePreference('360p', 'auto');
    const d = qc.setRemotePreference('auto', 'auto');
    expect(d.video.tier).toBe('360p');
    expect(d.remoteVideoPref).toBe('auto');
  });
});

describe('QualityController — audio presets', () => {
  it('maps presets to Opus bitrate / DTX / FEC', () => {
    const qc = new QualityController();
    expect(qc.setRemotePreference('auto', 'medium').audio).toEqual({
      preset: 'medium',
      maxBitrate: 32_000,
      dtx: false,
      fec: true,
    });
    expect(qc.setRemotePreference('auto', 'low').audio).toEqual({
      preset: 'low',
      maxBitrate: 16_000,
      dtx: true,
      fec: true,
    });
  });

  it('Auto audio steps down on a starved uplink and back up slowly with headroom', () => {
    const qc = new QualityController();
    warm(qc);
    const starved = { ...good(), availableOutgoingBitrate: 80_000 };
    qc.addSample(starved);
    expect(qc.addSample(starved).audio.preset).toBe('medium');
    qc.addSample(starved);
    expect(qc.addSample(starved).audio.preset).toBe('low');
    for (let i = 0; i < 10; i++) qc.addSample(good(10_000_000));
    expect(qc.decision().audio.preset).toBe('medium');
    for (let i = 0; i < 10; i++) qc.addSample(good(10_000_000));
    expect(qc.decision().audio.preset).toBe('high');
  });

  it('a manual audio request is honoured and only undercut when severe', () => {
    const qc = new QualityController();
    qc.setRemotePreference('auto', 'high');
    warm(qc);
    const lossy = { ...good(), lossPct: 12 };
    qc.addSample(lossy);
    qc.addSample(lossy);
    expect(qc.decision().audio.preset).toBe('high');
    qc.addSample(severe());
    const d = qc.addSample(severe());
    expect(d.audio.preset).toBe('medium');
    expect(d.audioAutoLimited).toBe(true);
  });
});
