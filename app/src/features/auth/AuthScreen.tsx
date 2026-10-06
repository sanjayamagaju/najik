import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AtSign, Lock, Moon, Settings2, Sun, User as UserIcon } from 'lucide-react';
import { useAuth } from '../../stores/auth';
import { useTheme } from '../../stores/theme';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { LogoMark } from '../../components/Logo';
import { IconButton } from '../../components/IconButton';
import { ServerSheet } from '../../components/ServerSheet';
import { needsServerUrl } from '../../lib/config';
import { unlockAudio } from '../../lib/sounds';
import { cn } from '../../lib/utils';

type Mode = 'login' | 'register';

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [serverOpen, setServerOpen] = useState(needsServerUrl());
  const { login, register } = useAuth();
  const { dark, toggle } = useTheme();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    unlockAudio();
    if (needsServerUrl()) {
      setServerOpen(true);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') await login(username.trim(), password);
      else await register(username.trim(), displayName.trim() || username.trim(), password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex h-full flex-col overflow-y-auto">
      <div className="aurora" />
      <div className="pt-safe relative z-10 flex justify-end gap-1 px-4 pt-3">
        <IconButton label="Server settings" onClick={() => setServerOpen(true)}>
          <Settings2 size={20} />
        </IconButton>
        <IconButton label="Toggle theme" onClick={toggle}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={dark ? 'moon' : 'sun'}
              initial={{ rotate: -90, scale: 0.5, opacity: 0 }}
              animate={{ rotate: 0, scale: 1, opacity: 1 }}
              exit={{ rotate: 90, scale: 0.5, opacity: 0 }}
            >
              {dark ? <Moon size={20} /> : <Sun size={20} />}
            </motion.span>
          </AnimatePresence>
        </IconButton>
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 pb-10">
        <div className="mb-9 flex flex-col items-center text-center">
          <LogoMark size={72} />
          <motion.h1
            className="mt-6 text-4xl font-extrabold tracking-tight"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, type: 'spring', stiffness: 200, damping: 20 }}
          >
            <span className="brand-text">Najik</span>
          </motion.h1>
          <motion.p
            className="mt-2 text-muted"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
          >
            Close conversations, crystal-clear calls.
          </motion.p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, type: 'spring', stiffness: 200, damping: 24 }}
          className="glass rounded-[28px] border border-line p-5 shadow-soft"
        >
          {/* Segmented control */}
          <div className="relative mb-5 grid grid-cols-2 rounded-2xl bg-surface-2 p-1">
            {(['login', 'register'] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setError(null);
                }}
                className={cn(
                  'relative z-10 h-10 rounded-xl text-sm font-semibold transition-colors',
                  mode === m ? 'text-ink' : 'text-muted',
                )}
              >
                {mode === m && (
                  <motion.span
                    layoutId="auth-pill"
                    className="absolute inset-0 -z-10 rounded-xl bg-surface shadow-soft"
                    transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                  />
                )}
                {m === 'login' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-3">
            <TextField
              label="Username"
              icon={AtSign}
              value={username}
              autoComplete="username"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
            <AnimatePresence initial={false}>
              {mode === 'register' && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 36 }}
                  className="overflow-hidden"
                >
                  <TextField
                    label="Display name"
                    icon={UserIcon}
                    value={displayName}
                    autoComplete="name"
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </motion.div>
              )}
            </AnimatePresence>
            <TextField
              label="Password"
              icon={Lock}
              type="password"
              value={password}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === 'register' ? 8 : undefined}
            />

            <AnimatePresence>
              {error && (
                <motion.p
                  key={error}
                  initial={{ opacity: 0, x: 0 }}
                  animate={{ opacity: 1, x: [0, -8, 8, -5, 5, 0] }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.4 }}
                  className="px-1 text-sm font-medium text-danger"
                >
                  {error}
                </motion.p>
              )}
            </AnimatePresence>

            <Button type="submit" loading={busy} className="mt-2 w-full">
              {mode === 'login' ? 'Sign in' : 'Create account'}
            </Button>
          </form>
        </motion.div>
      </div>

      <ServerSheet open={serverOpen} onClose={() => setServerOpen(false)} />
    </div>
  );
}
