# Najik — 1-to-1 chat & calls for Android

**Najik** (नजिक, "near") is a focused real-time communication app for Android, inspired by Viber: 1-to-1 messaging, a 👋 Ping, and high-quality voice & video calls with a YouTube-style quality selector, wrapped in a polished, animated UI. See the full **[feature list](#features)**.

**Contents**

- [Features](#features)

1. [Requirements](#1-requirements)
2. [Environment configuration](#2-environment-configuration)
3. [Run the project locally (step by step)](#3-run-the-project-locally-step-by-step)
4. [Build the Android APK](#4-build-the-android-apk)
5. [Troubleshooting](#5-troubleshooting)
6. [Push notifications for incoming calls (Firebase)](#6-push-notifications-for-incoming-calls-firebase)
7. [Deploying the server](#7-deploying-the-server)
8. [How call quality works](#8-how-call-quality-works)
9. [Security](#9-security)
10. [Architecture](#10-architecture)
11. [Known limitations](#11-known-limitations)

```
najik/
├── server/   Node.js + Express + Socket.IO + SQLite (REST API, realtime, call signaling)
├── app/      React + Vite + Tailwind + Motion, packaged for Android with Capacitor
│   └── android/   Native Android project (Gradle) → builds the APK
└── deploy/   docker-compose for the server + coturn TURN relay
```

---

## Features

### 👤 Accounts & sign-in
- **Create an account** with a username (3–24 characters: letters, numbers, `_` and `.`), a display name and a password (8+ characters).
- **Sign in / sign out.** Sessions last 30 days by default. **Signing out signs you out on every device.**
- **Server address setting** (⚙ on the sign-in screen). It points the app at any Najik server and tests the connection before saving.
- Friendly offline screen with **Try again** when the server can't be reached.

### 💬 Conversations
- **Find people** by display name or `@username`.
- **Chat list** sorted by latest activity, showing:
  - the last-message preview, with delivery ticks and 👋 / 📞 icons
  - **unread badges** that pop in
  - a **"typing…"** preview
  - an **online dot**
- **Online / last seen** status in the chat header ("Online", "Last seen 5m ago", "Last seen yesterday at 9:41 PM").
- Shimmering **skeleton loaders** and a friendly empty state.

### ✉️ Messaging
- **Real-time 1-to-1 messages** that appear instantly (optimistic sending).
- **Timestamps** on every message, plus **day separators** (Today / Yesterday / date).
- **Delivery status:**

  | Icon | Meaning |
  | --- | --- |
  | 🕒 | sending |
  | ✓ | sent to the server |
  | ✓✓ | delivered to the other phone |
  | ✓✓ in colour | read |

  The ticks animate as the status changes.
- **Failed messages** show *Not sent · Tap to retry*. Retries never create duplicates.
- **Typing indicator** in the chat header, the chat list, and as a bouncing bubble in the thread.
- **Emoji:**
  - full picker with search, categories, skin tones and recently used
  - native emoji, so it works offline
  - messages of only 1–3 emoji display **jumbo-sized** with a bounce
- **Smooth history:**
  - older messages load automatically as you scroll up, keeping your place
  - a **"N new messages"** button appears when you've scrolled away
  - consecutive messages group into neat bubble stacks
- Auto-growing message box (up to 5 lines). **Enter** sends on desktop.
- **Notification toasts** for messages in other chats. Tap one to jump there.
- Message **sounds and haptics**.

### 👋 Ping
- One-tap **Ping** button (shown in the message bar when it's empty).
- **Sender:** the 👋 wiggles and bursts into waving-hand / sparkle particles.
- **Receiver:** a **full-screen animation** with a giant waving 👋 and shockwave rings, a chime, and vibration.
- Pings stay in the chat history as a card ("You pinged Arjun").
- A 3-second cooldown prevents ping spam.

### 📞 Voice & video calls
- **1-to-1 voice and video calls** (WebRTC, peer-to-peer and end-to-end encrypted).
- **Outgoing screen:** "Calling…", then **"Ringing…"** once the other phone has received the call. For video calls it shows your camera preview.
- **Incoming screen:** full-screen with ripple animation, bouncing **Accept** button, **Decline** button, ringtone and vibration.
- **In-call controls:**
  - mute / unmute
  - camera on / off
  - **switch front / back camera**
  - **speaker / earpiece** (Android)
  - end call
- **Draggable self-view** window. In video calls the **controls auto-hide**; tap to show them.
- **Minimise** a call into a floating, draggable mini-window and keep chatting.
- In voice calls, **rings around the avatar pulse with the other person's voice**.
- **Live status chips:** "Arjun is muted", "Reconnecting…", "Video paused, weak connection".
- **Call timer** and **signal-strength bars**. Tap the timer for **connection details**: round-trip time, packet loss, bandwidth, resolution, fps, codec, and direct vs relayed route.
- **Call history in the chat:** completed calls with duration, and **missed calls in red**. Tap a call card to call back.
- **Smart call handling:**
  - offline and busy detection
  - an unanswered call becomes **missed** after 40 seconds
  - answering on one device stops ringing on the others
- **Survives network changes:** switching Wi-Fi ↔ mobile data recovers the call automatically, and brief disconnections don't drop it.

### 🎚️ Call quality (YouTube-style)
- **Video quality:** Auto · 1080p (Full HD) · 720p (HD) · 480p · 360p · 240p · 144p
- **Audio quality:** Auto · High (64 kbps) · Medium (32 kbps) · Low (16 kbps)
- **Change quality during a call.** The new level applies within a second or two.
- **Auto** measures both connections continuously and adapts resolution, frame rate and bitrate:
  - steps down fast when the network gets worse
  - climbs back carefully, so quality doesn't flicker
- On very weak connections, video **pauses automatically to keep the voice clear**, then resumes.
- Levels the other phone's camera can't produce are greyed out. Your choice is remembered.

### 🔔 Incoming calls when the app is closed (Firebase push)
- Calls **ring even when Najik is closed or the phone is locked**, with a full-screen call notification, your ringtone and vibration.
- **Answer** opens Najik over the lock screen and connects. **Decline** works without opening the app.
- The notification disappears automatically if the caller hangs up, the call times out, or you answer elsewhere.
- **Never rings twice:** when Najik is open, only the in-app call screen rings.

### 📱 Android experience
- **Hardware back button:**
  - closes sheets
  - minimises an active call
  - leaves the chat
  - minimises the app
- **Haptic feedback** on taps, sends, pings and calls.
- **Calls behave like phone calls:**
  - call audio mode
  - volume keys control call volume
  - the screen stays on
  - wired / Bluetooth headsets are used automatically
- Status bar follows the theme, and the keyboard resizes the chat smoothly.
- Branded **adaptive app icon** and themed **splash screen**.
- Camera, microphone and notification permissions are requested **only when needed**, with clear messages if denied.

### 🎨 Design
- **Dark and light themes.** Follows the system the first time, then remembers your choice. The toggle is animated.
- **Premium animated UI:**
  - spring page transitions, with a native-style slide-in for chats on phones
  - animated message bubbles and status ticks
  - call screens with ripple and breathing effects
  - an animated aurora background
  - micro-interactions on every button
- **Responsive:** single-screen navigation on phones, two-pane layout on tablets and desktops.
- Respects the system **reduce-motion** setting. All sounds are synthesised in-app, so there are no audio files to download.

### 🛠️ Server & operations
- One small Node.js server for the REST API, real-time messaging and call signaling. Its **SQLite** database needs no setup.
- Optional **TURN relay** (coturn) for reliable calls on mobile networks, with short-lived credentials.
- **Docker Compose** deployment, a health-check endpoint (`/api/health`), and configuration that's validated on start-up.
- Security details are in [Security](#9-security).

**Deliberately not included:** groups, stories, channels, feeds, payments, or any other social features.

---

## 1. Requirements

| Tool | Version | Needed for | Check with |
| --- | --- | --- | --- |
| **Node.js** | **22.13 or newer** (the server uses the built-in `node:sqlite`) | server and app | `node -v` |
| npm | 10+ (ships with Node) | installing packages | `npm -v` |
| **Android Studio** | latest stable; includes **JDK 21** and the SDK Manager | building the APK | — |
| Android SDK | **Platform 36** + Build-Tools 36 (install via *SDK Manager*) | building the APK | — |
| Android phone or emulator | Android **7.0+**, Android System WebView up to date | running the app | — |
| Git *(optional)* | any | version control | `git --version` |

> A system-wide Java 8 install (common on Windows) is fine. Android Studio uses its own bundled JDK 21. See [Troubleshooting](#5-troubleshooting) if Gradle complains about the Java version.

You only need Node.js to run the server and try the app in a browser. Android Studio is needed only to build the APK.

---

## 2. Environment configuration

**Nothing needs to be configured to run Najik locally or to build an APK for phones on your network.** The defaults work out of the box:

- the server generates its own login-token secret on first start
- the APK automatically points at this PC's network address
- plain `http://` is allowed for local testing

The files below are for customising, or for production. None of them are committed to git.

| File | Who reads it | When | Required? |
| --- | --- | --- | --- |
| `server/.env` | the Node.js server | every server start | No (defaults work; needed for TURN, Firebase, production) |
| `app/.env.local` | Vite dev server (`npm run dev`) | web development | No (defaults work) |
| `app/.env.production.local` | Vite production build (`npm run android:sync`) | building the APK | No (defaults to this PC's LAN address; set it for a deployed server) |
| `NAJIK_HTTPS_ONLY` / `-PnajikHttpsOnly` | Capacitor sync / Gradle | building an HTTPS-only production release | Optional |
| `app/android/app/google-services.json` | Android Gradle build | building the APK | Only for push ([§6](#6-push-notifications-for-incoming-calls-firebase)) |
| Firebase service-account JSON | the server | server start | Only for push ([§6](#6-push-notifications-for-incoming-calls-firebase)) |

### 2.1 Server: `server/.env`

**Optional.** Without it, the server runs with sensible defaults:

- port 4000 on all network interfaces
- database at `server/data/najik.db`
- a login-token secret generated on first start and saved as `server/data/jwt-secret`

To customise, create it from the template:

```bash
cd server
cp .env.example .env          # works in bash and PowerShell; in cmd.exe use: copy .env.example .env
```

To manage the token secret yourself (recommended for production), generate one and set `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

For **production**, also configure TURN (reliable calls on mobile networks) and optionally Firebase (calls ring while the app is closed):

```ini
NODE_ENV=production
JWT_SECRET=<a different long random secret>
CORS_ORIGINS=https://najik.example.com
TURN_URLS=turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp
TURN_SECRET=<same value as coturn's static-auth-secret>
FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-adminsdk.json
```

**All server variables:**

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `4000` | HTTP + WebSocket port |
| `HOST` | `0.0.0.0` | Interface to listen on. `0.0.0.0` = all, so phones on your LAN can connect. `127.0.0.1` = this PC only. |
| `NODE_ENV` | `development` | `development` / `production` |
| `JWT_SECRET` | auto-generated | At least 32 characters. If empty, one is generated on first start and kept in `jwt-secret` next to the database. Changing it signs everyone out. |
| `JWT_EXPIRES_IN` | `30d` | Login session lifetime (`12h`, `7d`, `30d`, …) |
| `DATABASE_PATH` | `./data/najik.db` | SQLite file, relative to `server/`. Back this file up. |
| `CORS_ORIGINS` | — | Extra allowed **browser** origins, comma-separated. The Android app's origins are always allowed. |
| `STUN_URLS` | Google STUN servers | Comma-separated STUN URLs |
| `TURN_URLS` | — | Comma-separated TURN URLs. Strongly recommended for production. |
| `TURN_SECRET` | — | coturn `static-auth-secret`. The server hands out short-lived TURN credentials. **Recommended.** |
| `TURN_TTL_SECONDS` | `3600` | Lifetime of those TURN credentials |
| `TURN_USERNAME` / `TURN_CREDENTIAL` | — | Static TURN login (used only when `TURN_SECRET` is empty) |
| `CALL_RING_TIMEOUT_SECONDS` | `40` | How long a call rings before it's marked "missed" (10–120) |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | — | Path to the Firebase service-account JSON, which enables push for incoming calls |
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | — | The same JSON, base64-encoded (alternative for containers) |
| `FCM_LOG_ONLY` | `0` | `1` = print pushes to the console instead of sending them (dev aid) |

If a value is missing or invalid, the server refuses to start and prints exactly which variable is wrong.

> **TURN matters for calls.** Phone-to-phone calls on mobile data (carrier-grade NAT) often can't connect peer-to-peer. A TURN relay makes them reliable. `deploy/docker-compose.yml` runs one (coturn) next to the server. On the same Wi-Fi, calls work without TURN.

### 2.2 App: `app/.env.local` (web development, optional)

Copy `app/.env.example` to `app/.env.local` only if you need to change the defaults:

```ini
# Leave empty in development: Vite proxies /api and /socket.io to the server.
VITE_SERVER_URL=

# Where the dev proxy sends API/socket traffic (change if the server runs elsewhere or on another port).
DEV_PROXY_TARGET=http://localhost:4000
```

### 2.3 App: `app/.env.production.local` (APK server address)

The APK needs to know where the server is. **If you don't set anything, the build uses this PC's own network address** (e.g. `http://10.4.47.88:4000`). The build prints the address it chose:

```
➜ VITE_SERVER_URL not set: the app will connect to http://10.4.47.88:4000 (this PC on your network).
```

To use a different server, for example a deployed one, create `app/.env.production.local`:

```ini
VITE_SERVER_URL=https://najik.example.com
```

- No trailing slash and no `/api`. Use just the origin.
- Users can also change the server **inside the app** with the ⚙ icon on the login screen. The app tests the address before saving it, and that choice overrides `VITE_SERVER_URL` on that phone.
- Changing this file requires rebuilding the APK (`npm run android:sync`, then build).

### 2.4 HTTPS-only release builds (optional)

By default the APK may talk to plain-`http://` servers, so the local dev server just works. For a production release that must only ever use HTTPS, lock it down at both build stages:

```bash
NAJIK_HTTPS_ONLY=1 npm run android:sync                 # bash / macOS / Linux
$env:NAJIK_HTTPS_ONLY="1"; npm run android:sync         # Windows PowerShell
```

```bash
cd android
./gradlew assembleRelease -PnajikHttpsOnly=true         # gradlew.bat on Windows
```

---

## 3. Run the project locally (step by step)

The commands below are run from the project root (`najik/`) unless a step says otherwise. Each block works in **PowerShell, Git Bash, macOS and Linux** unless marked.

### Step 1: Install dependencies

```bash
npm run install:all          # installs server/ and app/ packages
```

This is equivalent to running `npm install` inside `server/` and inside `app/`.

### Step 2: Configure the server (optional)

Nothing to do: the defaults work. Create `server/.env` only to customise ([§2.1](#21-server-serverenv)).

### Step 3: Start the server

```bash
npm run dev:server           # = cd server && npm run dev   (auto-restarts on code changes)
```

Expected output:

```
✔ Generated a JWT secret (…\server\data\jwt-secret). Set JWT_SECRET to manage it yourself.   ← first start only
✔ Najik server listening on http://0.0.0.0:4000
⚠ No TURN server configured — calls may fail across strict NATs / mobile networks.
⚠ Firebase not configured — no push for incoming calls while the app is closed.
```

The two warnings are expected locally. Check it's up by opening <http://localhost:4000/api/health> in a browser:

```json
{ "ok": true, "name": "najik", "time": 1791279822857 }
```

Keep this terminal open.

### Step 4: Start the app in a browser

Open a **second terminal** in the project root:

```bash
npm run dev:app              # = cd app && npm run dev
```

Open <http://localhost:5173>, then:

1. **Create account** → pick a username, display name and password (8+ characters).
2. Open a **private/incognito window** (or another browser) at the same address and create a second account.
3. In one window, search for the other username → send messages, emoji, a 👋 ping, and start a voice or video call.

Camera and microphone work on `localhost`. Your browser will ask for permission the first time.

### Step 5: Run it on an Android phone over Wi-Fi

The phone and PC must be on the **same Wi-Fi network**, and the server from step 3 must be running.

1. **Find your PC's LAN IP address**
   - Windows: `ipconfig` → *IPv4 Address* of your Wi-Fi adapter (e.g. `192.168.1.20`)
   - macOS: `ipconfig getifaddr en0` · Linux: `hostname -I`
2. **Allow the server through the firewall** (Windows). Click **Allow access** (Private networks) when Windows prompts the first time Node starts, or run this once in an **administrator** PowerShell:
   ```powershell
   New-NetFirewallRule -DisplayName "Najik dev server" -Direction Inbound -Protocol TCP -LocalPort 4000 -Action Allow -Profile Private
   ```
3. **Check the phone can reach the server.** Open `http://<your-PC-IP>:4000/api/health` in the phone's browser. You should see `{"ok":true,"name":"najik",…}`.
4. **Build and sync the app.** It automatically points at this PC; check the printed address matches step 1:
   ```bash
   cd app
   npm run android:sync
   ```
5. If the printed address is wrong (e.g. you use several networks), put the right one in `app/.env.production.local` as `VITE_SERVER_URL=http://<your-PC-IP>:4000` and sync again.
6. **Build and install the APK.** Run `npm run android:open`, then in Android Studio click **Run ▶** with the phone connected by USB (enable *Developer options → USB debugging*), or use **Build ▸ Build APK(s)** and copy the APK to the phone. Full details are in [§4](#4-build-the-android-apk).
7. Open **Najik** on the phone, create an account, and call the account you made in the browser. Allow the camera, microphone and notification prompts.

### Everyday commands

| Task | Command (from project root) |
| --- | --- |
| Install / update all dependencies | `npm run install:all` |
| Start the server (dev, auto-reload) | `npm run dev:server` |
| Start the web app (dev) | `npm run dev:app` |
| Production build of the server | `npm run build:server`, then `cd server && npm start` |
| Production build of the web app | `npm run build:app` |
| Rebuild web code into the Android project | `npm run android:sync` |
| Open the Android project in Android Studio | `npm run android:open` |
| Type-check | `cd server && npm run typecheck` · `cd app && npm run typecheck` |

Stop a running server or dev app with **Ctrl + C** in its terminal.

---

## 4. Build the Android APK

An APK is the installable Android app file. Najik's APK is built in two stages:

1. **Vite** compiles the React app into static files.
2. **Capacitor** copies those files into the native Android project (`app/android`), and **Gradle** (through Android Studio or the command line) packages everything into an APK.

```
app/src (React)  ──vite build──▶  app/dist  ──cap sync──▶  app/android  ──Gradle──▶  app-debug.apk / app-release.apk
```

### 4.1 One-time setup: Android Studio and the SDK

1. **Install Android Studio** from <https://developer.android.com/studio> and run it. In the setup wizard choose **Standard**. It installs the Android SDK, platform-tools and an emulator.
2. **Install the SDK components Najik needs.** Go to *More Actions ▸ SDK Manager* (or *Settings ▸ Languages & Frameworks ▸ Android SDK*):
   - **SDK Platforms** tab: tick **Android 16.0 ("Baklava") – API 36**
   - **SDK Tools** tab: tick **Android SDK Build-Tools 36**, **Android SDK Platform-Tools** and **Android SDK Command-line Tools (latest)**
   - Click **Apply** and wait for the downloads.
3. **Use JDK 21 for Gradle.** Android Studio bundles it. If Gradle reports a Java version error, set *Settings ▸ Build, Execution, Deployment ▸ Build Tools ▸ Gradle ▸ Gradle JDK* to **jbr-21** (or any JDK 21).
4. *(Optional, for command-line builds and `adb`)* Tell your terminal where the SDK is:
   ```powershell
   # Windows PowerShell: persists for future terminals
   setx ANDROID_HOME "$env:LOCALAPPDATA\Android\Sdk"
   [Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path','User') + ";$env:LOCALAPPDATA\Android\Sdk\platform-tools", 'User')
   # open a new terminal, then check:
   adb version
   ```
   ```bash
   # macOS (zsh): add to ~/.zshrc
   export ANDROID_HOME="$HOME/Library/Android/sdk"
   export PATH="$PATH:$ANDROID_HOME/platform-tools"
   # Linux: same, with ANDROID_HOME="$HOME/Android/Sdk"
   ```

### 4.2 One-time setup: prepare your phone

To install straight from Android Studio over USB:

1. On the phone, open **Settings ▸ About phone** and tap **Build number** 7 times. This enables *Developer options*.
2. Open **Settings ▸ System ▸ Developer options** and turn on **USB debugging**.
3. Connect the phone by USB and tap **Allow** on the "Allow USB debugging?" prompt.
4. Check it's visible: `adb devices` should list it as `device`.

You can skip this if you'll copy the APK file to the phone instead (see [§4.7](#47-install-the-apk-on-a-phone)).

### 4.3 Choose which server the app connects to

The server address is **baked in at build time**:

| You want to… | Do this |
| --- | --- |
| Test on your Wi-Fi against the server on your PC | **Nothing.** The build uses this PC's network address automatically. |
| Use a deployed server | Create `app/.env.production.local` with `VITE_SERVER_URL=https://najik.example.com` |

The address can also be changed later inside the app (⚙ on the sign-in screen). See [§2.3](#23-app-appenvproductionlocal-apk-server-address) for details.

### 4.4 *(Optional)* Enable push for incoming calls

Put **`google-services.json`** from your Firebase project at **`app/android/app/google-services.json`** ([§6.1](#61-create-the-firebase-project-once-5-minutes)). Without it, the APK builds and works normally, but calls only ring while the app is open.

### 4.5 Build the web app and copy it into Android

From the `app/` folder:

```bash
cd app
npm install                                            # first time only
```

Then:

```bash
npm run android:sync
```

A successful sync prints the server address the app will use, and ends with:

```
➜ VITE_SERVER_URL not set: the app will connect to http://10.4.47.88:4000 (this PC on your network).
✓ built in …
√ Copying web assets from dist to android\app\src\main\assets\public
√ update android
[info] Sync finished in …
```

> Run this sync step **every time** you change anything under `app/src`, `app/.env.production.local` or `capacitor.config.ts`. Otherwise the APK still contains the old version.

### 4.6 Build a debug APK

A **debug APK** is for testing. It installs on any phone, but you can't publish it to the Play Store.

**Option A: Android Studio (recommended)**

1. Open the Android project:
   ```bash
   npm run android:open        # from app/ — or: File ▸ Open… ▸ select the app/android folder
   ```
2. Wait for **Gradle sync** to finish (progress bar at the bottom). The first sync downloads dependencies and can take several minutes.
3. Choose one:
   - **Run directly on your phone:** pick your phone in the device dropdown at the top and click **Run ▶**. Android Studio builds, installs and launches Najik.
   - **Just build the file:** **Build ▸ Build App Bundle(s) / APK(s) ▸ Build APK(s)**, then click **locate** in the notification that appears.

**Option B: command line**

```bash
cd app/android
gradlew.bat assembleDebug           # Windows (cmd / PowerShell)
./gradlew assembleDebug             # macOS / Linux / Git Bash
```

**Output:** `app/android/app/build/outputs/apk/debug/app-debug.apk`

> Shortcut: with a phone connected, `npm run android:run` (from `app/`) builds, installs and launches the app in one step.

### 4.7 Install the APK on a phone

Use any of these:

- **Android Studio:** **Run ▶** (see §4.6), which installs automatically.
- **USB + adb:**
  ```bash
  adb install -r app/android/app/build/outputs/apk/debug/app-debug.apk
  ```
  `-r` replaces an existing install and keeps its data.
- **Copy the file:** send the APK to the phone by USB, Google Drive, email, etc. and tap it. Android asks you to allow **Install unknown apps** for the app you opened it with (Files, Drive, …). Allow it and tap **Install**.

On first launch, Najik asks for **notifications** (Android 13+). Camera and microphone are requested when you make or answer your first call.

### 4.8 Build a signed release APK (for distribution)

Release builds are optimised and **signed** with your own key. Android only accepts updates signed with the **same key**, so create it once and keep it safe.

**1. Create a signing key** (one time). `keytool` ships with Android Studio's JDK:

```bash
cd app/android
keytool -genkeypair -v -keystore najik-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias najik
```

If `keytool` isn't found on Windows, call it from Android Studio's JDK: `"C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" …`. It asks for a password and your name/organisation.

**2. Tell Gradle about the key.** Copy `app/android/keystore.properties.example` to **`app/android/keystore.properties`** and fill it in:

```properties
storeFile=najik-release.jks
storePassword=your-keystore-password
keyAlias=najik
keyPassword=your-key-password
```

`keystore.properties` and `*.jks` are git-ignored. **Back up both, plus the passwords.** If the key is lost, installed apps can never be updated.

**3. Point the app at your production server and sync:**

```bash
cd app
# app/.env.production.local → VITE_SERVER_URL=https://najik.example.com
npm run android:sync
```

Optionally make the release HTTPS-only ([§2.4](#24-https-only-release-builds-optional)).

**4. Build:**

```bash
cd android
gradlew.bat assembleRelease        # Windows   → signed APK
./gradlew assembleRelease          # macOS/Linux
gradlew.bat bundleRelease          # Windows   → AAB for the Google Play Store
./gradlew bundleRelease            # macOS/Linux
```

| Output | Path |
| --- | --- |
| Signed release APK | `app/android/app/build/outputs/apk/release/app-release.apk` |
| Play Store bundle (AAB) | `app/android/app/build/outputs/bundle/release/app-release.aab` |

Prefer clicking? In Android Studio use **Build ▸ Generate Signed App Bundle / APK…**, choose **APK** (or *Android App Bundle* for Play), select `najik-release.jks`, and pick the **release** variant.

> Without `keystore.properties`, `assembleRelease` produces `app-release-unsigned.apk`, which phones refuse to install. Use a debug APK for testing instead.

### 4.9 Releasing an update

1. Increase the version in `app/android/app/build.gradle`:
   ```groovy
   versionCode 2          // must go up by at least 1 for every release
   versionName "1.1"      // what users see
   ```
2. `npm run android:sync`, then build the release again (§4.8) with the **same key**.
3. Installing the new APK over the old one keeps users' data and sign-in.

### 4.10 What needs a rebuild?

| You changed… | Then run |
| --- | --- |
| Anything in `app/src` (UI, logic, styles) | `npm run android:sync` → rebuild APK |
| `app/.env.production.local` or `capacitor.config.ts` | `npm run android:sync` → rebuild APK |
| Java / Android files in `app/android` | rebuild APK (no sync needed) |
| `google-services.json` | rebuild APK |
| Anything in `server/` | restart the server; **no** APK rebuild needed |

### 4.11 Customising name, ID and icon

- **App name** (under the icon): `app/android/app/src/main/res/values/strings.xml` → `app_name` and `title_activity_main`.
- **Application ID** (`com.najik.app`): set in `capacitor.config.ts` (`appId`) and `app/android/app/build.gradle` (`applicationId`). If you change it, register the new ID in Firebase and download a new `google-services.json`.
- **Icon:** the launcher icon is an adaptive vector (brand gradient + "N" mark) in `app/android/app/src/main/res/*najik*`, used on Android 8+. To generate icons and splash screens from your own artwork, put a 1024×1024 `assets/icon.png` in `app/` and run `npx @capacitor/assets generate --android`.

### 4.12 Build checklist

- [ ] Android Studio installed, SDK Platform 36 + Build-Tools 36, Gradle JDK = 21
- [ ] Server address printed by `npm run android:sync` is the one phones should reach (set `VITE_SERVER_URL` otherwise)
- [ ] *(release)* `VITE_SERVER_URL` is your `https://` server; optionally HTTPS-only ([§2.4](#24-https-only-release-builds-optional))
- [ ] *(push)* `app/android/app/google-services.json` in place, server has `FIREBASE_SERVICE_ACCOUNT_PATH`
- [ ] `npm run android:sync` after the latest web changes
- [ ] *(release)* `keystore.properties` + `.jks` present and backed up, `versionCode` increased
- [ ] Server reachable from the phone: `<server>/api/health` opens in the phone's browser

---

## 5. Troubleshooting

| Problem | Fix |
| --- | --- |
| Server exits with `✖ Invalid environment configuration` | The message names the variable, e.g. a `JWT_SECRET` shorter than 32 characters or a non-numeric `PORT` in `server/.env`. Fix or remove that line. |
| `No such built-in module: node:sqlite` | Node.js is older than 22.13. Install the current Node 22 LTS or newer. |
| `EADDRINUSE … :4000` | Something else uses port 4000. Stop it (Windows: `netstat -ano \| findstr :4000`, then end that PID), or set another `PORT` and update `DEV_PROXY_TARGET` / `VITE_SERVER_URL` to match. |
| Web app shows **Can't reach Najik** | The server isn't running, or `DEV_PROXY_TARGET` in `app/.env.local` points to the wrong address. |
| Phone app: **Couldn't reach that server** | Phone and PC must be on the same Wi-Fi. Check the IP, open `http://<IP>:4000/api/health` in the phone browser, allow port 4000 in the firewall (§3 step 5), and check the address printed by `npm run android:sync`. Office or guest Wi-Fi often blocks device-to-device traffic: try a phone hotspot or home Wi-Fi. |
| Camera/mic don't work when opening the **web** app from a phone | Browsers only allow camera/mic on `https://` or `localhost`. Use the APK on phones, or serve the web app over HTTPS. |
| Call stays on **Connecting…** or has no audio/video across different networks | Configure a TURN server (`TURN_URLS` + `TURN_SECRET`, see [§7](#7-deploying-the-server)). |
| Gradle: `SDK location not found` | Open `app/android` once in Android Studio (it writes `local.properties`), or create `app/android/local.properties` with `sdk.dir=C\:\\Users\\<you>\\AppData\\Local\\Android\\Sdk`. |
| Gradle sync / build fails with **`PKIX path building failed`** or **`unable to find valid certification path`** | Your network (typically an office network) inspects HTTPS with its own certificate, which Java doesn't trust. On Windows, make Gradle use the Windows certificate store: add this line to `%USERPROFILE%\.gradle\gradle.properties` (create the file if needed), then re-sync:<br>`systemProp.javax.net.ssl.trustStoreType=Windows-ROOT` |
| Gradle: Java / class-file version errors | Android Studio → *Settings ▸ Build, Execution, Deployment ▸ Build Tools ▸ Gradle ▸ Gradle JDK* = **JDK 21** (bundled *jbr-21*). For command-line builds, set `JAVA_HOME` to a JDK 21. |
| Changes to the web code don't show up in the APK | Run `npm run android:sync` again before rebuilding ([§4.10](#410-what-needs-a-rebuild)). |
| Phone says **App not installed** | A different-signature build is already installed (e.g. debug vs release). Uninstall Najik first, then install again. Release updates must use the same key ([§4.8](#48-build-a-signed-release-apk-for-distribution)). |
| `adb: command not found` / no devices listed | Add platform-tools to `PATH` ([§4.1](#41-one-time-setup-android-studio-and-the-sdk)), enable USB debugging and accept the prompt on the phone ([§4.2](#42-one-time-setup-prepare-your-phone)). |
| Calls don't ring when the app is closed | Set up Firebase ([§6](#6-push-notifications-for-incoming-calls-firebase)), allow notifications, and on Xiaomi/Oppo/Vivo/Huawei set Najik's battery mode to *Unrestricted*. |
| Forgot a test account / want a clean slate | Stop the server and delete `server/data/najik.db*`. All accounts and messages are erased. |

---

## 6. Push notifications for incoming calls (Firebase)

Without Firebase, calls only ring while Najik is open. With it, a call rings like a normal phone call even when the app is swiped away or the screen is locked.

### 6.1 Create the Firebase project (once, ~5 minutes)

1. Go to <https://console.firebase.google.com> → **Add project** (Google Analytics not needed).
2. **Add app → Android**, package name **`com.najik.app`**. Download **`google-services.json`** and put it at **`app/android/app/google-services.json`**.
3. **Project settings → Service accounts → Generate new private key.** Save the JSON on the server (e.g. `server/firebase-adminsdk.json`) and set it in `server/.env`:
   ```bash
   FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-adminsdk.json
   # or, for containers:  FIREBASE_SERVICE_ACCOUNT_BASE64=$(base64 -w0 firebase-adminsdk.json)
   ```
4. Restart the server. It logs `✔ Firebase Cloud Messaging enabled`.
5. Rebuild the APK (`npm run android:sync`, then build). The Gradle build picks up `google-services.json` automatically. Without the file, the APK still builds and push simply stays off.

Both JSON files are already in `.gitignore`. Keep the service-account key private, because it can send pushes to all of your users.

### 6.2 What happens on an incoming call

```
caller ── call:invite ──▶ server ──▶ open app?  ── socket ──▶ in-app incoming screen
                                 └─▶ FCM data push (high priority, TTL = ring timeout)
                                          ▼
                     NajikMessagingService (runs even if the app is closed)
                                          ▼
              full-screen CallStyle notification · ringtone · vibration
                 [Decline] → POST /api/calls/:id/decline (no app launch)
                 [Answer]  → opens Najik over the lock screen → auto-answers
                 tap       → opens the incoming-call screen
```

- **Hang-up, timeout, or answered on another device:** the server sends a `call-end` push and the notification disappears on every phone.
- **App already on screen:** the native layer skips the notification and the in-app call UI rings. When the app is in the background, only the notification rings, so you never hear two ringtones.
- **Callee offline with no registered device:** the call is logged as missed immediately, as before.
- **Logging out** unregisters the device and removes all of the account's push tokens, so a signed-out phone never rings.

### 6.3 Permissions the app asks for

- **Notifications** (Android 13+): requested right after sign-in.
- **Full-screen calls** (Android 14+): Android requires the user to allow this. Najik shows a one-time prompt that opens the right settings page. Without it, calls still ring as a heads-up notification.
- Some manufacturers (Xiaomi, Oppo, Vivo, Huawei…) aggressively kill background apps. If calls don't ring when the app is closed, set Najik's battery mode to **Unrestricted / No restrictions**.

### 6.4 Testing without Firebase

Set `FCM_LOG_ONLY=1` in `server/.env` and it prints every push it would send (`[push] → <user> {...}`). This is handy for checking the flow before you set up Firebase.

---

## 7. Deploying the server

```bash
cd deploy
cp ../server/.env.example .env      # set TURN_SECRET, TURN_URLS, CORS_ORIGINS (and ideally JWT_SECRET)
docker compose up -d --build
```

- Put a TLS reverse proxy in front of port 4000 (Caddy example: `najik.example.com { reverse_proxy localhost:4000 }`). WebSockets pass through automatically.
- Set `TURN_URLS=turn:<public-ip-or-domain>:3478?transport=udp,turn:<…>:3478?transport=tcp` and open UDP/TCP 3478 plus UDP 49160–49400 on the firewall.
- Back up the `najik-data` volume, which holds the SQLite database.

---

## 8. How call quality works

**Transport.** Calls are peer-to-peer WebRTC (DTLS-SRTP encrypted end-to-end), relayed through TURN only when a direct path is impossible. Socket.IO carries only signaling.

**Quality you choose = quality you *receive*** (like YouTube). Your selection travels over an in-call WebRTC data channel to the other phone, whose sender then encodes at that level:

| Level | Resolution | FPS | Max bitrate |
| --- | --- | --- | --- |
| 144p | 256×144 | 15 | 120 kbps |
| 240p | 426×240 | 20 | 260 kbps |
| 360p | 640×360 | 30 | 550 kbps |
| 480p | 854×480 | 30 | 950 kbps |
| 720p | 1280×720 | 30 | 1.8 Mbps |
| 1080p | 1920×1080 | 30 | 3.5 Mbps |

Audio is Opus at **Low** (16 kbps), **Medium** (32 kbps) or **High** (64 kbps). It's mono and tuned for voice, with in-band FEC (survives packet loss), DTX (saves data in silence) and 10 ms minimum packet time (low latency).

**Auto mode** (`app/src/webrtc/adaptive.ts`) runs on the sender every 2 seconds using live `getStats()` data:

- bandwidth estimate from the congestion controller, RTCP packet loss, round-trip time, and whether the encoder is CPU- or bandwidth-limited
- **fast downgrade**: one bad sample drops quality, jumping straight to the level the measured bandwidth can carry
- **slow, hysteretic upgrade**: needs a sustained healthy window; it backs off exponentially if quality bounces, so it never oscillates
- a 10 s **warm-up** that ignores WebRTC's normal bandwidth ramp at call start
- under severe starvation, video **pauses automatically** so the **audio stays clear** ("Video paused, weak connection"), then resumes when the link recovers
- audio has the highest RTP priority; video yields first

Other details:

- Pinned levels keep resolution (`maintain-resolution`); Auto balances resolution against frame rate.
- The camera captures only as high as needed. The encoder scales down from there, and capture is raised on demand, up to what the camera supports. Levels the other phone's camera can't produce are greyed out.
- ICE restarts recover calls automatically when you switch between Wi-Fi and mobile data. Signaling also survives brief socket drops with a 20 s grace period.
- **Connection details**: tap the timer during a call to see live RTT, loss, bandwidth, resolution, fps, codec and whether the route is direct or relayed.

**Android extras** (native `CallAudioPlugin.java`):

- voice-communication audio mode
- earpiece ↔ speaker toggle, with automatic headset routing
- volume keys control call volume
- screen stays on during calls

---

## 9. Security

- Passwords are hashed with bcrypt (cost 12). Timing is equalised for unknown usernames, and the auth endpoints are rate-limited.
- JWT (HS256) is sent as a Bearer token. **Logout revokes all of the user's tokens** through a per-user token version, and live sockets are disconnected.
- All REST and socket payloads are validated with Zod. Every socket connection has a flood limiter.
- Call signaling is only relayed between the two bound participants of an active call.
- Presence is only shared with people you've chatted with.
- Helmet security headers, strict CORS allow-list, JSON body size limits.
- TURN credentials are short-lived HMAC tokens, so no long-lived TURN password ships in the APK.
- Push payloads are data-only (no message content) and expire with the ring timeout. To let *Decline* work from the notification, the session token is mirrored into app-private storage (`SharedPreferences`, same sandbox as the WebView's storage), and it's cleared on logout. Only the callee can decline a call through the REST endpoint.
- Media is end-to-end encrypted by WebRTC (DTLS-SRTP). Use **HTTPS/WSS** for the server in production.

---

## 10. Architecture

**Server** (`server/src`)

| Path | Responsibility |
| --- | --- |
| `config/env.ts` | Validated configuration |
| `db/` | SQLite schema + repositories (`users`, `messages`) — swap for Postgres by reimplementing these two modules |
| `auth/` | Token signing/verification, Express middleware |
| `routes/` | REST: `auth`, `users` (search), `messages` (conversations, history), `rtc` (ICE servers) |
| `realtime/` | Socket.IO: `chat.ts` (messages, receipts, typing, ping, presence), `calls.ts` (call state machine & signaling) |
| `push/fcm.ts`, `db/pushTokens.ts` | Firebase Cloud Messaging: device tokens, incoming-call & call-end pushes |

**App** (`app/src`)

| Path | Responsibility |
| --- | --- |
| `stores/` | Zustand state: `auth`, `chat`, `call`, `theme`, `toast` |
| `realtime/bindings.ts` | Socket events → stores |
| `webrtc/` | `CallSession` (peer connection, negotiation, ICE restart, quality application), `adaptive.ts`, `stats.ts`, `quality.ts`, `sdp.ts`, `media.ts` |
| `features/auth`, `features/chat`, `features/call` | Screens & components |
| `components/` | Design-system primitives (Avatar, Button, Sheet, TextField, Toaster…) |
| `lib/` | API client, socket, native bridges (haptics, back button, status bar, call audio, push), synthesized UI sounds |
| `android/…/najik/app/` | Native: `CallAudioPlugin`, `NajikPushPlugin`, `NajikMessagingService`, `CallNotifications`, `CallActionReceiver` |

**Scaling out:** run several server instances behind a load balancer with sticky sessions, and add `@socket.io/redis-adapter` so rooms span instances. The in-memory call/presence maps would then move to Redis.

---

## 11. Known limitations

- Push is used for **incoming calls**. New **messages** sent while the app is closed arrive when you reopen it. Adding message notifications reuses the same pipeline: call `sendData` from `message:send` and show a `MessagingStyle` notification in `NajikMessagingService`.
- One active call per user; calls are 1-to-1 by design.
- Message history is stored on the server in plaintext SQLite. WebRTC media is end-to-end encrypted, but chat messages are protected in transit (TLS), not end-to-end.
