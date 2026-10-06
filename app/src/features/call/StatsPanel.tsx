import { motion } from 'motion/react';
import type { CallStats, StreamStats } from '../../webrtc/stats';

const kbps = (v: number | null | undefined) =>
  v == null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(1)} Mbps` : `${Math.round(v)} kbps`;

const video = (s: StreamStats | null) =>
  !s || !s.width ? '—' : `${s.width}×${s.height} · ${Math.round(s.fps ?? 0)}fps · ${kbps(s.kbps)}${s.codec ? ` · ${s.codec}` : ''}`;

export function StatsPanel({ stats, onClose }: { stats: CallStats | null; onClose: () => void }) {
  const rows: [string, string][] = stats
    ? [
        ['Round trip', stats.rttMs == null ? '—' : `${stats.rttMs} ms`],
        ['Loss ↑ / ↓', `${(stats.outLoss * 100).toFixed(1)}% / ${(stats.inLoss * 100).toFixed(1)}%`],
        ['Bandwidth ↑', kbps(stats.availableOutKbps)],
        ['Jitter', stats.jitterMs == null ? '—' : `${stats.jitterMs} ms`],
        ['Route', stats.relayed ? 'Relayed (TURN)' : 'Direct (P2P)'],
        ['Video ↑', video(stats.outVideo)],
        ['Video ↓', video(stats.inVideo)],
        ['Audio ↑ / ↓', `${kbps(stats.outAudio?.kbps)} / ${kbps(stats.inAudio?.kbps)}`],
        ['Limited by', stats.qualityLimitation],
      ]
    : [];

  return (
    <motion.div
      style={{ x: '-50%' }}
      initial={{ opacity: 0, y: -10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 500, damping: 34 }}
      onClick={onClose}
      className="absolute top-full left-1/2 z-30 mt-2 w-[min(92vw,340px)] origin-top rounded-2xl border border-white/10 bg-black/60 p-3.5 text-[11.5px] text-white/90 backdrop-blur-xl"
    >
      <p className="mb-2 text-[10px] font-bold tracking-[0.14em] text-white/50 uppercase">Connection details</p>
      {stats ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-white/50">{k}</dt>
              <dd className="truncate text-right">{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-white/60">Gathering stats…</p>
      )}
    </motion.div>
  );
}
