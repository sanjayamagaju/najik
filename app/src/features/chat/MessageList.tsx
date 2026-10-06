import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDown } from 'lucide-react';
import { useChat } from '../../stores/chat';
import { useCall } from '../../stores/call';
import { formatDayLabel, isSameDay } from '../../lib/utils';
import { MessageBubble } from './MessageBubble';
import { TypingBubble } from './TypingDots';
import { MessagesSkeleton } from '../../components/Skeleton';
import { Spinner } from '../../components/Spinner';
import { toast } from '../../stores/toast';
import type { Message, User } from '../../types';

const JOIN_WINDOW_MS = 3 * 60 * 1000;
const NEAR_BOTTOM_PX = 140;

const keyOf = (m: Message) => m.clientId ?? m.id;

function joins(a: Message | undefined, b: Message | undefined): boolean {
  return (
    !!a &&
    !!b &&
    a.kind === 'text' &&
    b.kind === 'text' &&
    a.senderId === b.senderId &&
    Math.abs(b.createdAt - a.createdAt) < JOIN_WINDOW_MS &&
    isSameDay(a.createdAt, b.createdAt)
  );
}

export function MessageList({ peer, meId }: { peer: User; meId: string }) {
  const thread = useChat((s) => s.threads[peer.id]);
  const typing = useChat((s) => !!s.typing[peer.id]);
  const loadOlder = useChat((s) => s.loadOlder);
  const retry = useChat((s) => s.retry);
  const startCall = useCall((s) => s.startCall);

  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const newestSeen = useRef(0);
  const ready = useRef(false);
  const prevHeight = useRef<number | null>(null);
  const [unseen, setUnseen] = useState(0);

  const messages = thread?.messages ?? [];
  const last = messages[messages.length - 1];

  const scrollToBottom = useCallback((smooth: boolean) => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // Preserve the reading position when older history is prepended.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && prevHeight.current !== null) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
      prevHeight.current = null;
    }
  }, [messages[0]?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // First paint of a loaded thread: jump to the bottom without animation.
  useLayoutEffect(() => {
    if (!thread?.loaded || ready.current) return;
    scrollToBottom(false);
    ready.current = true;
  }, [thread?.loaded, scrollToBottom]);

  // New message at the bottom.
  useEffect(() => {
    if (!last || !ready.current) return;
    const mine = last.senderId === meId;
    if (mine || atBottom.current) {
      requestAnimationFrame(() => scrollToBottom(true));
    } else if (last.createdAt > newestSeen.current) {
      setUnseen((n) => n + 1);
    }
  }, [last?.id, last?.clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (typing && atBottom.current) requestAnimationFrame(() => scrollToBottom(true));
  }, [typing, scrollToBottom]);

  // Track what has been rendered so only genuinely new messages animate in.
  useEffect(() => {
    if (last && thread?.loaded) newestSeen.current = Math.max(newestSeen.current, last.createdAt);
  });

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    if (atBottom.current && unseen) setUnseen(0);
    if (el.scrollTop < 120 && thread?.hasMore && !thread.loading) {
      prevHeight.current = el.scrollHeight;
      void loadOlder(peer.id);
    }
  };

  const onRetry = useCallback(
    (m: Message) => void retry(peer.id, m).catch((err: Error) => toast.error('Still not sent', err.message)),
    [retry, peer.id],
  );
  const onCallBack = useCallback((media: 'audio' | 'video') => void startCall(peer, media), [startCall, peer]);

  if (!thread?.loaded && messages.length === 0) return <MessagesSkeleton />;

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scroller}
        onScroll={onScroll}
        className="no-scrollbar h-full overflow-y-auto overscroll-contain px-3 pt-4 pb-2 [overflow-anchor:none] sm:px-6"
      >
        {thread?.loading && thread.hasMore && (
          <div className="flex justify-center py-3 text-muted">
            <Spinner size={18} />
          </div>
        )}
        {!thread?.hasMore && thread?.loaded && <ChatIntro peer={peer} />}

        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const next = messages[i + 1];
          const newDay = !prev || !isSameDay(prev.createdAt, m.createdAt);
          return (
            <Fragment key={keyOf(m)}>
              {newDay && (
                <div className="sticky top-1 z-10 my-3 flex justify-center">
                  <span className="glass rounded-full border border-line px-3 py-1 text-[11px] font-semibold tracking-wide text-muted shadow-soft">
                    {formatDayLabel(m.createdAt)}
                  </span>
                </div>
              )}
              <MessageBubble
                message={m}
                own={m.senderId === meId}
                peerName={peer.displayName}
                joinTop={!newDay && joins(prev, m)}
                joinBottom={joins(m, next)}
                animate={ready.current && m.createdAt > newestSeen.current}
                onRetry={onRetry}
                onCallBack={onCallBack}
              />
            </Fragment>
          );
        })}

        <AnimatePresence>{typing && <TypingBubble key="typing" />}</AnimatePresence>
      </div>

      <AnimatePresence>
        {unseen > 0 && (
          <motion.button
            initial={{ opacity: 0, y: 16, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.8 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            onClick={() => {
              setUnseen(0);
              scrollToBottom(true);
            }}
            className="brand-gradient absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold text-white shadow-glow"
          >
            <ArrowDown size={15} />
            {unseen} new {unseen === 1 ? 'message' : 'messages'}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

function ChatIntro({ peer }: { peer: User }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto mt-4 mb-6 max-w-xs text-center"
    >
      <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-soft text-2xl">✨</div>
      <p className="text-sm font-semibold">This is the beginning of your chat with {peer.displayName}</p>
      <p className="mt-1 text-xs text-muted">Say hi, send a 👋 ping, or start a call.</p>
    </motion.div>
  );
}
