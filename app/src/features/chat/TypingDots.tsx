import { motion } from 'motion/react';
import { cn } from '../../lib/utils';

export function TypingDots({ className, dot = 6 }: { className?: string; dot?: number }) {
  return (
    <span className={cn('inline-flex items-center gap-[3px]', className)} aria-label="typing">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="rounded-full bg-current"
          style={{ width: dot, height: dot }}
          animate={{ y: [0, -dot * 0.6, 0], opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
        />
      ))}
    </span>
  );
}

/** Incoming-side bubble shown at the bottom of the thread while the peer types. */
export function TypingBubble() {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12, scale: 0.8 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className="mb-1 flex origin-bottom-left"
    >
      <div className="rounded-3xl rounded-bl-lg bg-bubble-in px-4 py-3.5 text-muted shadow-soft">
        <TypingDots dot={7} />
      </div>
    </motion.div>
  );
}
