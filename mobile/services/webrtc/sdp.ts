/**
 * Minimal, pure SDP helpers.
 *
 * Opus FEC/DTX are not `setParameters` knobs: libwebrtc configures the Opus *encoder* from the
 * fmtp of the **remote** description (`usedtx`/`useinbandfec` are receiver preferences in
 * RFC 7587). So we munge the remote SDP right before `setRemoteDescription`, which decides how
 * our own sender encodes. Changing DTX mid-call therefore needs a renegotiation.
 */

export interface OpusParams {
  fec: boolean;
  dtx: boolean;
  stereo: boolean;
}

function opusPayloadTypes(sdp: string): string[] {
  const out: string[] = [];
  const re = /^a=rtpmap:(\d+) opus\/48000/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sdp)) !== null) if (m[1]) out.push(m[1]);
  return out;
}

function setFmtpParams(line: string, params: Record<string, string>): string {
  const space = line.indexOf(' ');
  const head = space === -1 ? line : line.slice(0, space);
  const rest = space === -1 ? '' : line.slice(space + 1);
  const entries = rest
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const eq = p.indexOf('=');
      return eq === -1 ? ([p, ''] as const) : ([p.slice(0, eq), p.slice(eq + 1)] as const);
    });
  const map = new Map<string, string>(entries);
  for (const [k, v] of Object.entries(params)) map.set(k, v);
  const body = [...map.entries()].map(([k, v]) => (v === '' ? k : `${k}=${v}`)).join(';');
  return `${head} ${body}`;
}

export function mungeOpus(sdp: string, opus: OpusParams): string {
  const pts = opusPayloadTypes(sdp);
  if (pts.length === 0) return sdp;
  const eol = sdp.includes('\r\n') ? '\r\n' : '\n';
  const lines = sdp.split(eol);
  const params = {
    useinbandfec: opus.fec ? '1' : '0',
    usedtx: opus.dtx ? '1' : '0',
    stereo: opus.stereo ? '1' : '0',
  };
  for (const pt of pts) {
    const fmtpIdx = lines.findIndex((l) => l.startsWith(`a=fmtp:${pt} `) || l === `a=fmtp:${pt}`);
    if (fmtpIdx !== -1) {
      lines[fmtpIdx] = setFmtpParams(lines[fmtpIdx]!, params);
    } else {
      const rtpmapIdx = lines.findIndex((l) => l.toLowerCase().startsWith(`a=rtpmap:${pt} opus/`));
      if (rtpmapIdx !== -1) {
        lines.splice(rtpmapIdx + 1, 0, setFmtpParams(`a=fmtp:${pt}`, params));
      }
    }
  }
  return lines.join(eol);
}

/** Reads the `usedtx` flag of the first Opus payload (for deciding whether to renegotiate). */
export function opusDtxEnabled(sdp: string): boolean {
  const pt = opusPayloadTypes(sdp)[0];
  if (!pt) return false;
  const line = sdp.split(/\r?\n/).find((l) => l.startsWith(`a=fmtp:${pt} `));
  return !!line && /(?:^|[;\s])usedtx=1(?:;|$)/.test(line);
}

/** UTF-8 byte length (the backend caps a serialized signal at 16 KiB). */
export function byteLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

export const MAX_SIGNAL_BYTES = 16 * 1024;
