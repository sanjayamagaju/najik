import {
  decideForegroundPresentation,
  getPushHandler,
  routeForPayload,
} from '@/services/notifications/presentation';
import type { PushPayload } from '@/types/protocol';

import { setCallPushSink } from '../push';

const incoming: PushPayload = {
  type: 'call.incoming',
  call_id: 'call-1',
  caller_id: 'peer-1',
  caller_name: 'Arjun Rai',
  media: 'video',
  expires_at: '2026-10-07T09:41:45.000Z',
};

describe('call push handlers', () => {
  const ctx = { activeConversationId: null, appActive: true };

  it('never shows an OS banner for call pushes in the foreground', () => {
    expect(decideForegroundPresentation(incoming, ctx)).toEqual({ kind: 'suppress' });
    expect(
      decideForegroundPresentation(
        { type: 'call.ended', call_id: 'call-1', reason: 'missed' },
        ctx,
      ),
    ).toEqual({ kind: 'suppress' });
  });

  it('hands foreground pushes to the call controller sink', () => {
    const sink = { incoming: jest.fn(), ended: jest.fn() };
    setCallPushSink(sink);
    getPushHandler(incoming)?.onReceive?.(incoming);
    const ended: PushPayload = { type: 'call.ended', call_id: 'call-1', reason: 'cancelled' };
    getPushHandler(ended)?.onReceive?.(ended);
    expect(sink.incoming).toHaveBeenCalledWith(incoming);
    expect(sink.ended).toHaveBeenCalledWith('call-1', 'cancelled');
    setCallPushSink(null);
  });

  it('tapping an incoming-call alert opens the call screen for that call', () => {
    expect(routeForPayload(incoming)).toBe(
      '/call/peer-1?media=video&callId=call-1&callerName=Arjun%20Rai',
    );
  });
});
