import { motion } from 'motion/react';

export function LogoMark({ size = 64, animate = true }: { size?: number; animate?: boolean }) {
  return (
    <motion.div
      className="relative"
      style={{ width: size, height: size }}
      initial={animate ? { scale: 0.6, rotate: -12, opacity: 0 } : false}
      animate={{ scale: 1, rotate: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 18 }}
    >
      <div className="brand-gradient absolute inset-0 rounded-[30%] opacity-60 blur-xl" />
      <svg viewBox="0 0 64 64" width={size} height={size} className="relative">
        <defs>
          <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--brand)" />
            <stop offset="1" stopColor="var(--brand-2)" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="19" fill="url(#logo-g)" />
        <motion.path
          d="M20 44V20l24 24V20"
          fill="none"
          stroke="#fff"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={animate ? { pathLength: 0 } : false}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.9, delay: 0.2, ease: [0.65, 0, 0.35, 1] }}
        />
      </svg>
    </motion.div>
  );
}
