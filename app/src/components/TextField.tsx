import { motion } from 'motion/react';
import { forwardRef, useId, useState } from 'react';
import { Eye, EyeOff, type LucideIcon } from 'lucide-react';
import { cn } from '../lib/utils';

interface Props extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: string;
  icon?: LucideIcon;
}

export const TextField = forwardRef<HTMLInputElement, Props>(function TextField(
  { label, icon: Icon, type = 'text', className, value, ...rest },
  ref,
) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const [reveal, setReveal] = useState(false);
  const filled = String(value ?? '').length > 0;
  const raised = focused || filled;
  const isPassword = type === 'password';

  return (
    <div
      className={cn(
        'group relative flex h-15 items-center rounded-2xl border bg-surface/70 px-4 transition-all duration-300',
        focused ? 'border-brand shadow-[0_0_0_4px_var(--brand-soft)]' : 'border-line',
        className,
      )}
    >
      {Icon && (
        <Icon
          size={19}
          className={cn('mr-3 shrink-0 transition-colors duration-300', focused ? 'text-brand' : 'text-faint')}
        />
      )}
      <div className="relative h-full flex-1">
        <motion.label
          htmlFor={id}
          className="pointer-events-none absolute left-0 origin-left text-muted"
          initial={false}
          animate={raised ? { y: 9, scale: 0.74 } : { y: 19, scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 34 }}
        >
          {label}
        </motion.label>
        <input
          ref={ref}
          id={id}
          type={isPassword && reveal ? 'text' : type}
          value={value}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="absolute inset-x-0 bottom-2 h-7 w-full bg-transparent text-[15px] text-ink outline-none"
          {...rest}
        />
      </div>
      {isPassword && (
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setReveal((r) => !r)}
          className="ml-2 text-faint transition-colors hover:text-ink"
          aria-label={reveal ? 'Hide password' : 'Show password'}
        >
          {reveal ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      )}
    </div>
  );
});
