/**
 * Tunes the Opus fmtp line of an SDP blob before it is sent to the peer.
 * The fmtp parameters we advertise describe how the *remote* encoder should
 * send to us:
 *  - useinbandfec=1  → forward error correction, survives packet loss
 *  - usedtx=1        → discontinuous transmission, saves bandwidth in silence
 *  - stereo=0        → mono voice, bits go to clarity instead of channels
 *  - maxaveragebitrate → upper bound the remote encoder may use
 *  - minptime=10     → allow short packets for low latency
 */
export function tuneOpus(sdp: string, maxAverageBitrate = 64_000): string {
  const match = sdp.match(/a=rtpmap:(\d+) opus\/48000/i);
  if (!match) return sdp;
  const pt = match[1];
  const wanted: Record<string, string> = {
    useinbandfec: '1',
    usedtx: '1',
    stereo: '0',
    'sprop-stereo': '0',
    maxaveragebitrate: String(maxAverageBitrate),
    minptime: '10',
  };

  const fmtpRe = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`);
  const existing = sdp.match(fmtpRe);
  if (existing) {
    const params = new Map(
      existing[1]
        .split(';')
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => {
          const [k, ...v] = p.split('=');
          return [k.trim(), v.join('=')] as [string, string];
        }),
    );
    for (const [k, v] of Object.entries(wanted)) params.set(k, v);
    const line = [...params].map(([k, v]) => `${k}=${v}`).join(';');
    return sdp.replace(fmtpRe, `a=fmtp:${pt} ${line}`);
  }

  const line = Object.entries(wanted)
    .map(([k, v]) => `${k}=${v}`)
    .join(';');
  return sdp.replace(match[0], `${match[0]}\r\na=fmtp:${pt} ${line}`);
}
