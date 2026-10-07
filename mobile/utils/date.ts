/** Date helpers for chat UI. All inputs are ISO strings (UTC); output is in the device's locale/zone. */

const MINUTE = 60_000;
const DAY = 86_400_000;

export function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Local calendar day key, e.g. "2026-10-07". */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Whole calendar days between `iso` and `now` (0 = today, 1 = yesterday, …). */
export function daysAgo(iso: string, now: Date = new Date()): number {
  return Math.round((startOfDay(now) - startOfDay(new Date(iso))) / DAY);
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** Chat-list timestamp: time today, "Yesterday", weekday this week, otherwise a short date. */
export function formatListTimestamp(iso: string, now: Date = new Date()): string {
  const diff = daysAgo(iso, now);
  if (diff <= 0) return formatTime(iso);
  if (diff === 1) return 'Yesterday';
  const d = new Date(iso);
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
  if (d.getFullYear() === now.getFullYear())
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' });
}

/** Day separator label inside a thread. */
export function formatDayLabel(iso: string, now: Date = new Date()): string {
  const diff = daysAgo(iso, now);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const d = new Date(iso);
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  if (d.getFullYear() === now.getFullYear())
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** "last seen just now / 5 min ago / today at 09:41 / yesterday at 21:10 / 12 Mar". */
export function formatLastSeen(iso: string | null, now: Date = new Date()): string {
  if (!iso) return 'last seen recently';
  const elapsed = now.getTime() - new Date(iso).getTime();
  if (elapsed < MINUTE) return 'last seen just now';
  if (elapsed < 60 * MINUTE) return `last seen ${Math.floor(elapsed / MINUTE)} min ago`;
  const diff = daysAgo(iso, now);
  if (diff <= 0) return `last seen today at ${formatTime(iso)}`;
  if (diff === 1) return `last seen yesterday at ${formatTime(iso)}`;
  const d = new Date(iso);
  return `last seen ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })}`;
}

export function formatDuration(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}
