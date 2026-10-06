import { AnimatePresence, motion } from 'motion/react';
import { useMatch } from 'react-router';
import { useIsDesktop } from '../../lib/hooks';
import { ConversationList } from './ConversationList';
import { ChatView } from './ChatView';
import { LogoMark } from '../../components/Logo';

/**
 * Mobile: the chat slides over the list like a native stack navigator.
 * Desktop / tablets: classic two-pane layout.
 */
export function Shell() {
  const match = useMatch('/c/:peerId');
  const peerId = match?.params.peerId ?? null;
  const desktop = useIsDesktop();

  if (desktop) {
    return (
      <div className="flex h-full">
        <aside className="w-[380px] shrink-0 border-r border-line bg-surface/60">
          <ConversationList activePeerId={peerId} />
        </aside>
        <main className="relative min-w-0 flex-1">
          <AnimatePresence mode="popLayout" initial={false}>
            {peerId ? (
              <motion.div
                key={peerId}
                className="absolute inset-0"
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ type: 'spring', stiffness: 380, damping: 38 }}
              >
                <ChatView peerId={peerId} showBack={false} />
              </motion.div>
            ) : (
              <motion.div key="empty" className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <EmptyPane />
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
    );
  }

  return (
    <div className="relative h-full overflow-hidden">
      <motion.div
        className="absolute inset-0 bg-bg"
        animate={peerId ? { x: '-22%', opacity: 0.6 } : { x: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 380, damping: 40 }}
      >
        <ConversationList activePeerId={null} />
      </motion.div>
      <AnimatePresence>
        {peerId && (
          <motion.div
            key={peerId}
            className="absolute inset-0 z-10 shadow-[-20px_0_40px_-20px_rgb(0_0_0/0.4)]"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 40 }}
          >
            <ChatView peerId={peerId} showBack />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function EmptyPane() {
  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden text-center">
      <div className="aurora opacity-50" />
      <div className="relative">
        <LogoMark size={84} />
      </div>
      <h2 className="relative mt-6 text-2xl font-extrabold">
        Welcome to <span className="brand-text">Najik</span>
      </h2>
      <p className="relative mt-2 max-w-xs text-sm text-muted">
        Pick a conversation or search for someone to start chatting, ping, or call.
      </p>
    </div>
  );
}
