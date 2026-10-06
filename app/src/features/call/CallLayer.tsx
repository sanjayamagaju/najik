import { AnimatePresence } from 'motion/react';
import { useCall } from '../../stores/call';
import { IncomingCall } from './IncomingCall';
import { CallScreen } from './CallScreen';
import { MiniCall } from './MiniCall';
import { RemoteAudio } from './media';

export function CallLayer() {
  const phase = useCall((s) => s.phase);
  const minimized = useCall((s) => s.minimized);
  const remoteStream = useCall((s) => s.remoteStream);

  const inCall = phase === 'outgoing' || phase === 'connecting' || phase === 'active' || phase === 'ended';

  return (
    <>
      <RemoteAudio stream={remoteStream} />
      <AnimatePresence>
        {phase === 'incoming' && <IncomingCall key="incoming" />}
        {inCall && !minimized && <CallScreen key="call" />}
        {inCall && minimized && phase !== 'ended' && <MiniCall key="mini" />}
      </AnimatePresence>
    </>
  );
}
