import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, Clock3 } from 'lucide-react';
import type { DeliveryStatus } from '../../types';
import { cn } from '../../lib/utils';

/** Animated delivery indicator: clock → ✓ → ✓✓ → coloured ✓✓ (read). */
export function StatusTicks({ status, onBubble = false }: { status: DeliveryStatus; onBubble?: boolean }) {
  const base = onBubble ? 'text-white/70' : 'text-faint';
  const read = onBubble ? 'text-white' : 'text-brand';

  return (
    <span className="relative inline-flex h-4 w-[18px] items-center justify-center" aria-label={status}>
      <AnimatePresence mode="wait" initial={false}>
        {status === 'sending' && (
          <motion.span key="clock" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className={base}>
            <Clock3 size={12} strokeWidth={2.5} />
          </motion.span>
        )}
        {status === 'failed' && (
          <motion.span key="fail" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="text-danger">
            <AlertCircle size={14} strokeWidth={2.5} />
          </motion.span>
        )}
        {(status === 'sent' || status === 'delivered' || status === 'read') && (
          <motion.svg
            key="ticks"
            width="18"
            height="12"
            viewBox="0 0 18 12"
            fill="none"
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 600, damping: 24 }}
            className={cn('transition-colors duration-500', status === 'read' ? read : base)}
          >
            <motion.path
              d="M1.5 6.5l3 3 6.5-7"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.25 }}
            />
            {status !== 'sent' && (
              <motion.path
                d="M7.5 8.5l1 1 6.5-7"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.25, delay: 0.08 }}
              />
            )}
          </motion.svg>
        )}
      </AnimatePresence>
    </span>
  );
}
