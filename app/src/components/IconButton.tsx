import { motion, type HTMLMotionProps } from 'motion/react';
import { forwardRef } from 'react';
import { cn } from '../lib/utils';
import { haptic } from '../lib/native';

type Variant = 'ghost' | 'soft' | 'brand' | 'danger' | 'success' | 'glass' | 'glass-active';

const variants: Record<Variant, string> = {
  ghost: 'text-muted hover:text-ink hover:bg-surface-2',
  soft: 'bg-surface-2 text-ink hover:bg-surface-3',
  brand: 'brand-gradient text-white shadow-glow',
  danger: 'bg-danger text-white shadow-[0_10px_30px_-8px_rgb(239_68_68/0.7)]',
  success: 'bg-success text-white shadow-[0_10px_30px_-8px_rgb(16_185_129/0.7)]',
  glass: 'bg-white/12 text-white backdrop-blur-xl hover:bg-white/20',
  'glass-active': 'bg-white text-neutral-900',
};

interface Props extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: Variant;
  size?: number;
  label: string;
  children: React.ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton(
  { variant = 'ghost', size = 40, label, className, children, onClick, ...rest },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      whileTap={{ scale: 0.86 }}
      whileHover={{ scale: 1.04 }}
      transition={{ type: 'spring', stiffness: 600, damping: 26 }}
      onClick={(e) => {
        haptic.tap();
        onClick?.(e);
      }}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:pointer-events-none disabled:opacity-40',
        variants[variant],
        className,
      )}
      style={{ width: size, height: size }}
      {...rest}
    >
      {children}
    </motion.button>
  );
});
