import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useTransform } from 'motion/react';
import {
  ChevronDown,
  Mic,
  MicOff,
  PhoneOff,
  SlidersHorizontal,
  SwitchCamera,
  Volume2,
  VolumeX,
  Video,
  VideoOff,
  WifiOff,
} from 'lucide-react';
import { useCall } from '../../stores/call';
import { Avatar } from '../../components/Avatar';
import { IconButton } from '../../components/IconButton';
import { formatDuration } from '../../lib/utils';
import { useNow } from '../../lib/hooks';
import { networkScore } from '../../webrtc/stats';
import { callAudio } from '../../lib/callAudio';
import { useAudioLevel, VideoView } from './media';
import { NetworkBars } from './NetworkBars';
import { StatsPanel } from './StatsPanel';
import { QualitySheet } from './QualitySheet';

const HIDE_CONTROLS_MS = 4500;

export function CallScreen() {
  const s = useCall();
  const [qualityOpen, setQualityOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [controls, setControls] = useState(true);
  const hideTimer = useRef<number | undefined>(undefined);
  const constraints = useRef<HTMLDivElement>(null);
  const now = useNow(1000, s.phase === 'active');

  const remoteHasVideo = !!s.remoteStream?.getVideoTracks().length;
  const showRemoteVideo =
    s.media === 'video' && s.phase === 'active' && remoteHasVideo && s.peerCam && !s.peerSending?.videoPaused;
  const localHasVideo = !!s.localStream?.getVideoTracks().length;
  const score = networkScore(s.stats);

  // Auto-hide controls while watching video; any tap brings them back.
  const poke = () => {
    setControls(true);
    window.clearTimeout(hideTimer.current);
    if (showRemoteVideo && !qualityOpen) {
      hideTimer.current = window.setTimeout(() => setControls(false), HIDE_CONTROLS_MS);
    }
  };
  useEffect(() => {
    poke();
    return () => window.clearTimeout(hideTimer.current);
  }, [showRemoteVideo, qualityOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const statusText = (() => {
    switch (s.phase) {
      case 'outgoing':
        return s.ringing ? 'Ringing…' : 'Calling…';
      case 'connecting':
        return 'Connecting…';
      case 'active':
        if (s.link === 'reconnecting') return 'Reconnecting…';
        return formatDuration(Math.max(0, Math.floor((now - (s.startedAt ?? now)) / 1000)));
      case 'ended':
        return s.endedLabel ?? 'Call ended';
      default:
        return '';
    }
  })();

  const qualityBadge = (() => {
    if (s.media === 'video') {
      const v = s.peerSending?.videoPaused ? 'Audio only' : (s.peerSending?.video ?? '—');
      return s.videoPref === 'auto' ? `Auto · ${v}` : v;
    }
    const a = s.peerSending?.audio ?? 'high';
    return s.audioPref === 'auto' ? `Auto · ${a === 'high' ? 'HD voice' : a}` : `${a} audio`;
  })();

  return (
    <motion.div
      ref={constraints}
      className="fixed inset-0 z-[70] overflow-hidden bg-neutral-950 text-white select-none"
      initial={{ opacity: 0, scale: 1.04 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.92, borderRadius: 40, transition: { duration: 0.3 } }}
      transition={{ type: 'spring', stiffness: 260, damping: 30 }}
      onPointerDown={poke}
    >
      {/* ── Background: remote video or ambient avatar ── */}
      <AnimatePresence initial={false}>
        {showRemoteVideo ? (
          <motion.div key="video" className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <VideoView stream={s.remoteStream} className="h-full w-full" />
          </motion.div>
        ) : (
          <motion.div key="ambient" className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Ambient />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top & bottom scrims for legibility over video */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/60 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-black/70 to-transparent" />

      {/* ── Top bar ── */}
      <motion.div
        className="pt-safe absolute inset-x-0 top-0 z-40"
        animate={{ opacity: controls ? 1 : 0, y: controls ? 0 : -20 }}
        transition={{ duration: 0.25 }}
        style={{ pointerEvents: controls ? 'auto' : 'none' }}
      >
        <div className="relative flex items-start justify-between px-3 pt-3">
          <IconButton label="Minimise" variant="glass" size={42} onClick={() => s.setMinimized(true)}>
            <ChevronDown size={24} />
          </IconButton>
          <div className="relative flex flex-col items-center">
            {showRemoteVideo && <p className="text-[17px] font-bold drop-shadow">{s.peer?.displayName}</p>}
            <button
              onClick={() => setStatsOpen((o) => !o)}
              className="mt-0.5 flex items-center gap-2 rounded-full bg-black/25 px-3 py-1 text-[13px] font-medium tabular-nums backdrop-blur-md"
            >
              {s.phase === 'active' && <NetworkBars score={score} />}
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={s.phase === 'active' && s.link !== 'reconnecting' ? 'timer' : statusText}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.15 }}
                >
                  {statusText}
                </motion.span>
              </AnimatePresence>
            </button>
          </div>
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={() => setQualityOpen(true)}
            className="flex h-[42px] items-center gap-1.5 rounded-full bg-white/12 px-3 text-[12.5px] font-semibold backdrop-blur-xl"
          >
            <SlidersHorizontal size={15} />
            <span className="max-w-24 truncate capitalize">{qualityBadge}</span>
          </motion.button>
          <AnimatePresence>{statsOpen && <StatsPanel stats={s.stats} onClose={() => setStatsOpen(false)} />}</AnimatePresence>
        </div>
      </motion.div>

      {/* ── Centre identity (audio calls / no remote video) ── */}
      {!showRemoteVideo && <CentreIdentity />}

      {/* ── Peer state chips ── */}
      <div className="absolute inset-x-0 bottom-40 z-10 flex flex-col items-center gap-2">
        <AnimatePresence>
          {(s.link === 'reconnecting' || s.signalingLost) && s.phase === 'active' && (
            <Chip key="reconnect" icon={<WifiOff size={14} />}>
              Reconnecting…
            </Chip>
          )}
          {s.phase === 'active' && s.peerSending?.videoPaused && s.media === 'video' && (
            <Chip key="vpause" icon={<VideoOff size={14} />}>
              Video paused, weak connection
            </Chip>
          )}
          {s.phase === 'active' && !s.peerMic && (
            <Chip key="mute" icon={<MicOff size={14} />}>
              {s.peer?.displayName} is muted
            </Chip>
          )}
        </AnimatePresence>
      </div>

      {/* ── Local preview (draggable PiP) ── */}
      <AnimatePresence>
        {localHasVideo && s.phase !== 'ended' && (
          <motion.div
            key="pip"
            drag
            dragConstraints={constraints}
            dragElastic={0.15}
            dragMomentum
            whileDrag={{ scale: 1.05 }}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={
              s.phase === 'active'
                ? { opacity: 1, scale: 1, width: 112, height: 160, top: 76, right: 14 }
                : { opacity: 1, scale: 1, width: '100%', height: '100%', top: 0, right: 0 }
            }
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ type: 'spring', stiffness: 260, damping: 30 }}
            className={
              s.phase === 'active'
                ? 'absolute z-30 cursor-grab overflow-hidden rounded-[22px] bg-neutral-800 shadow-2xl ring-1 ring-white/15 active:cursor-grabbing'
                : 'absolute z-0 overflow-hidden'
            }
            style={{ touchAction: 'none' }}
            dragListener={s.phase === 'active'}
          >
            <VideoView stream={s.localStream} mirrored={s.facing === 'user'} className="h-full w-full" />
            <AnimatePresence>
              {!s.camOn && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 flex items-center justify-center bg-neutral-800/95"
                >
                  <VideoOff size={22} className="text-white/60" />
                </motion.div>
              )}
            </AnimatePresence>
            {s.phase !== 'active' && <div className="absolute inset-0 bg-black/45" />}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Controls ── */}
      <motion.div
        className="pb-safe absolute inset-x-0 bottom-0 z-20 flex justify-center"
        animate={{ opacity: controls ? 1 : 0, y: controls ? 0 : 40 }}
        transition={{ type: 'spring', stiffness: 400, damping: 36 }}
        style={{ pointerEvents: controls ? 'auto' : 'none' }}
      >
        <motion.div
          className="mb-8 flex items-center gap-3 rounded-[32px] bg-white/10 p-2.5 backdrop-blur-2xl"
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 24, delay: 0.1 }}
        >
          <IconButton label={s.micOn ? 'Mute' : 'Unmute'} variant={s.micOn ? 'glass' : 'glass-active'} size={56} onClick={s.toggleMic}>
            {s.micOn ? <Mic size={24} /> : <MicOff size={24} />}
          </IconButton>
          {s.media === 'video' && localHasVideo && (
            <IconButton
              label={s.camOn ? 'Turn camera off' : 'Turn camera on'}
              variant={s.camOn ? 'glass' : 'glass-active'}
              size={56}
              onClick={s.toggleCam}
            >
              {s.camOn ? <Video size={24} /> : <VideoOff size={24} />}
            </IconButton>
          )}
          {callAudio.supported && (
            <IconButton
              label={s.speakerOn ? 'Use earpiece' : 'Use speaker'}
              variant={s.speakerOn ? 'glass-active' : 'glass'}
              size={56}
              onClick={s.toggleSpeaker}
            >
              {s.speakerOn ? <Volume2 size={24} /> : <VolumeX size={24} />}
            </IconButton>
          )}
          {s.canSwitchCamera && (
            <IconButton label="Switch camera" variant="glass" size={56} onClick={() => void s.switchCamera()} disabled={!s.camOn}>
              <SwitchCamera size={24} />
            </IconButton>
          )}
          <IconButton label="End call" variant="danger" size={64} onClick={s.hangup} disabled={s.phase === 'ended'}>
            <motion.span animate={{ rotate: s.phase === 'ended' ? 135 : 0 }}>
              <PhoneOff size={26} />
            </motion.span>
          </IconButton>
        </motion.div>
      </motion.div>

      <QualitySheet open={qualityOpen} onClose={() => setQualityOpen(false)} />
    </motion.div>
  );
}

