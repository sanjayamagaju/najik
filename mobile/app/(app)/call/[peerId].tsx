import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';

import { RouteErrorBoundary } from '@/components/RouteErrorBoundary';
import { isLive } from '@/features/calls/model/callMachine';
import { CallScreen } from '@/features/calls/screens/CallScreen';
import { callController, startOutgoingCall } from '@/features/calls/services/callService';
import { callStore } from '@/features/calls/store/callStore';
import { routes } from '@/navigation/routes';

export { RouteErrorBoundary as ErrorBoundary };

/**
 * `/call/[peerId]?media=&conversationId=` dials (chat header, call-log tap, "Call again");
 * with `callId` it shows that incoming call (iOS alert-push fallback). If a call is already
 * live this route just shows it — one call at a time.
 */
export default function CallRoute() {
  const params = useLocalSearchParams<{
    peerId: string;
    media?: string;
    conversationId?: string;
    callId?: string;
    callerName?: string;
  }>();
  const handled = useRef(false);

  const exit = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(routes.chats);
  }, []);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const { machine } = callStore.getState();
    if (isLive(machine.phase)) return;
    if (machine.phase === 'ended') callController.dismissEnded();
    const media = params.media === 'video' ? 'video' : 'audio';
    if (!params.peerId) return;
    if (params.callId) {
      callController.handleIncomingPush(
        {
          call_id: params.callId,
          caller_id: params.peerId,
          caller_name: params.callerName ?? '',
          media,
          expires_at: '',
        },
        { nativeRinging: false },
      );
      return;
    }
    void startOutgoingCall(params.peerId, media, params.conversationId ?? null).then((ok) => {
      if (!ok) exit();
    });
  }, [params.peerId, params.media, params.conversationId, params.callId, params.callerName, exit]);

  return <CallScreen onExit={exit} />;
}
