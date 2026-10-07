import type { Call, CallEndReason } from '@/types/protocol';

import {
  type CallEvent,
  type CallMachineState,
  callDurationSec,
  endCopy,
  initialCallState,
  isBusy,
  localHangupOutcome,
  transition,
} from '../callMachine';

const peer = { id: 'peer-1', display_name: 'Arjun', avatar_color: '#7C5CFF' };

function run(events: CallEvent[], from: CallMachineState = initialCallState): CallMachineState {
  return events.reduce(transition, from);
}

const dial: CallEvent = {
  type: 'DIAL',
  callId: 'c1',
  peer,
  media: 'video',
  conversationId: 'conv-1',
  at: 1_000,
};
const incoming: CallEvent = {
  type: 'INCOMING',
  callId: 'c2',
  peer,
  media: 'audio',
  conversationId: null,
  at: 1_000,
};

function call(overrides: Partial<Call> = {}): Call {
  return {
    id: 'c1',
    caller_id: 'me',
    callee_id: 'peer-1',
    media: 'video',
    state: 'ringing',
    created_at: '',
    answered_at: null,
    ended_at: null,
    end_reason: null,
    ...overrides,
  };
}

describe('call state machine — outgoing', () => {
  it('idle → outgoing → ringing → connecting → connected ⇄ reconnecting', () => {
    let s = run([dial]);
    expect(s).toMatchObject({
      phase: 'outgoing',
      callId: 'c1',
      direction: 'outgoing',
      startedAt: 1_000,
    });
    s = run(
      [
        { type: 'INVITE_ACKED', call: call(), at: 1_100 },
        { type: 'REMOTE_RINGING', callId: 'c1' },
      ],
      s,
    );
    expect(s.phase).toBe('ringing');
    s = transition(s, { type: 'REMOTE_ACCEPTED', callId: 'c1' });
    expect(s).toMatchObject({ phase: 'connecting', accepted: true });
    s = transition(s, { type: 'MEDIA_CONNECTED', at: 5_000 });
    expect(s).toMatchObject({ phase: 'connected', connectedAt: 5_000 });
    s = transition(s, { type: 'MEDIA_INTERRUPTED' });
    expect(s).toMatchObject({ phase: 'reconnecting', reconnects: 1 });
    s = transition(s, { type: 'MEDIA_CONNECTED', at: 9_000 });
    expect(s).toMatchObject({ phase: 'connected', connectedAt: 5_000 }); // duration keeps running
  });

  it('accepted straight from outgoing (no ringing event) also connects', () => {
    expect(run([dial, { type: 'REMOTE_ACCEPTED', callId: 'c1' }]).phase).toBe('connecting');
  });

  it('busy callee: the ack carries an ended call', () => {
    const s = run([
      dial,
      { type: 'INVITE_ACKED', call: call({ state: 'ended', end_reason: 'busy' }), at: 2 },
    ]);
    expect(s).toMatchObject({ phase: 'ended', endReason: 'busy' });
    // …and the follow-up call.ended{busy} is a no-op.
    expect(transition(s, { type: 'SERVER_ENDED', callId: 'c1', reason: 'busy', at: 3 })).toBe(s);
  });

  it('caller already in a call / offline / permission denied end with client reasons', () => {
    expect(run([dial, { type: 'INVITE_FAILED', reason: 'in_another_call', at: 2 }]).endReason).toBe(
      'in_another_call',
    );
    expect(
      run([dial, { type: 'LOCAL_FAILURE', reason: 'permission_denied', at: 2 }]).endReason,
    ).toBe('permission_denied');
  });

  it.each<[CallEndReason]>([['declined'], ['timeout'], ['missed'], ['failed'], ['busy']])(
    'server end reason %s ends the call',
    (reason) => {
      const s = run([dial, { type: 'SERVER_ENDED', callId: 'c1', reason, at: 3 }]);
      expect(s).toMatchObject({ phase: 'ended', endReason: reason, endedAt: 3 });
    },
  );

  it('local hang-up: cancelled before answer, completed after', () => {
    expect(run([dial, { type: 'HANGUP', at: 2 }]).endReason).toBe('cancelled');
    expect(
      run([
        dial,
        { type: 'REMOTE_ACCEPTED', callId: 'c1' },
        { type: 'MEDIA_CONNECTED', at: 2 },
        { type: 'HANGUP', at: 9 },
      ]).endReason,
    ).toBe('completed');
  });

  it('one call at a time: DIAL while live is ignored', () => {
    const s = run([dial]);
    expect(transition(s, { ...dial, callId: 'other' })).toBe(s);
  });
});

