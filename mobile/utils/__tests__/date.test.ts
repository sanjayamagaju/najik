import {
  dayKey,
  daysAgo,
  formatDayLabel,
  formatDuration,
  formatLastSeen,
  formatListTimestamp,
} from '../date';

const NOW = new Date('2026-10-07T12:00:00.000Z');

describe('date grouping helpers', () => {
  it('computes calendar day keys and day distance', () => {
    expect(dayKey('2026-10-07T00:00:01.000Z')).toBe('2026-10-07');
    expect(daysAgo('2026-10-07T00:00:00.000Z', NOW)).toBe(0);
    expect(daysAgo('2026-10-06T23:59:59.000Z', NOW)).toBe(1);
    expect(daysAgo('2026-09-30T10:00:00.000Z', NOW)).toBe(7);
  });

  it('labels day separators', () => {
    expect(formatDayLabel('2026-10-07T08:00:00.000Z', NOW)).toBe('Today');
    expect(formatDayLabel('2026-10-06T08:00:00.000Z', NOW)).toBe('Yesterday');
    // Within the week → weekday name; older → date.
    expect(formatDayLabel('2026-10-03T08:00:00.000Z', NOW)).toMatch(/Saturday/);
    expect(formatDayLabel('2026-08-01T08:00:00.000Z', NOW)).toMatch(/August/);
    expect(formatDayLabel('2025-08-01T08:00:00.000Z', NOW)).toMatch(/2025/);
  });

  it('formats chat list timestamps', () => {
    expect(formatListTimestamp('2026-10-06T08:00:00.000Z', NOW)).toBe('Yesterday');
    expect(formatListTimestamp('2026-10-07T09:41:00.000Z', NOW)).toMatch(/09:41|9:41/);
  });

  it('formats last seen', () => {
    expect(formatLastSeen(null, NOW)).toBe('last seen recently');
    expect(formatLastSeen('2026-10-07T11:59:40.000Z', NOW)).toBe('last seen just now');
    expect(formatLastSeen('2026-10-07T11:45:00.000Z', NOW)).toBe('last seen 15 min ago');
    expect(formatLastSeen('2026-10-07T08:00:00.000Z', NOW)).toMatch(/^last seen today at/);
    expect(formatLastSeen('2026-10-06T21:10:00.000Z', NOW)).toMatch(/^last seen yesterday at/);
  });

  it('formats call durations', () => {
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(192)).toBe('3:12');
    expect(formatDuration(3725)).toBe('1:02:05');
  });
});
