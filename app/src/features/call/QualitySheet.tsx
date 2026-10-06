import { motion } from 'motion/react';
import { Check } from 'lucide-react';
import { Sheet } from '../../components/Sheet';
import { useCall } from '../../stores/call';
import { AUDIO_LEVELS, VIDEO_LEVELS, videoIndex, type AudioPref, type VideoPref } from '../../webrtc/quality';
import { cn } from '../../lib/utils';
import { haptic } from '../../lib/native';

const videoOptions: VideoPref[] = ['auto', ...[...VIDEO_LEVELS].reverse().map((l) => l.id)];
const audioOptions: AudioPref[] = ['auto', ...[...AUDIO_LEVELS].reverse().map((l) => l.id)];

export function QualitySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const media = useCall((s) => s.media);
  const videoPref = useCall((s) => s.videoPref);
  const audioPref = useCall((s) => s.audioPref);
  const peerSending = useCall((s) => s.peerSending);
  const peerMaxVideo = useCall((s) => s.peerMaxVideo);
  const localSending = useCall((s) => s.localSending);
  const setVideoPref = useCall((s) => s.setVideoPref);
  const setAudioPref = useCall((s) => s.setAudioPref);

  const receivingVideo = peerSending?.videoPaused ? 'paused' : peerSending?.video;

  return (
    <Sheet open={open} onClose={onClose} title="Call quality" dark>
      {media === 'video' && (
        <Section title="Video">
          {videoOptions.map((opt) => {
            const tooHigh = opt !== 'auto' && peerMaxVideo !== null && videoIndex(opt) > videoIndex(peerMaxVideo);
            return (
              <Option
                key={opt}
                group="video"
                selected={videoPref === opt}
                disabled={tooHigh}
                onSelect={() => setVideoPref(opt)}
                label={opt === 'auto' ? 'Auto' : opt}
                badge={opt === '1080p' ? 'Full HD' : opt === '720p' ? 'HD' : undefined}
                hint={
                  opt === 'auto'
                    ? `Adapts to the network${receivingVideo ? ` · now ${receivingVideo}` : ''}`
                    : tooHigh
                      ? "Their camera can't capture this"
                      : undefined
                }
              />
            );
          })}
        </Section>
      )}

      <Section title="Audio">
        {audioOptions.map((opt) => {
          const level = AUDIO_LEVELS.find((l) => l.id === opt);
          return (
            <Option
              key={opt}
              group="audio"
              selected={audioPref === opt}
              onSelect={() => setAudioPref(opt)}
              label={opt === 'auto' ? 'Auto' : level!.label}
              hint={
                opt === 'auto'
                  ? `Best voice for the connection${peerSending ? ` · now ${peerSending.audio}` : ''}`
                  : level!.hint
              }
            />
          );
        })}
      </Section>

      <p className="px-3 pt-3 text-[12px] leading-relaxed text-white/50">
        You choose the quality you <b className="text-white/70">receive</b>; the other side sends at that level. On Auto,
        Najik keeps measuring both connections and changes quality smoothly, with no freezing.
        {localSending && (
          <>
            <br />
            You're sending {localSending.video ? `${localSending.videoPaused ? 'no video (weak link)' : localSending.video} · ` : ''}
            {localSending.audio} audio.
          </>
        )}
      </p>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pt-2">
      <p className="px-3 pt-2 pb-1.5 text-[11px] font-bold tracking-[0.14em] text-white/45 uppercase">{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function Option(props: {
  group: string;
  label: string;
  hint?: string;
  badge?: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={() => {
        haptic.tap();
        props.onSelect();
      }}
      className={cn(
        'relative flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-colors disabled:opacity-35',
        !props.selected && 'hover:bg-white/5',
      )}
    >
      {props.selected && (
        <motion.span
          layoutId={`q-${props.group}`}
          className="absolute inset-0 rounded-2xl bg-white/10"
          transition={{ type: 'spring', stiffness: 500, damping: 38 }}
        />
      )}
      <span className="relative flex-1">
        <span className="flex items-center gap-2 text-[15px] font-semibold">
          {props.label}
          {props.badge && (
            <span className="brand-gradient rounded-md px-1.5 py-px text-[10px] font-bold tracking-wide">{props.badge}</span>
          )}
        </span>
        {props.hint && <span className="mt-0.5 block text-[12px] text-white/50">{props.hint}</span>}
      </span>
      <span className="relative flex h-6 w-6 items-center justify-center">
        {props.selected && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 600, damping: 20 }}
            className="brand-gradient flex h-6 w-6 items-center justify-center rounded-full"
          >
            <Check size={14} strokeWidth={3} />
          </motion.span>
        )}
      </span>
    </button>
  );
}