describe('call state machine — incoming', () => {
  it('incoming → connecting (accept) → connected', () => {
    let s = run([incoming]);
    expect(s).toMatchObject({ phase: 'incoming', direction: 'incoming', callId: 'c2' });
    s = transition(s, { type: 'ACCEPT', callId: 'c2' });
    expect(s).toMatchObject({ phase: 'connecting', accepting: true, accepted: false });
    s = transition(s, { type: 'ACCEPT_ACKED', callId: 'c2' });
    expect(s).toMatchObject({ accepting: false, accepted: true });
    expect(transition(s, { type: 'MEDIA_CONNECTED', at: 4 }).phase).toBe('connected');
  });

  it('double accept is ignored', () => {
    const s = run([incoming, { type: 'ACCEPT', callId: 'c2' }]);
    expect(transition(s, { type: 'ACCEPT', callId: 'c2' })).toBe(s);
  });

  it('race: accept after the caller cancelled is a no-op', () => {
    const s = run([incoming, { type: 'SERVER_ENDED', callId: 'c2', reason: 'cancelled', at: 5 }]);
    expect(s.endReason).toBe('cancelled');
    expect(transition(s, { type: 'ACCEPT', callId: 'c2' })).toBe(s);
  });

  it('race: accept ack fails with call_not_found (cancelled in flight)', () => {
    const s = run([
      incoming,
      { type: 'ACCEPT', callId: 'c2' },
      { type: 'ACCEPT_FAILED', callId: 'c2', reason: 'cancelled', at: 6 },
    ]);
    expect(s).toMatchObject({ phase: 'ended', endReason: 'cancelled' });
  });

  it('answered elsewhere ends silently', () => {
    const s = run([
      incoming,
      { type: 'SERVER_ENDED', callId: 'c2', reason: 'answered_elsewhere', at: 7 },
    ]);
    expect(s.endReason).toBe('answered_elsewhere');
    expect(endCopy(s).silent).toBe(true);
  });

  it('ended arriving twice keeps the first reason', () => {
    const once = run([incoming, { type: 'SERVER_ENDED', callId: 'c2', reason: 'timeout', at: 7 }]);
    const twice = transition(once, { type: 'SERVER_ENDED', callId: 'c2', reason: 'failed', at: 8 });
    expect(twice).toBe(once);
  });

  it('events for another call id are ignored', () => {
    const s = run([incoming]);
    expect(transition(s, { type: 'SERVER_ENDED', callId: 'zzz', reason: 'missed', at: 1 })).toBe(s);
    expect(transition(s, { type: 'ACCEPT', callId: 'zzz' })).toBe(s);
    expect(transition(s, { type: 'REMOTE_ACCEPTED', callId: 'c2' })).toBe(s); // callee never gets that
  });

  it('a second incoming call while busy does not replace the current one', () => {
    const s = run([dial]);
    expect(isBusy(s)).toBe(true);
    expect(transition(s, incoming)).toBe(s);
  });

  it('a stale replay of the call that just ended does not ring again', () => {
    const ended = run([incoming, { type: 'SERVER_ENDED', callId: 'c2', reason: 'missed', at: 2 }]);
    expect(transition(ended, incoming)).toBe(ended);
    expect(transition(ended, { ...incoming, callId: 'c3' }).phase).toBe('incoming');
  });

  it('declining locally ends as declined', () => {
    expect(run([incoming, { type: 'HANGUP', at: 2 }]).endReason).toBe('declined');
  });
});

describe('helpers', () => {
  it('localHangupOutcome maps phase → server action', () => {
    expect(localHangupOutcome(run([incoming]))).toEqual({ action: 'decline' });
    expect(localHangupOutcome(run([dial]))).toEqual({ action: 'hangup', reason: 'cancelled' });
    expect(localHangupOutcome(run([dial, { type: 'REMOTE_ACCEPTED', callId: 'c1' }]))).toEqual({
      action: 'hangup',
      reason: 'completed',
    });
    expect(localHangupOutcome(initialCallState)).toBeNull();
  });

  it('RESET only from ended/idle', () => {
    const ended = run([dial, { type: 'HANGUP', at: 2 }]);
    expect(transition(ended, { type: 'RESET' })).toBe(initialCallState);
    const live = run([dial]);
    expect(transition(live, { type: 'RESET' })).toBe(live);
  });

  it('duration counts connected time only', () => {
    const s = run([
      dial,
      { type: 'REMOTE_ACCEPTED', callId: 'c1' },
      { type: 'MEDIA_CONNECTED', at: 10_000 },
      { type: 'HANGUP', at: 75_500 },
    ]);
    expect(callDurationSec(s, 999_999)).toBe(65);
    expect(callDurationSec(run([dial]), 50_000)).toBe(0);
  });

  it('end copy is user friendly per reason and direction', () => {
    const out = (reason: CallEndReason) =>
      endCopy(run([dial, { type: 'SERVER_ENDED', callId: 'c1', reason, at: 2 }]));
    expect(out('busy').title).toBe('Arjun is on another call');
    expect(out('declined').title).toBe('Arjun declined');
    expect(out('timeout').title).toBe('No answer');
    expect(out('failed').title).toBe('Call dropped');
    expect(
      endCopy(run([incoming, { type: 'SERVER_ENDED', callId: 'c2', reason: 'cancelled', at: 2 }]))
        .title,
    ).toBe('Missed call');
    expect(
      endCopy(run([dial, { type: 'LOCAL_FAILURE', reason: 'permission_denied', at: 2 }])).title,
    ).toBe('Camera or microphone blocked');
  });
});
