import { AnimatePresence, motion, useDragControls } from 'motion/react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/utils';

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
  /** Use dark glass styling (call screen). */
  dark?: boolean;
}

/** Bottom sheet on mobile, centered card on wide screens. Drag down to dismiss. */
export function Sheet({ open, onClose, title, children, className, dark }: Props) {
  const controls = useDragControls();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const onBack = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    window.addEventListener('najik:back', onBack);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('najik:back', onBack);
    };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center">
          <motion.div
            className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-label={title}
            className={cn(
              'pb-safe relative w-full max-w-md overflow-hidden rounded-t-[28px] shadow-soft sm:mb-0 sm:rounded-[28px]',
              dark ? 'bg-neutral-900/90 text-white backdrop-blur-2xl' : 'bg-surface text-ink',
              className,
            )}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            drag="y"
            dragListener={false}
            dragControls={controls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 90 || info.velocity.y > 600) onClose();
            }}
          >
            <div
              className="flex cursor-grab touch-none justify-center pt-3 pb-2 active:cursor-grabbing"
              onPointerDown={(e) => controls.start(e)}
            >
              <div className={cn('h-1.5 w-10 rounded-full', dark ? 'bg-white/25' : 'bg-surface-3')} />
            </div>
            {title && <h2 className="px-6 pt-2 pb-1 text-lg font-bold">{title}</h2>}
            <div className="max-h-[75vh] overflow-y-auto px-3 pb-4">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
