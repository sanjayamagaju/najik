import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { LogOut, Moon, Phone, PhoneMissed, Search, Sun, Video, X } from 'lucide-react';
import { sortedConversations, statusOf, useChat } from '../../stores/chat';
import { useAuth } from '../../stores/auth';
import { useTheme } from '../../stores/theme';
import { api } from '../../lib/api';
import { useDebounced, useNow } from '../../lib/hooks';
import { cn, formatListStamp } from '../../lib/utils';
import { Avatar } from '../../components/Avatar';
import { IconButton } from '../../components/IconButton';
import { ConversationSkeleton } from '../../components/Skeleton';
import { Spinner } from '../../components/Spinner';
import { StatusTicks } from './StatusTicks';
import { TypingDots } from './TypingDots';
import type { Message, User } from '../../types';

export function ConversationList({ activePeerId }: { activePeerId: string | null }) {
  const [query, setQuery] = useState('');
  const searching = query.trim().length > 0;
  const searchRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ListHeader />
      <div className="px-4 pb-2">
        <div className="flex h-11 items-center gap-2.5 rounded-2xl bg-surface-2 px-3.5 transition-shadow focus-within:shadow-[0_0_0_3px_var(--brand-soft)]">
          <Search size={18} className="text-faint" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people by name or @username"
            autoCapitalize="off"
            autoCorrect="off"
            className="h-full flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
          />
          <AnimatePresence>
            {searching && (
              <motion.button
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                onClick={() => setQuery('')}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-3 text-muted"
                aria-label="Clear search"
              >
                <X size={14} />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto pb-6">
        <AnimatePresence mode="wait" initial={false}>
          {searching ? (
            <motion.div key="search" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <SearchResults query={query.trim()} onPicked={() => setQuery('')} />
            </motion.div>
          ) : (
            <motion.div key="list" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <Conversations activePeerId={activePeerId} onFind={() => searchRef.current?.focus()} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function ListHeader() {
  const me = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const { dark, toggle } = useTheme();
  const [menu, setMenu] = useState(false);

  return (
    <header className="pt-safe relative z-30">
      <div className="flex h-16 items-center justify-between px-4">
        <motion.h1
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          className="text-[28px] font-extrabold tracking-tight"
        >
          Chats
        </motion.h1>
        <div className="flex items-center gap-1">
          <IconButton label="Toggle theme" onClick={toggle}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={dark ? 'moon' : 'sun'}
                initial={{ rotate: -90, scale: 0.4, opacity: 0 }}
                animate={{ rotate: 0, scale: 1, opacity: 1 }}
                exit={{ rotate: 90, scale: 0.4, opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                {dark ? <Moon size={20} /> : <Sun size={20} />}
              </motion.span>
            </AnimatePresence>
          </IconButton>
          <div className="relative">
            <motion.button whileTap={{ scale: 0.9 }} onClick={() => setMenu((m) => !m)} aria-label="Account">
              <Avatar user={me} size={38} />
            </motion.button>
            <AnimatePresence>
              {menu && (
                <>
                  <motion.div className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
                  <motion.div
                    initial={{ opacity: 0, scale: 0.85, y: -8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.85, y: -8 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                    className="absolute top-12 right-0 z-50 w-60 origin-top-right rounded-2xl border border-line bg-surface p-2 shadow-soft"
                  >
                    <div className="flex items-center gap-3 px-2 py-2">
                      <Avatar user={me} size={40} />
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{me?.displayName}</p>
                        <p className="truncate text-sm text-muted">@{me?.username}</p>
                      </div>
                    </div>
                    <div className="my-1 h-px bg-line" />
                    <button
                      onClick={() => void logout()}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-danger transition-colors hover:bg-danger/10"
                    >
                      <LogOut size={17} /> Log out
                    </button>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </header>
  );
}

function Conversations({ activePeerId, onFind }: { activePeerId: string | null; onFind: () => void }) {
  const conversations = useChat((s) => s.conversations);
  const loaded = useChat((s) => s.conversationsLoaded);
  const list = useMemo(() => sortedConversations(conversations), [conversations]);
  useNow(60_000);

  if (!loaded && list.length === 0) return <ConversationSkeleton />;

  if (list.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="mx-auto flex max-w-xs flex-col items-center px-6 pt-16 text-center"
      >
        <motion.div
          animate={{ y: [0, -8, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          className="mb-5 flex h-20 w-20 items-center justify-center rounded-[26px] bg-brand-soft text-4xl"
        >
          💬
        </motion.div>
        <h3 className="text-lg font-bold">No chats yet</h3>
        <p className="mt-1 text-sm text-muted">Find someone by their username and say hello.</p>
        <button onClick={onFind} className="brand-gradient mt-5 rounded-full px-5 py-2.5 text-sm font-semibold text-white shadow-glow">
          Find people
        </button>
      </motion.div>
    );
  }

  return (
    <motion.ul className="space-y-0.5 px-2" initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.035 } } }}>
      <AnimatePresence initial={false}>
        {list.map((c) => (
          <ConversationRow key={c.peerId} peerId={c.peerId} last={c.lastMessage} unread={c.unread} active={c.peerId === activePeerId} />
        ))}
      </AnimatePresence>
    </motion.ul>
  );
}

function ConversationRow({ peerId, last, unread, active }: { peerId: string; last: Message; unread: number; active: boolean }) {
  const navigate = useNavigate();
  const peer = useChat((s) => s.users[peerId]);
  const typing = useChat((s) => !!s.typing[peerId]);
  const meId = useChat((s) => s.meId);
  const own = last.senderId === meId;

  return (
    <motion.li
      layout
      variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ type: 'spring', stiffness: 500, damping: 40 }}
    >
      <motion.button
        whileTap={{ scale: 0.98 }}
        onClick={() => navigate(`/c/${peerId}`)}
        className={cn(
          'relative flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors',
          active ? 'bg-brand-soft' : 'hover:bg-surface-2',
        )}
      >
        {active && (
          <motion.span layoutId="active-conv" className="absolute top-3 bottom-3 left-0 w-1 rounded-full brand-gradient" />
        )}
        <Avatar user={peer} size={52} online={peer?.online} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-[15.5px] font-semibold">{peer?.displayName ?? '…'}</p>
            <span className={cn('shrink-0 text-[11.5px]', unread ? 'font-semibold text-brand' : 'text-faint')}>
              {formatListStamp(last.createdAt)}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <div className="relative h-5 min-w-0 flex-1 overflow-hidden">
              <AnimatePresence mode="wait" initial={false}>
                {typing ? (
                  <motion.p
                    key="typing"
                    initial={{ y: 14, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -14, opacity: 0 }}
                    className="flex items-center gap-1.5 text-[13.5px] font-medium text-brand"
                  >
                    typing <TypingDots dot={4} />
                  </motion.p>
                ) : (
                  <motion.p
                    key={last.clientId ?? last.id}
                    initial={{ y: 14, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -14, opacity: 0 }}
                    className={cn('flex items-center gap-1 truncate text-[13.5px]', unread ? 'text-ink' : 'text-muted')}
                  >
                    {own && last.kind !== 'call' && <StatusTicks status={statusOf(last)} />}
                    <Preview m={last} own={own} />
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
            <AnimatePresence>
              {unread > 0 && (
                <motion.span
                  key="badge"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                  transition={{ type: 'spring', stiffness: 600, damping: 20 }}
                  className="brand-gradient flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold text-white"
                >
                  <motion.span key={unread} initial={{ y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
                    {unread > 99 ? '99+' : unread}
                  </motion.span>
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.button>
    </motion.li>
  );
}

function Preview({ m, own }: { m: Message; own: boolean }) {
  if (m.kind === 'ping') return <span className="truncate">👋 {own ? 'You sent a ping' : 'Pinged you'}</span>;
  if (m.kind === 'call' && m.meta) {
    const missed = !own && m.meta.outcome !== 'completed' && m.meta.outcome !== 'declined';
    const Icon = missed ? PhoneMissed : m.meta.media === 'video' ? Video : Phone;
    return (
      <span className={cn('flex items-center gap-1.5 truncate', missed && 'text-danger')}>
        <Icon size={14} />
        {missed ? 'Missed call' : m.meta.outcome === 'completed' ? `${m.meta.media === 'video' ? 'Video' : 'Voice'} call` : 'Call not answered'}
      </span>
    );
  }
  return <span className="truncate">{m.body}</span>;
}

function SearchResults({ query, onPicked }: { query: string; onPicked: () => void }) {
  const debounced = useDebounced(query, 220);
  const [state, setState] = useState<{ loading: boolean; users: (User & { online?: boolean })[] }>({ loading: true, users: [] });
  const upsertUser = useChat((s) => s.upsertUser);
  const navigate = useNavigate();

  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true }));
    api<{ users: User[] }>(`/users/search?q=${encodeURIComponent(debounced)}`, { signal: ctrl.signal })
      .then(({ users }) => setState({ loading: false, users }))
      .catch(() => !ctrl.signal.aborted && setState({ loading: false, users: [] }));
    return () => ctrl.abort();
  }, [debounced]);

  if (state.loading && state.users.length === 0) {
    return (
      <div className="flex justify-center py-10 text-muted">
        <Spinner />
      </div>
    );
  }

  if (state.users.length === 0) {
    return <p className="px-6 py-10 text-center text-sm text-muted">No one found for “{query}”.</p>;
  }

  return (
    <ul className="space-y-0.5 px-2">
      <p className="px-3 pt-1 pb-2 text-xs font-semibold tracking-wider text-faint uppercase">People</p>
      {state.users.map((u, i) => (
        <motion.li key={u.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              upsertUser(u);
              onPicked();
              navigate(`/c/${u.id}`);
            }}
            className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
          >
            <Avatar user={u} size={46} online={u.online} />
            <div className="min-w-0">
              <p className="truncate font-semibold">{u.displayName}</p>
              <p className="truncate text-sm text-muted">@{u.username}</p>
            </div>
          </motion.button>
        </motion.li>
      ))}
    </ul>
  );
}
