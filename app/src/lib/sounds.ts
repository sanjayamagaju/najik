/**
 * All UI sounds are synthesised with WebAudio — no audio assets to ship,
 * and they stay crisp at any sample rate.
 */
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext({ latencyHint: 'interactive' });
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Call once from a user gesture so later sounds are allowed to play. */
export function unlockAudio(): void {
  audio();
}

function tone(freq: number, start: number, dur: number, gain = 0.18, type: OscillatorType = 'sine'): void {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + start;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export const sounds = {
  messageIn() {
    tone(880, 0, 0.12, 0.08);
    tone(1320, 0.07, 0.16, 0.06);
  },
  messageOut() {
    tone(660, 0, 0.08, 0.05, 'triangle');
  },
  ping() {
    [784, 988, 1175, 1568].forEach((f, i) => tone(f, i * 0.07, 0.35, 0.12, 'triangle'));
  },
  callEnd() {
    tone(620, 0, 0.18, 0.12);
    tone(440, 0.16, 0.3, 0.12);
  },
  connected() {
    tone(523, 0, 0.12, 0.1);
    tone(784, 0.1, 0.22, 0.1);
  },
};

/** Looping patterns (ringtone / ringback) that can be stopped. */
function loop(pattern: () => void, everyMs: number): () => void {
  pattern();
  const id = window.setInterval(pattern, everyMs);
  return () => window.clearInterval(id);
}

export function startRingtone(): () => void {
  return loop(() => {
    const notes = [659, 784, 988, 784, 659, 784, 988, 1175];
    notes.forEach((f, i) => tone(f, i * 0.13, 0.22, 0.14, 'triangle'));
  }, 2600);
}

export function startRingback(): () => void {
  return loop(() => {
    tone(440, 0, 0.9, 0.06);
    tone(480, 0, 0.9, 0.06);
  }, 3000);
}
