import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Keyboard, SendHorizontal, Smile } from 'lucide-react';
import { useChat } from '../../stores/chat';
import { toast } from '../../stores/toast';
import { emit } from '../../lib/socket';
import { haptic } from '../../lib/native';
import { sounds } from '../../lib/sounds';
import { useMediaQuery } from '../../lib/hooks';
import { IconButton } from '../../components/IconButton';
import { Spinner } from '../../components/Spinner';
import { cn } from '../../lib/utils';

const EmojiPanel = lazy(() => import('./EmojiPanel'));

const TYPING_THROTTLE_MS = 2500;
const TYPING_IDLE_MS = 3000;

export function Composer({ peerId }: { peerId: string }) {
  const [text, setText] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const sendText = useChat((s) => s.sendText);
  const coarse = useMediaQuery('(pointer: coarse)');

  const typingSent = useRef(0);
  const idleTimer = useRef<number | undefined>(undefined);

  const stopTyping = () => {
    window.clearTimeout(idleTimer.current);
    if (typingSent.current) emit('typing', { to: peerId, typing: false });
    typingSent.current = 0;
  };

  useEffect(() => stopTyping, [peerId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-grow the textarea up to ~5 lines.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [text]);

  const onChange = (value: string) => {
    setText(value);
    const now = Date.now();
    if (value.trim() && now - typingSent.current > TYPING_THROTTLE_MS) {
      emit('typing', { to: peerId, typing: true });
      typingSent.current = now;
    }
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(stopTyping, TYPING_IDLE_MS);
  };

  const send = () => {
    const body = text.trim();
    if (!body) return;
    setText('');
    stopTyping();
    haptic.tap();
    sounds.messageOut();
    sendText(peerId, body).catch((err: Error) => toast.error('Message not sent', err.message));
  };

  const insertEmoji = (emoji: string) => {
    const el = area.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      if (!el) return;
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const toggleEmoji = () => {
    if (emojiOpen) {
      setEmojiOpen(false);
      area.current?.focus();
    } else {
      area.current?.blur();
      setEmojiOpen(true);
    }
  };

  const hasText = text.trim().length > 0;

  return (
    <div className="pb-safe relative z-10 border-t border-line bg-surface/80 backdrop-blur-xl">
      <div className="flex items-end gap-1.5 px-2 py-2 sm:px-4">
        <IconButton label={emojiOpen ? 'Keyboard' : 'Emoji'} onClick={toggleEmoji} size={44} className={cn(emojiOpen && 'text-brand')}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={emojiOpen ? 'kb' : 'smile'}
              initial={{ scale: 0.4, rotate: -45, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              exit={{ scale: 0.4, rotate: 45, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {emojiOpen ? <Keyboard size={22} /> : <Smile size={22} />}
            </motion.span>
          </AnimatePresence>
        </IconButton>

        <div className="flex min-h-11 flex-1 items-center rounded-[22px] border border-line bg-surface-2 px-4 transition-colors focus-within:border-brand/50">
          <textarea
            ref={area}
            rows={1}
            value={text}
            placeholder="Message"
            maxLength={4000}
            onFocus={() => setEmojiOpen(false)}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !coarse && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            className="no-scrollbar max-h-[132px] w-full resize-none bg-transparent py-2.5 text-[15px] leading-6 text-ink outline-none placeholder:text-faint"
          />
        </div>

        <AnimatePresence mode="popLayout" initial={false}>
          {hasText ? (
            <motion.div
              key="send"
              initial={{ scale: 0, rotate: -90 }}
              animate={{ scale: 1, rotate: 0 }}
              exit={{ scale: 0, rotate: 90 }}
              transition={{ type: 'spring', stiffness: 600, damping: 28 }}
            >
              <IconButton label="Send" variant="brand" size={44} onClick={send} onMouseDown={(e) => e.preventDefault()}>
                <SendHorizontal size={20} />
              </IconButton>
            </motion.div>
          ) : (
            <motion.div
              key="ping"
              initial={{ scale: 0, rotate: 90 }}
              animate={{ scale: 1, rotate: 0 }}
              exit={{ scale: 0, rotate: -90 }}
              transition={{ type: 'spring', stiffness: 600, damping: 28 }}
            >
              <PingButton peerId={peerId} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence initial={false}>
        {emojiOpen && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 320 }}
            exit={{ height: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 40 }}
            className="overflow-hidden border-t border-line"
          >
            <Suspense
              fallback={
                <div className="flex h-[320px] items-center justify-center text-muted">
                  <Spinner />
                </div>
              }
            >
              <EmojiPanel onPick={insertEmoji} />
            </Suspense>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** 👋 Ping — wiggles and throws a little burst of waves when tapped. */
export function PingButton({ peerId, size = 44 }: { peerId: string; size?: number }) {
  const sendPing = useChat((s) => s.sendPing);
  const [bursts, setBursts] = useState<number[]>([]);
  const [wiggle, setWiggle] = useState(0);

  const ping = () => {
    const id = Date.now();
    setBursts((b) => [...b, id]);
    setWiggle((w) => w + 1);
    window.setTimeout(() => setBursts((b) => b.filter((x) => x !== id)), 1100);
    haptic.medium();
    sounds.ping();
    sendPing(peerId).catch((err: Error) => toast.info(err.message));
  };

  return (
    <div className="relative">
      <motion.button
        type="button"
        aria-label="Ping"
        title="Send a ping"
        onClick={ping}
        whileTap={{ scale: 0.85 }}
        className="relative flex items-center justify-center rounded-full bg-brand-soft text-[22px]"
        style={{ width: size, height: size }}
      >
        <motion.span
          key={wiggle}
          className="inline-block origin-[70%_75%]"
          animate={wiggle ? { rotate: [0, 24, -12, 22, -8, 14, 0] } : undefined}
          transition={{ duration: 0.8 }}
        >
          👋
        </motion.span>
      </motion.button>
      <AnimatePresence>
        {bursts.map((id) =>
          [0, 1, 2, 3, 4].map((i) => {
            const angle = -90 + (i - 2) * 26;
            const rad = (angle * Math.PI) / 180;
            return (
              <motion.span
                key={`${id}-${i}`}
                className="pointer-events-none absolute top-1/2 left-1/2 text-lg"
                initial={{ x: '-50%', y: '-50%', scale: 0.3, opacity: 1 }}
                animate={{
                  x: `calc(-50% + ${Math.cos(rad) * 70}px)`,
                  y: `calc(-50% + ${Math.sin(rad) * 70}px)`,
                  scale: 1,
                  opacity: 0,
                  rotate: (i - 2) * 15,
                }}
                transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
              >
                {i % 2 ? '✨' : '👋'}
              </motion.span>
            );
          }),
        )}
      </AnimatePresence>
    </div>
  );
}
