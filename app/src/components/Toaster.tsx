import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { useToasts, type Toast } from '../stores/toast';
import { Avatar } from './Avatar';
import { cn } from '../lib/utils';

function ToastIcon({ t }: { t: Toast }) {
  if (t.user) return <Avatar user={t.user} size={38} />;
  if (t.tone === 'error') return <AlertCircle className="text-danger" size={22} />;
  if (t.tone === 'success') return <CheckCircle2 className="text-success" size={22} />;
  return <Info className="text-brand" size={22} />;
}

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="pt-safe pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-2 px-3">
      <div className="h-2" />
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: -40, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -24, scale: 0.94, transition: { duration: 0.2 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.8, bottom: 0.1 }}
            onDragEnd={(_, info) => info.offset.y < -30 && dismiss(t.id)}
            onClick={() => {
              t.onClick?.();
              dismiss(t.id);
            }}
            className={cn(
              'glass pointer-events-auto flex w-full max-w-sm cursor-pointer items-center gap-3 rounded-2xl border border-line px-3.5 py-3 shadow-soft',
              t.tone === 'error' && 'border-danger/30',
            )}
          >
            <ToastIcon t={t} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold">{t.title}</p>
              {t.description && <p className="line-clamp-2 text-[13px] text-muted">{t.description}</p>}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
