import { motion } from 'motion/react';
import { PhoneOff } from 'lucide-react';
import { useCall } from '../../stores/call';
import { Avatar } from '../../components/Avatar';
import { formatDuration } from '../../lib/utils';
import { useNow } from '../../lib/hooks';
import { VideoView } from './media';

/** Floating, draggable mini call window shown while browsing chats mid-call. */
export function MiniCall() {
  const s = useCall();
  const now = useNow(1000, s.phase === 'active');
  const video = s.media === 'video' && !!s.remoteStream?.getVideoTracks().length && s.peerCam && s.phase === 'active';
  const label =
    s.phase === 'active' ? formatDuration(Math.floor((now - (s.startedAt ?? now)) / 1000)) : s.phase === 'outgoing' ? 'Calling…' : 'Connecting…';

  return (
    <motion.div
      drag
      dragMomentum={false}
      dragElastic={0.2}
      dragConstraints={{ left: -window.innerWidth + 160, right: 0, top: -window.innerHeight + 260, bottom: 0 }}
      initial={{ opacity: 0, scale: 0.5, y: 40 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.5 }}
      transition={{ type: 'spring', stiffness: 380, damping: 28 }}
      whileDrag={{ scale: 1.06 }}
      className="pb-safe fixed right-4 bottom-24 z-[70] cursor-grab touch-none active:cursor-grabbing"
    >
      <div
        className="relative overflow-hidden rounded-[24px] bg-neutral-900 text-white shadow-2xl ring-1 ring-white/10"
        style={{ width: video ? 132 : 168, height: video ? 188 : 'auto' }}
        onClick={() => s.setMinimized(false)}
      >
        {video ? (
          <VideoView stream={s.remoteStream} className="h-full w-full" />
        ) : (
          <div className="flex items-center gap-3 p-3">
            <div className="relative">
              <span className="ring-pulse absolute inset-0 rounded-full bg-success/40" />
              <Avatar user={s.peer} size={40} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{s.peer?.displayName}</p>
              <p className="text-xs text-success tabular-nums">{label}</p>
            </div>
          </div>
        )}
        {video && (
          <span className="absolute top-2 left-2 rounded-full bg-black/45 px-2 py-0.5 text-[11px] font-medium tabular-nums backdrop-blur">
            {label}
          </span>
        )}
      </div>
      <motion.button
        whileTap={{ scale: 0.85 }}
        onClick={s.hangup}
        aria-label="End call"
        className="absolute -top-2 -right-2 flex h-9 w-9 items-center justify-center rounded-full bg-danger text-white shadow-lg"
      >
        <PhoneOff size={16} />
      </motion.button>
    </motion.div>
  );
}
