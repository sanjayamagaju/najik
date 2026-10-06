import { AnimatePresence, motion, type HTMLMotionProps } from 'motion/react';
import { cn } from '../lib/utils';
import { Spinner } from './Spinner';

interface Props extends HTMLMotionProps<'button'> {
  loading?: boolean;
  variant?: 'primary' | 'soft';
}

export function Button({ loading, variant = 'primary', className, children, disabled, ...rest }: Props) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      whileHover={{ y: -1 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      disabled={disabled || loading}
      className={cn(
        'relative inline-flex h-13 items-center justify-center gap-2 overflow-hidden rounded-2xl px-6 font-semibold transition-[opacity,box-shadow] outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-60',
        variant === 'primary' ? 'brand-gradient text-white shadow-glow' : 'bg-surface-2 text-ink',
        className,
      )}
      {...rest}
    >
      {variant === 'primary' && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 skew-x-[-20deg] bg-white/20 blur-md"
          animate={{ x: ['0%', '400%'] }}
          transition={{ duration: 2.8, repeat: Infinity, repeatDelay: 2.2, ease: 'easeInOut' }}
        />
      )}
      <AnimatePresence mode="wait" initial={false}>
        {loading ? (
          <motion.span key="spin" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }}>
            <Spinner />
          </motion.span>
        ) : (
          <motion.span
            key="label"
            className="relative inline-flex items-center gap-2"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
          >
            {children as React.ReactNode}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}
