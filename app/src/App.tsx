import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { CloudOff } from 'lucide-react';
import { useAuth } from './stores/auth';
import { useCall } from './stores/call';
import { useTheme } from './stores/theme';
import { AuthScreen } from './features/auth/AuthScreen';
import { Shell } from './features/chat/Shell';
import { PingOverlay } from './features/chat/PingOverlay';
import { CallLayer } from './features/call/CallLayer';
import { Toaster } from './components/Toaster';
import { LogoMark } from './components/Logo';
import { Button } from './components/Button';
import { ServerSheet } from './components/ServerSheet';
import { onBackButton } from './lib/native';
import { unlockAudio } from './lib/sounds';
import { onCallAction } from './lib/push';

export default function App() {
  const status = useAuth((s) => s.status);
  const bootstrap = useAuth((s) => s.bootstrap);
  useTheme(); // applies theme + status bar on start

  // Answer / tap on an incoming-call notification (may arrive before sign-in completes).
  useEffect(() => onCallAction((a) => useCall.getState().handleCallAction(a)), []);

  useEffect(() => {
    void bootstrap();
    // Browsers only allow audio after a gesture; prime it on the first tap.
    const prime = () => unlockAudio();
    window.addEventListener('pointerdown', prime, { once: true });
    return () => window.removeEventListener('pointerdown', prime);
  }, [bootstrap]);

  return (
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <AnimatePresence mode="wait">
          {status === 'loading' && <Splash key="splash" />}
          {status === 'unreachable' && <Unreachable key="offline" />}
          {status === 'guest' && (
            <Screen key="auth">
              <AuthScreen />
            </Screen>
          )}
          {status === 'authed' && (
            <Screen key="app">
              <AuthedApp />
            </Screen>
          )}
        </AnimatePresence>
        <Toaster />
      </BrowserRouter>
    </MotionConfig>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      className="h-full"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.02 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

function AuthedApp() {
  const navigate = useNavigate();
  const location = useLocation();

  // Toast taps & other deep links.
  useEffect(() => {
    const open = (e: Event) => navigate(`/c/${(e as CustomEvent<string>).detail}`);
    window.addEventListener('najik:open-chat', open);
    return () => window.removeEventListener('najik:open-chat', open);
  }, [navigate]);

  // Android hardware back: close overlays → minimise call → leave chat → minimise app.
  useEffect(
    () =>
      onBackButton(() => {
        const ev = new Event('najik:back', { cancelable: true });
        window.dispatchEvent(ev);
        if (ev.defaultPrevented) return true;
        const call = useCall.getState();
        if (call.phase === 'incoming') return true;
        if (call.phase !== 'idle' && call.phase !== 'ended' && !call.minimized) {
          call.setMinimized(true);
          return true;
        }
        if (location.pathname !== '/') {
          navigate('/');
          return true;
        }
        return false;
      }),
    [navigate, location.pathname],
  );

  return (
    <>
      <Routes>
        <Route path="/" element={<Shell />} />
        <Route path="/c/:peerId" element={<Shell />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <PingOverlay />
      <CallLayer />
    </>
  );
}

function Splash() {
  return (
    <motion.div
      className="flex h-full flex-col items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.1 }}
    >
      <LogoMark size={76} />
      <motion.div
        className="mt-8 h-1 w-24 overflow-hidden rounded-full bg-surface-2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
      >
        <motion.div
          className="brand-gradient h-full w-1/2 rounded-full"
          animate={{ x: ['-100%', '200%'] }}
          transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
        />
      </motion.div>
    </motion.div>
  );
}

function Unreachable() {
  const bootstrap = useAuth((s) => s.bootstrap);
  const [serverOpen, setServerOpen] = useState(false);
  return (
    <motion.div
      className="flex h-full flex-col items-center justify-center px-8 text-center"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
    >
      <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-[26px] bg-surface-2 text-muted">
        <CloudOff size={36} />
      </div>
      <h2 className="text-xl font-bold">Can't reach Najik</h2>
      <p className="mt-2 max-w-xs text-sm text-muted">Check your internet connection or the server address.</p>
      <Button className="mt-6 w-56" onClick={() => void bootstrap()}>
        Try again
      </Button>
      <button className="mt-3 text-sm font-semibold text-brand" onClick={() => setServerOpen(true)}>
        Change server
      </button>
      <ServerSheet open={serverOpen} onClose={() => setServerOpen(false)} onSaved={() => void bootstrap()} />
    </motion.div>
  );
}
