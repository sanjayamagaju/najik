import { AnimatePresence, motion } from 'motion/react';
import { cn, initials } from '../lib/utils';
import type { User } from '../types';

interface Props {
  user: Pick<User, 'displayName' | 'avatarHue'> | null | undefined;
  size?: number;
  online?: boolean;
  className?: string;
  ring?: boolean;
}

export function Avatar({ user, size = 44, online, className, ring }: Props) {
  const hue = user?.avatarHue ?? 260;
  const dot = Math.max(10, Math.round(size * 0.26));
  return (
    <div className={cn('relative shrink-0', className)} style={{ width: size, height: size }}>
      <div
        className={cn(
          'flex h-full w-full items-center justify-center rounded-full font-semibold text-white select-none',
          ring && 'ring-2 ring-white/20 ring-offset-2 ring-offset-transparent',
        )}
        style={{
          fontSize: size * 0.36,
          backgroundImage: `linear-gradient(135deg, hsl(${hue} 80% 62%), hsl(${(hue + 40) % 360} 85% 52%))`,
          boxShadow: `inset 0 -${size * 0.08}px ${size * 0.2}px hsl(${hue} 70% 30% / 0.35)`,
        }}
      >
        {initials(user?.displayName ?? '?')}
      </div>
      <AnimatePresence>
        {online && (
          <motion.span
            key="dot"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            transition={{ type: 'spring', stiffness: 520, damping: 22 }}
            className="absolute right-0 bottom-0 rounded-full border-[2.5px] border-surface bg-success"
            style={{ width: dot, height: dot }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
