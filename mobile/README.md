# Najik mobile

Expo (SDK 57) + React Native 0.86 + TypeScript (strict) + Expo Router + Zustand.
The REST/WebSocket contract lives in [`../docs/PROTOCOL.md`](../docs/PROTOCOL.md); decisions in
[`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).

Auth, sessions, chats, messages, Ping, presence, typing, receipts, push notifications, settings and
1-to-1 WebRTC audio/video calls with adaptive quality — see [Calls](#calls), `features/calls/README.md`,
`services/webrtc/README.md` and `modules/najik-calls/README.md`.

## Setup

```bash
cd mobile
npm install
cp .env.example .env   # public config only — never put secrets here
```

| Variable                                            | Required      | Notes                                                                                                                                                         |
| --------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_ENV`                                           | yes           | `development` \| `staging` \| `production`. Set per EAS profile. Picks bundle id (`com.najik.app.dev`, `.staging`, `com.najik.app`), app name and URL scheme. |
| `EXPO_PUBLIC_API_URL`                               | yes (non-dev) | Backend origin, e.g. `https://api.najik.app` (`/api/v1` is appended). Dev default `http://localhost:8000`.                                                    |
| `EXPO_PUBLIC_WS_URL`                                | no            | Defaults to the API host + `/ws/v1/` with `ws(s)://`.                                                                                                         |
| `EXPO_PUBLIC_SENTRY_DSN`                            | no            | Sentry is disabled when empty.                                                                                                                                |
| `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` | build only    | Source-map upload (EAS secret for the token).                                                                                                                 |
| `GOOGLE_SERVICES_JSON`                              | build only    | EAS **file** env var with the Firebase `google-services.json`.                                                                                                |
| `EAS_PROJECT_ID`, `EXPO_OWNER`                      | build only    | From `eas init`.                                                                                                                                              |

**Runtime guard:** staging/production builds refuse to start (config error screen) unless the
API uses `https://` and the socket uses `wss://`. Cleartext is allowed only for `APP_ENV=development`
(Android `usesCleartextTraffic` is also only enabled there).

## Running (development build — Expo Go is not supported)

The app uses native modules (SecureStore, notifications with native FCM/APNs tokens, Sentry,
WebRTC, CallKit/PushKit and the local `modules/najik-calls`), so use a dev client:

```bash
npx expo run:android            # local build (needs Android SDK + JDK 17)
npx expo run:ios                # macOS + Xcode
# or build the dev client in the cloud once, then just start Metro:
npx eas-cli@latest build --profile development --platform android
npm start                       # expo start --dev-client
```

Android emulator → local backend: `adb reverse tcp:8000 tcp:8000` (or set
`EXPO_PUBLIC_API_URL=http://10.0.2.2:8000`).

## Quality gates

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint (expo flat config + prettier)
npm test            # jest-expo + @testing-library/react-native
npm run format      # prettier --write
npx expo export --platform android   # proves the JS bundle builds
npx expo-doctor
```

## EAS build & submit

Profiles in `eas.json` (`appVersionSource: remote`, `autoIncrement` on store/internal builds):

| Profile                                 | APP_ENV     | Distribution            | EAS environment |
| --------------------------------------- | ----------- | ----------------------- | --------------- |
| `development` / `development-simulator` | development | internal (dev client)   | development     |
| `staging`                               | staging     | internal (APK / ad-hoc) | preview         |
| `production`                            | production  | store (AAB / App Store) | production      |

```bash
npx eas-cli@latest init                                  # once; sets EAS_PROJECT_ID
npx eas-cli@latest env:create --environment production --name EXPO_PUBLIC_API_URL --value https://api.najik.app
npx eas-cli@latest env:create --environment production --name SENTRY_AUTH_TOKEN --value … --visibility secret
npx eas-cli@latest env:create --environment production --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json
npx eas-cli@latest build --profile staging --platform all
npx eas-cli@latest build --profile production --platform all
npx eas-cli@latest submit --profile production --platform android   # Play internal/production track
npx eas-cli@latest submit --profile production --platform ios       # App Store Connect / TestFlight
```

### Signing

- **Credentials are EAS-managed** (`eas credentials`): Android upload keystore and iOS
  distribution certificate/provisioning profiles live on EAS, never in the repo
  (`*.jks`, `*.p8`, `*.p12`, `*.keystore` are git-ignored).
- **Android:** enrol in **Play App Signing**; EAS signs with the _upload_ key, Google re-signs.
  For `eas submit`, add a Google Play service-account JSON as an EAS secret/file.
- **iOS:** use an **App Store Connect API key** (`eas credentials` → App Store Connect API Key) for
  non-interactive builds/submits; set `ascAppId` in `eas.json` `submit.production.ios` once the
  app record exists.

### Push (FCM / APNs — not the Expo push service)

The app registers the **native** device token (`getDevicePushTokenAsync`) with
`PUT /devices/push-token` (`fcm` on Android, `apns` on iOS) after sign-in, when permission is
granted, and whenever the OS rotates it; it is deleted on logout.

- **Android/FCM:** create a Firebase project per environment (package ids above), download
  `google-services.json`, upload it as the `GOOGLE_SERVICES_JSON` EAS file variable. The backend
  holds the FCM service account. Channel ids used by the server must be `messages`, `pings` and
  `calls` (created natively with the ringtone). Ping and incoming-call pushes are data-only and are
  presented by the app's background notification task.
- **iOS/APNs:** the APNs key (`.p8`) is configured on the **backend**; EAS manages the push
  entitlement (`aps-environment` is `development` for dev builds, `production` otherwise). The same
  token-based key also sends VoIP pushes (see [Calls](#calls)).

## Project layout

```
app/          Expo Router routes only (thin): (auth)/, (app)/(tabs)/, chat/[id], account/*, call/[peerId]
components/   design-system primitives (Text, Button, Avatar, PresenceDot, Sheet, Toast, …)
features/     auth, chats, messages, ping, presence, settings, calls
screens/      cross-feature screens (config error)
navigation/   route helpers, notification → route handling
services/     api (axios + token manager), websocket, notifications, storage, realtime, telemetry, webrtc
modules/      local Expo modules (najik-calls: CallKit/PushKit, Android incoming-call notification + FGS)
store/        Zustand stores + crash-safe, versioned persistence
constants/    design tokens (theme.ts)
config/       env config + https/wss guard
types/        contract types mirroring PROTOCOL.md
utils/        dates, emoji detection, backoff, haptics, guards
scripts/      asset/emoji data generators
```

Brand bitmaps are generated by `node scripts/generate-brand-assets.mjs`; the offline emoji
dataset by `node scripts/generate-emoji-data.mjs`.

## Calls

1-to-1 audio/video over P2P WebRTC (STUN + TURN from the backend), signaling over the app socket
(PROTOCOL §4.2–4.4). Pieces: `react-native-webrtc` (+ its Expo config plugin),
`react-native-incall-manager` (audio routing, proximity, ringtone/ringback), `expo-keep-awake`, and the
local `modules/najik-calls` module for CallKit/PushKit (iOS) and the full-screen incoming-call
notification + call foreground service (Android).

**A development build is required** (`expo run:*` or `eas build --profile development`); Expo Go has
none of these native modules. `react-native-webrtc` and `react-native-incall-manager` are legacy bridge
modules that run through React Native's New Architecture interop layer; they are excluded from
expo-doctor's React Native Directory check in `package.json` for that reason — re-check them on device
after every RN upgrade.

### TURN

ICE servers come from the backend (`call.invite`/`call.accept` acks, `call.incoming`, and
`GET /calls/ice-servers` when credentials are about to expire). Nothing is configured in the app. On the
server set `STUN_URLS`, `TURN_URLS` (udp + tcp + `turns:` 5349) and `TURN_SECRET` (coturn
`use-auth-secret`); without TURN, calls between symmetric NATs/cellular networks will not connect.

### Testing calls

- Two physical devices (or one device + an emulator/simulator) signed in as **different** users who
  share a chat; open the chat and use the header buttons, or tap a call bubble to call back.
- Android emulator: enable the virtual camera (AVD → Advanced → Camera: Emulated/Webcam) and microphone
  access (Extended controls → Microphone → "Virtual microphone uses host audio input"). Point it at a
  backend reachable from both devices (not `localhost`): e.g. `EXPO_PUBLIC_API_URL=http://<LAN-IP>:8000`.
- iOS Simulator has no camera (black video) and does not receive VoIP pushes; use a device for CallKit.
- Backgrounded/killed callee: Android shows the full-screen call notification from the FCM push;
  iOS rings through CallKit from the VoIP push. Test lock screen answer, Bluetooth/wired headsets,
  Wi-Fi ⇄ cellular switches (ICE restart) and airplane mode < 30 s (call survives) / > 30 s (`failed`).
- Debug quality: the quality sheet shows "Auto (720p)" for what you receive and "You're sending …";
  throttle one device's uplink (e.g. Android dev options / Network Link Conditioner) to see
  Auto downgrade and "Auto-limited".

### iOS: VoIP push + CallKit

- The app registers PushKit at launch and uploads the token as `apns_voip` (`PUT /devices/push-token`)
  after sign-in; it is deleted on logout. The backend sends VoIP pushes to topic `<bundle id>.voip`
  using the same token-based APNs key (`.p8`) — no separate VoIP certificate is needed with a key.
  (If you use certificates instead, create a "VoIP Services" certificate for the bundle id in the Apple
  Developer portal and configure it on the backend.)
- EAS manages the push entitlement; `UIBackgroundModes` (`voip`, `audio`, `remote-notification`) and the
  camera/microphone usage strings come from `app.config.ts`. Regenerate provisioning profiles with
  `eas credentials` after enabling Push Notifications for each bundle id (`.dev`, `.staging`, prod).
- iOS requires every VoIP push to be reported to CallKit; the native module does so even for expired
  calls. Pushes for a call that ended while in flight show and immediately end a CallKit call.

### Android: full-screen intent & foreground service (Play Console)

- `USE_FULL_SCREEN_INTENT` is restricted on Android 14+ to calling/alarm apps. In Play Console → App
  content → **Full-screen intent permission**, declare the core use case "Calling" (incoming voice/video
  calls). If the user revokes it, the incoming call still shows as a heads-up notification; the app can
  deep-link to the setting (`openFullScreenIntentSettings()`).
- The connected-call foreground service uses types `microphone` and `camera`
  (`FOREGROUND_SERVICE_MICROPHONE`/`_CAMERA`): declare them in Play Console → App content →
  **Foreground service permissions** with a short video of a call continuing in the background.
- `POST_NOTIFICATIONS` must be granted for incoming calls to ring while the app is closed.
