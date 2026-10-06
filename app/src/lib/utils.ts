import { clsx, type ClassValue } from 'clsx';

export const cn = (...inputs: ClassValue[]) => clsx(inputs);

export function clientId(): string {
  return crypto.randomUUID();
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const fullDateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

export function formatTime(ts: number): string {
  return timeFmt.format(ts);
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Compact stamp for the conversation list. */
export function formatListStamp(ts: number): string {
  const today = startOfDay(Date.now());
  if (ts >= today) return formatTime(ts);
  if (ts >= today - 86_400_000) return 'Yesterday';
  if (ts >= today - 6 * 86_400_000) return dayFmt.format(ts);
  return dateFmt.format(ts);
}

/** Day separator label inside a chat. */
export function formatDayLabel(ts: number): string {
  const today = startOfDay(Date.now());
  if (ts >= today) return 'Today';
  if (ts >= today - 86_400_000) return 'Yesterday';
  return fullDateFmt.format(ts);
}

export function isSameDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b);
}

export function formatLastSeen(ts: number | null): string {
  if (!ts) return 'Offline';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'Last seen just now';
  if (diff < 3_600_000) return `Last seen ${Math.floor(diff / 60_000)}m ago`;
  const today = startOfDay(Date.now());
  if (ts >= today) return `Last seen today at ${formatTime(ts)}`;
  if (ts >= today - 86_400_000) return `Last seen yesterday at ${formatTime(ts)}`;
  return `Last seen ${dateFmt.format(ts)}`;
}

export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s)+$/u;

/** Returns 1–3 for short emoji-only messages (rendered large), else 0. */
export function jumboEmojiCount(text: string): number {
  if (!EMOJI_ONLY.test(text) || /^[\d#*\s]+$/.test(text)) return 0;
  const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text.trim())].filter(
    (s) => s.segment.trim(),
  );
  return segments.length <= 3 ? segments.length : 0;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase();
}
