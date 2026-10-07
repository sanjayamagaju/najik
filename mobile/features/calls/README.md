# features/calls — 1-to-1 audio & video calls

Contract: `docs/PROTOCOL.md` §4.2–4.4 (call frames), §5 (pushes). Engine: `services/webrtc/`.

## Pieces

| File                                 | Role                                                                                                                                                                                                              |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model/callMachine.ts`               | Pure state machine: `idle → outgoing → ringing → connecting → connected ⇄ reconnecting → ended(reason)` and `incoming → connecting → …`. Server-authoritative; duplicate/late events are no-ops.                  |
| `services/CallController.ts`         | Orchestrator (all side effects injected → unit-tested): WS frames, PeerSession, local media, quality, native call UX, metrics, store.                                                                             |
| `services/callService.ts`            | The singleton with real dependencies + `installCallHandlers()` (root layout, once per process), VoIP token registration, `startOutgoingCall()`.                                                                   |
| `push.ts`                            | `call.incoming` / `call.ended` push handlers. Imported from `index.ts` so they also run in headless JS (killed app).                                                                                              |
| `native/callNative.ts`               | Facade over the local `modules/najik-calls` Expo module (no-op when it's missing).                                                                                                                                |
| `store/callStore.ts`                 | Zustand store the UI renders from (machine + mute/speaker/camera, stream URLs, stats, quality prefs).                                                                                                             |
| `screens/CallScreen.tsx`             | `/call/[peerId]`: outgoing (pulsing avatar), incoming, connected audio, video (full-bleed remote + draggable PiP, auto-hiding controls), reconnecting overlay, ended summary. Keeps the screen awake.             |
| `components/IncomingCallOverlay.tsx` | Global full-screen incoming UI over any screen; navigates to the call screen when a call is answered from a notification/CallKit.                                                                                 |
| `components/QualitySheet.tsx`        | YouTube-style picker: Video Auto/1080p…144p ("Auto (720p)" shows what you actually receive), Audio Auto/High/Medium/Low, "Auto-limited" badge. The choice sets what you **receive** (sent as a `quality` signal). |

## Flows

- **Outgoing:** permissions → `getUserMedia` (local preview) → `call.invite` (client `call_id`) → `call.ringing`
  (ringback) → `call.accepted` → _only now_ create the PeerConnection and send the offer (the server relays
  `call.signal` only while the call is active). Busy callee = ack with an ended call; caller already in a call =
  ack error `busy` ("You're already in a call").
- **Incoming:** `call.incoming` (WS) or a push → ring (CallKit on iOS, in-app ringtone in the foreground on
  Android, full-screen notification when backgrounded/killed) → `call.ringing` → accept → `call.accept` ack →
  PeerConnection. Signals that race ahead of the accept ack (the caller's offer + candidates) are buffered and
  replayed in order. A second incoming call while busy is declined with `call.decline`.
  `call.accepted` with another `session_id` ⇒ answered on another device (closes silently).
- **Resilience:** ICE `failed` → restart now; `disconnected` → restart after 2.5 s; NetInfo network change →
  restart; WebSocket re-auth during a call → `GET /calls/{id}` (events sent while offline are lost) and, if still
  live, ICE restart (caller re-offers with `iceRestart: true`; callee sends `renegotiate`). 30 s without media in
  connecting/reconnecting → hang up as `failed`. A 55 s ring safety timer backs up the server's 45 s timeout.
- **End:** server reason wins; metrics are posted to `POST /calls/{id}/metrics` (best-effort, 4 attempts) when
  the call connected. The thread's `kind: "call"` bubble is tappable to call back.
- **Sign-out** hangs up first (`resetCalls()` in `authService.endSession`), and unregisters the `apns_voip` token.

Telemetry: breadcrumbs (`call` category) carry phases, reasons and error codes only — never SDP, candidates or
names.
