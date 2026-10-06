import { motion } from 'motion/react';
import { Phone, PhoneOff, Video } from 'lucide-react';
import { useCall } from '../../stores/call';
import { Avatar } from '../../components/Avatar';
import { unlockAudio } from '../../lib/sounds';

export function IncomingCall() {
  const peer = useCall((s) => s.peer);
  const media = useCall((s) => s.media);
  const accept = useCall((s) => s.accept);
  const decline = useCall((s) => s.decline);
  const hue = peer?.avatarHue ?? 260;

  return (
    <motion.div
      className="fixed inset-0 z-[75] flex flex-col items-center justify-between overflow-hidden bg-neutral-950 text-white"
      initial={{ opacity: 0, y: '6%' }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 1.06, transition: { duration: 0.25 } }}
      transition={{ type: 'spring', stiffness: 260, damping: 30 }}
    >
      <div
        className="absolute inset-0 opacity-70"
        style={{
          background: `radial-gradient(120% 80% at 50% 0%, hsl(${hue} 70% 35%) 0%, transparent 60%), radial-gradient(90% 60% at 50% 100%, hsl(${(hue + 50) % 360} 70% 25%) 0%, transparent 70%)`,
        }}
      />
      <div className="aurora opacity-40" />

      <div className="pt-safe relative mt-16 flex flex-col items-center px-6 text-center">
        <motion.p
          className="mb-10 flex items-center gap-2 text-sm font-medium tracking-wide text-white/70"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          {media === 'video' ? <Video size={16} /> : <Phone size={16} />}
          Incoming {media === 'video' ? 'video' : 'voice'} call
        </motion.p>
        <div className="relative flex items-center justify-center">
          {[0, 0.8, 1.6].map((d) => (
            <span
              key={d}
              className="ring-pulse absolute h-36 w-36 rounded-full border border-white/40"
              style={{ animationDelay: `${d}s` }}
            />
          ))}
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 220, damping: 16, delay: 0.1 }}
          >
            <Avatar user={peer} size={144} />
          </motion.div>
        </div>
        <motion.h2
          className="mt-10 text-3xl font-extrabold tracking-tight"
          initial={{ y: 16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          {peer?.displayName}
        </motion.h2>
        <p className="mt-1 text-white/60">@{peer?.username}</p>
      </div>

      <div className="pb-safe relative mb-16 flex w-full max-w-sm items-center justify-around px-8">
        <CallAction label="Decline" color="bg-danger" onClick={decline} delay={0.25}>
          <PhoneOff size={30} />
        </CallAction>
        <CallAction
          label="Accept"
          color="bg-success"
          onClick={() => {
            unlockAudio();
            void accept();
          }}
          delay={0.3}
          bounce
        >
          {media === 'video' ? <Video size={30} /> : <Phone size={30} />}
        </CallAction>
      </div>
    </motion.div>
  );
}

function CallAction({
  label,
  color,
  onClick,
  children,
  delay,
  bounce,
}: {
  label: string;
  color: string;
  onClick: () => void;
  children: React.ReactNode;
  delay: number;
  bounce?: boolean;
}) {
  return (
    <motion.div
      className="flex flex-col items-center gap-3"
      initial={{ y: 60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 20, delay }}
    >
      <motion.button
        aria-label={label}
        onClick={onClick}
        whileTap={{ scale: 0.86 }}
        animate={bounce ? { y: [0, -10, 0, -5, 0], rotate: [0, -8, 8, -4, 0] } : undefined}
        transition={bounce ? { duration: 1.2, repeat: Infinity, repeatDelay: 0.8 } : undefined}
        className={`relative flex h-[76px] w-[76px] items-center justify-center rounded-full text-white ${color}`}
      >
        {bounce && <span className={`ring-pulse absolute inset-0 rounded-full ${color}`} />}
        <span className="relative">{children}</span>
      </motion.button>
      <span className="text-sm font-medium text-white/80">{label}</span>
    </motion.div>
  );
}
