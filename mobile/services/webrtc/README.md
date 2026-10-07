# services/webrtc — WebRTC engine

`react-native-webrtc` (+ `@config-plugins/react-native-webrtc`) for media, `react-native-incall-manager` for
audio routing (earpiece/speaker/wired/Bluetooth, proximity sensor) and ringtone/ringback. Everything except
`media.ts`, `rtc.ts`, `audioSession.ts` and `deviceClass.ts` is pure TypeScript and unit-tested against the
small interfaces in `types.ts` (fakes in `testing/fakes.ts`).

| File                           | What                                                                                                                                                                                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PeerSession.ts`               | One RTCPeerConnection. Caller is always the offerer (glare-free); callee asks with `renegotiate`. Candidate queue until the remote description is set. Offer coalescing. ICE restart on `failed` / debounced `disconnected`, rate-limited, refreshing stale TURN credentials first. `setParameters` for encodings. |
| `quality/ladder.ts`            | Presets from `docs/ARCHITECTURE.md`: 1080p…144p (resolution, fps, max bitrate) and Opus High 64k / Medium 32k / Low 16k (+DTX).                                                                                                                                                                                    |
| `quality/QualityController.ts` | Deterministic send-side controller (see below).                                                                                                                                                                                                                                                                    |
| `stats/normalizeStats.ts`      | `getStats()` → rtt, jitter, inbound/outbound loss, available outgoing bitrate, in/out kbps, fps, resolution, `qualityLimitationReason`, relay or not; plus a 0–4 network level.                                                                                                                                    |
| `stats/metricsAggregator.ts`   | Builds the `POST /calls/{id}/metrics` body.                                                                                                                                                                                                                                                                        |
| `sdp.ts`                       | Opus fmtp munging (`useinbandfec`, `usedtx`, `stereo=0`) applied to the **remote** SDP before `setRemoteDescription` — that's what configures our encoder.                                                                                                                                                         |
| `iceServers.ts`                | ICE servers from the call acks (plain array). TURN expiry is parsed from the TURN-REST username (`<expiry>:<user>`); stale (≤ 5 min left) ⇒ `GET /calls/ice-servers` before a restart.                                                                                                                             |
| `deviceClass.ts`               | Low-end (< 3 GB RAM or year class < 2018) → 480p cap, mid → 720p, else 1080p.                                                                                                                                                                                                                                      |

## Adaptive quality

Samples every 2 s. Grades: **severe** (loss ≥ 15 %, RTT ≥ 1 s, estimate < 0.5× tier bitrate), **bad** (loss ≥ 5 %,
RTT ≥ 450 ms, jitter ≥ 80 ms, CPU/bandwidth limited, estimate < 0.85× tier), **good** (loss < 2 %, RTT < 250 ms,
unlimited). Bitrate-only badness is ignored for the first 3 samples while BWE ramps up.

- **Auto:** 2 bad in a row → one tier down (severe → jump to the tier that fits the estimate); 10 good in a row
  **and** estimate ≥ 1.3× the next tier's bitrate → one tier up. Never above the device-class or capture cap.
- **Peer cap** (`call.signal{type:"quality"}` — the receiver picked a quality): applied = min(requested, Auto,
  device, capture). A manual pick is held through ordinary congestion and only **undercut under severe
  congestion** (→ `autoLimited`), recovering with the upgrade rule. The receiver's sheet also shows
  "Auto-limited" when what it receives is below its pick.
- Applied live with `RTCRtpSender.setParameters` — `maxBitrate`, `scaleResolutionDownBy` (from the real capture
  height), `maxFramerate`, `degradationPreference: "balanced"`; audio `maxBitrate` (+ `priority: "high"` where
  the native layer honours it). Opus DTX (Low preset) needs SDP, so switching it triggers a rate-limited
  renegotiation.
