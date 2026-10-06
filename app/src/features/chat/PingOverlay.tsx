import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useChat } from '../../stores/chat';
import { Avatar } from '../../components/Avatar';

/** Full-screen "👋 Ping!" moment when someone pings you. Tap anywhere to dismiss. */
export function PingOverlay() {
  const ping = useChat((s) => s.incomingPing);
  const from = useChat((s) => (s.incomingPing ? s.users[s.incomingPing.from] : undefined));
  const clear = useChat((s) => s.clearPing);

  useEffect(() => {
    if (!ping) return;
    const id = window.setTimeout(clear, 2600);
    return () => window.clearTimeout(id);
  }, [ping, clear]);

  return (
    <AnimatePresence>
      {ping && (
        <motion.div
          key={ping.at}
          className="fixed inset-0 z-[90] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.35 } }}
          onClick={clear}
        >
          <div className="absolute inset-0 bg-bg/70 backdrop-blur-md" />

          {/* Shockwave rings */}
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="absolute h-40 w-40 rounded-full border-2 border-brand"
              initial={{ scale: 0.4, opacity: 0.8 }}
              animate={{ scale: 3.4, opacity: 0 }}
              transition={{ duration: 1.6, delay: 0.1 + i * 0.25, ease: [0.16, 1, 0.3, 1] }}
            />
          ))}

          <div className="relative flex flex-col items-center">
            <motion.div
              initial={{ scale: 0, rotate: -30 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 12 }}
              className="relative"
            >
              <div className="brand-gradient absolute inset-0 rounded-full opacity-50 blur-2xl" />
              <motion.span
                className="relative block origin-[70%_75%] text-[110px] leading-none"
                animate={{ rotate: [0, 22, -12, 22, -8, 16, 0] }}
                transition={{ duration: 1.3, delay: 0.25, ease: 'easeInOut' }}
              >
                👋
              </motion.span>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25, type: 'spring', stiffness: 260, damping: 22 }}
              className="mt-6 flex items-center gap-3 rounded-full border border-line bg-surface py-2 pr-5 pl-2 shadow-soft"
            >
              <Avatar user={from} size={36} />
              <span className="text-lg font-bold">
                <span className="brand-text">{from?.displayName ?? 'Someone'}</span> pinged you!
              </span>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
