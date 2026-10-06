import { motion } from 'motion/react';
import { cn } from '../../lib/utils';

const COLORS = ['#ef4444', '#ef4444', '#f59e0b', '#a3e635', '#10b981'];

export function NetworkBars({ score, className }: { score: number; className?: string }) {
  return (
    <span className={cn('inline-flex h-3.5 items-end gap-[2px]', className)} aria-label={`Signal ${score} of 4`}>
      {[1, 2, 3, 4].map((i) => (
        <motion.span
          key={i}
          className="w-[3px] rounded-full"
          initial={false}
          animate={{
            height: `${25 + i * 18.75}%`,
            backgroundColor: i <= score ? COLORS[score] : 'rgba(255,255,255,0.25)',
          }}
          transition={{ duration: 0.4 }}
        />
      ))}
    </span>
  );
}