function Ambient() {
  const hue = useCall((s) => s.peer?.avatarHue ?? 260);
  return (
    <div className="absolute inset-0">
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(110% 70% at 50% 15%, hsl(${hue} 65% 30%) 0%, transparent 65%), radial-gradient(100% 60% at 50% 100%, hsl(${(hue + 60) % 360} 65% 20%) 0%, transparent 70%), #08080f`,
        }}
      />
      <div className="aurora opacity-35" />
    </div>
  );
}

/** Avatar with rings that breathe with the remote speaker's voice. */
function CentreIdentity() {
  const peer = useCall((s) => s.peer);
  const remoteStream = useCall((s) => s.remoteStream);
  const remoteVersion = useCall((s) => s.remoteVersion);
  const phase = useCall((s) => s.phase);
  const level = useAudioLevel(phase === 'active' ? remoteStream : null, remoteVersion);
  const ring1 = useTransform(level, [0, 1], [1, 1.35]);
  const ring2 = useTransform(level, [0, 1], [1, 1.7]);
  const glow = useTransform(level, [0, 1], [0.15, 0.6]);
  const waiting = phase === 'outgoing' || phase === 'connecting';

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center pb-24">
      <div className="relative flex items-center justify-center">
        {waiting &&
          [0, 0.8, 1.6].map((d) => (
            <span key={d} className="ring-pulse absolute h-40 w-40 rounded-full border border-white/35" style={{ animationDelay: `${d}s` }} />
          ))}
        <motion.span className="absolute h-40 w-40 rounded-full bg-white/10" style={{ scale: ring2, opacity: glow }} />
        <motion.span className="absolute h-40 w-40 rounded-full bg-white/15" style={{ scale: ring1, opacity: glow }} />
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 220, damping: 18 }}
        >
          <Avatar user={peer} size={160} />
        </motion.div>
      </div>
      <motion.h2
        className="mt-10 text-3xl font-extrabold tracking-tight"
        initial={{ y: 14, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.12 }}
      >
        {peer?.displayName}
      </motion.h2>
    </div>
  );
}

function Chip({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.9 }}
      className="flex items-center gap-2 rounded-full bg-black/45 px-3.5 py-1.5 text-[13px] font-medium backdrop-blur-xl"
    >
      {icon}
      {children}
    </motion.div>
  );
}
