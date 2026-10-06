import { memo } from 'react';
import { motion } from 'motion/react';
import { Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Video } from 'lucide-react';
import { statusOf } from '../../stores/chat';
import { cn, formatDuration, formatTime, jumboEmojiCount } from '../../lib/utils';
import { StatusTicks } from './StatusTicks';
import type { Message } from '../../types';

interface Props {
  message: Message;
  own: boolean;
  peerName: string;
  /** Previous / next message is from the same sender within a short window. */
  joinTop: boolean;
  joinBottom: boolean;
  animate: boolean;
  onRetry: (m: Message) => void;
  onCallBack: (media: 'audio' | 'video') => void;
}

const spring = { type: 'spring', stiffness: 520, damping: 32, mass: 0.8 } as const;

export const MessageBubble = memo(function MessageBubble(p: Props) {
  if (p.message.kind === 'ping') return <PingCard {...p} />;
  if (p.message.kind === 'call') return <CallCard {...p} />;
  return <TextBubble {...p} />;
});

function TextBubble({ message: m, own, joinTop, joinBottom, animate, onRetry }: Props) {
  const status = statusOf(m);
  const jumbo = jumboEmojiCount(m.body);

  const radius = own
    ? cn('rounded-3xl', joinTop && 'rounded-tr-lg', joinBottom && 'rounded-br-lg', !joinBottom && 'rounded-br-md')
    : cn('rounded-3xl', joinTop && 'rounded-tl-lg', joinBottom && 'rounded-bl-lg', !joinBottom && 'rounded-bl-md');

  return (
    <motion.div
      layout="position"
      initial={animate ? { opacity: 0, y: 18, x: own ? 14 : -14, scale: 0.92 } : false}
      animate={{ opacity: 1, y: 0, x: 0, scale: 1 }}
      transition={spring}
      className={cn('flex w-full', own ? 'justify-end' : 'justify-start', joinBottom ? 'mb-[3px]' : 'mb-2.5')}
    >
      {jumbo ? (
        <div className={cn('flex flex-col', own ? 'items-end' : 'items-start')}>
          <motion.span
            className="selectable leading-none"
            style={{ fontSize: jumbo === 1 ? 64 : jumbo === 2 ? 52 : 44 }}
            initial={animate ? { scale: 0.2, rotate: own ? 20 : -20 } : false}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 12 }}
          >
            {m.body}
          </motion.span>
          <span className="mt-1 flex items-center gap-1 px-1 text-[11px] text-faint">
            {formatTime(m.createdAt)}
            {own && <StatusTicks status={status} />}
          </span>
        </div>
      ) : (
        <button
          type="button"
          disabled={status !== 'failed'}
          onClick={() => onRetry(m)}
          className={cn(
            'relative max-w-[82%] px-3.5 pt-2 pb-1.5 text-left text-[15px] leading-snug shadow-soft sm:max-w-[68%]',
            'disabled:cursor-default',
            radius,
            own ? 'brand-gradient text-white' : 'bg-bubble-in text-ink',
            status === 'failed' && 'opacity-70',
          )}
        >
          <span className="selectable break-words whitespace-pre-wrap">{m.body}</span>
          <span
            className={cn(
              'float-right mt-1.5 ml-2.5 flex translate-y-0.5 items-center gap-1 text-[11px] leading-none',
              own ? 'text-white/75' : 'text-faint',
            )}
          >
            {formatTime(m.createdAt)}
            {own && <StatusTicks status={status} onBubble />}
          </span>
          {status === 'failed' && (
            <span className="absolute -bottom-5 right-1 text-[11px] font-medium text-danger">Not sent · Tap to retry</span>
          )}
        </button>
      )}
    </motion.div>
  );
}

function PingCard({ message: m, own, peerName, animate }: Props) {
  return (
    <motion.div
      layout="position"
      initial={animate ? { opacity: 0, scale: 0.6, y: 10 } : false}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 420, damping: 18 }}
      className="my-3 flex justify-center"
    >
      <div className="flex items-center gap-2.5 rounded-full border border-line bg-surface px-4 py-2 shadow-soft">
        <motion.span
          className="inline-block origin-[70%_70%] text-xl"
          initial={animate ? { rotate: 0 } : false}
          animate={animate ? { rotate: [0, 18, -10, 18, -6, 12, 0] } : undefined}
          transition={{ duration: 1.1, delay: 0.15 }}
        >
          👋
        </motion.span>
        <span className="text-[13px] font-semibold">
          {own ? (
            <>
              You pinged <span className="brand-text">{peerName}</span>
            </>
          ) : (
            <>
              <span className="brand-text">{peerName}</span> pinged you
            </>
          )}
        </span>
        <span className="text-[11px] text-faint">{formatTime(m.createdAt)}</span>
        {own && <StatusTicks status={statusOf(m)} />}
      </div>
    </motion.div>
  );
}

function CallCard({ message: m, own, animate, onCallBack }: Props) {
  const meta = m.meta;
  if (!meta) return null;
  const missed = !own && (meta.outcome === 'missed' || meta.outcome === 'cancelled');
  const notAnswered = meta.outcome !== 'completed';
  const label = (() => {
    const kind = meta.media === 'video' ? 'video call' : 'voice call';
    if (meta.outcome === 'completed') return `${own ? 'Outgoing' : 'Incoming'} ${kind}`;
    if (missed) return `Missed ${kind}`;
    if (meta.outcome === 'declined') return own ? `${cap(kind)} declined` : `Declined ${kind}`;
    return own ? `${cap(kind)} · no answer` : `Missed ${kind}`;
  })();
  const Icon = missed ? PhoneMissed : own ? PhoneOutgoing : PhoneIncoming;

  return (
    <motion.div
      layout="position"
      initial={animate ? { opacity: 0, y: 12, scale: 0.9 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring}
      className="my-3 flex justify-center"
    >
      <button
        type="button"
        onClick={() => onCallBack(meta.media)}
        className="group flex items-center gap-3 rounded-2xl border border-line bg-surface py-2 pr-3 pl-2 shadow-soft transition-transform active:scale-[0.97]"
      >
        <span
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-xl',
            missed ? 'bg-danger/12 text-danger' : 'bg-brand-soft text-brand',
          )}
        >
          <Icon size={17} />
        </span>
        <span className="text-left">
          <span className={cn('block text-[13px] font-semibold', missed && 'text-danger')}>{label}</span>
          <span className="block text-[11px] text-faint">
            {formatTime(m.createdAt)}
            {!notAnswered && meta.durationSec > 0 && ` · ${formatDuration(meta.durationSec)}`}
          </span>
        </span>
        <span className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 text-muted transition-colors group-hover:text-brand">
          {meta.media === 'video' ? <Video size={15} /> : <Phone size={15} />}
        </span>
      </button>
    </motion.div>
  );
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
