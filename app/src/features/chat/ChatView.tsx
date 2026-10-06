import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, Phone, Video } from 'lucide-react';
import { useChat } from '../../stores/chat';
import { useCall } from '../../stores/call';
import { useAuth } from '../../stores/auth';
import { toast } from '../../stores/toast';
import { Avatar } from '../../components/Avatar';
import { IconButton } from '../../components/IconButton';
import { Skeleton } from '../../components/Skeleton';
import { formatLastSeen } from '../../lib/utils';
import { useNow } from '../../lib/hooks';
import { onAppResume } from '../../lib/native';
import { MessageList } from './MessageList';
import { Composer } from './Composer';
import { TypingDots } from './TypingDots';

export function ChatView({ peerId, showBack }: { peerId: string; showBack: boolean }) {
  const navigate = useNavigate();
  const me = useAuth((s) => s.user)!;
  const peer = useChat((s) => s.users[peerId]);
  const typing = useChat((s) => !!s.typing[peerId]);
  const { ensureUser, loadThread, setActivePeer, markRead } = useChat.getState();
  const startCall = useCall((s) => s.startCall);
  const callBusy = useCall((s) => s.phase !== 'idle' && s.phase !== 'ended');
  useNow(30_000);

  useEffect(() => {
    setActivePeer(peerId);
    void ensureUser(peerId).then((u) => {
      if (!u) {
        toast.error('User not found');
        navigate('/', { replace: true });
      }
    });
    loadThread(peerId)
      .then(() => {
        if (useChat.getState().activePeerId === peerId && document.visibilityState === 'visible') markRead(peerId);
      })
      .catch((err: Error) => toast.error("Couldn't load messages", err.message));
    const offResume = onAppResume(() => markRead(peerId));
    return () => {
      offResume();
      if (useChat.getState().activePeerId === peerId) setActivePeer(null);
    };
  }, [peerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const status = typing ? null : peer?.online ? 'Online' : formatLastSeen(peer?.lastSeen ?? null);

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      {/* Header */}
      <header className="pt-safe glass relative z-20 border-b border-line">
        <div className="flex h-16 items-center gap-1 px-2 sm:px-4">
          {showBack && (
            <IconButton label="Back" onClick={() => navigate('/')} size={40}>
              <ChevronLeft size={26} />
            </IconButton>
          )}
          {peer ? (
            <div className="flex min-w-0 flex-1 items-center gap-3 pl-1">
              <Avatar user={peer} size={42} online={peer.online} />
              <div className="min-w-0">
                <h2 className="truncate text-[16px] leading-tight font-bold">{peer.displayName}</h2>
                <div className="relative h-4 overflow-hidden text-[12.5px]">
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.p
                      key={typing ? 'typing' : status}
                      initial={{ y: 12, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      exit={{ y: -12, opacity: 0 }}
                      transition={{ duration: 0.18 }}
                      className={typing || peer.online ? 'font-medium text-brand' : 'text-muted'}
                    >
                      {typing ? (
                        <span className="inline-flex items-center gap-1.5">
                          typing <TypingDots dot={4} />
                        </span>
                      ) : (
                        status
                      )}
                    </motion.p>
                  </AnimatePresence>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 items-center gap-3 pl-1">
              <Skeleton className="h-[42px] w-[42px] rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
          )}
          <div className="flex items-center gap-0.5">
            <IconButton label="Voice call" disabled={!peer || callBusy} onClick={() => peer && void startCall(peer, 'audio')}>
              <Phone size={20} />
            </IconButton>
            <IconButton label="Video call" disabled={!peer || callBusy} onClick={() => peer && void startCall(peer, 'video')}>
              <Video size={22} />
            </IconButton>
          </div>
        </div>
      </header>

      {peer ? <MessageList peer={peer} meId={me.id} /> : <div className="flex-1" />}
      <Composer peerId={peerId} />
    </div>
  );
}
