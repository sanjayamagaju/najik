import { useEffect, useRef } from 'react';
import { useMotionValue, type MotionValue } from 'motion/react';
import { cn } from '../../lib/utils';

export function VideoView({
  stream,
  mirrored,
  className,
  fit = 'cover',
}: {
  stream: MediaStream | null;
  mirrored?: boolean;
  className?: string;
  fit?: 'cover' | 'contain';
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (stream) void el.play().catch(() => {});
  }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      className={cn(fit === 'cover' ? 'object-cover' : 'object-contain', mirrored && '-scale-x-100', className)}
    />
  );
}

/** Plays the remote party's audio. Kept separate from <video> so audio survives UI changes. */
export function RemoteAudio({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    if (stream) void el.play().catch(() => {});
  }, [stream]);
  return <audio ref={ref} autoPlay className="hidden" />;
}

/** Live 0–1 voice level of a stream, as a MotionValue (no React re-renders). */
export function useAudioLevel(stream: MediaStream | null, version = 0): MotionValue<number> {
  const level = useMotionValue(0);
  useEffect(() => {
    const track = stream?.getAudioTracks()[0];
    if (!stream || !track) return;
    let ctx: AudioContext;
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
    const src = ctx.createMediaStreamSource(new MediaStream([track]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.6;
    src.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let raf = 0;
    let smooth = 0;
    const loop = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) {
        const x = (v - 128) / 128;
        sum += x * x;
      }
      const rms = Math.sqrt(sum / data.length);
      const target = Math.min(1, rms * 5);
      smooth = target > smooth ? smooth * 0.5 + target * 0.5 : smooth * 0.88 + target * 0.12;
      level.set(smooth);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      src.disconnect();
      void ctx.close();
    };
  }, [stream, version, level]);
  return level;
}
