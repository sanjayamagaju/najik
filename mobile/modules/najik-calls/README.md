# najik-calls (local Expo module)

Native incoming-call UX that no maintained library covers for RN 0.86 / New Architecture
(`react-native-callkeep` was last published Nov 2024 and is a legacy bridge module built around a Telecom
`ConnectionService`; `react-native-voip-push-notification` is unmaintained). Autolinked from `modules/`;
JS facade in `index.ts`, used through `features/calls/native/callNative.ts`. **Compiled code has not been
built in this repo's CI environment — verify on devices.**

## iOS (Swift)

- `NajikCallsAppDelegateSubscriber` registers `PKPushRegistry` (VoIP) in `didFinishLaunching`.
- `CallCenter` reports **every** VoIP push to CallKit inside the PushKit callback (expired / malformed pushes are
  reported and ended immediately, as iOS requires), then emits `onIncomingPush` and an `onCallAction{show}`.
- CallKit actions (answer / end / mute) become `onCallAction` events, buffered until JS listens
  (`consumePendingActions()` on cold start). `didActivate`/`didDeactivate` audio session → `onAudioSession` →
  `RTCAudioSession.audioSessionDidActivate()`.
- JS reports outgoing calls (`CXStartCallAction`), connection, in-app answer/end/mute and remote endings.
- Requires `UIBackgroundModes` `voip` + `audio` (set in `app.config.ts`) and the push entitlement.

## Android (Kotlin)

- `calls` channel (high importance, default ringtone with `USAGE_NOTIFICATION_RINGTONE`, vibration) and a silent
  `calls_ongoing` channel.
- `showIncomingCall`: `NotificationCompat.CallStyle.forIncomingCall` with Answer (opens the activity directly —
  no trampolines) / Decline (broadcast), full-screen intent, `FLAG_INSISTENT`, auto-timeout at `expires_at`.
- `CallActivityLifecycleListener` turns Answer / full-screen launches into `onCallAction` events and enables
  `showWhenLocked`/`turnScreenOn` only for calls (JS clears it when the call ends).
- `OngoingCallService`: typed foreground service (`microphone`, `+camera` for video) with a `forOngoingCall`
  notification and Hang up action, started when a call connects.
- `canUseFullScreenIntent()` / `openFullScreenIntentSettings()` for Android 14+.

Limitation: Decline from the notification while the app process is dead is buffered; with no socket to send
`call.decline`, the caller sees the server's 45 s ring timeout instead of "declined".
