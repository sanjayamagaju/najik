export interface BackoffOptions {
  baseMs: number;
  capMs: number;
}

/**
 * Exponential backoff with *full jitter* (AWS architecture blog): a uniformly random delay in
 * [0, min(cap, base · 2^attempt)). `attempt` starts at 0.
 */
export function fullJitterBackoff(
  attempt: number,
  { baseMs, capMs }: BackoffOptions,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.floor(random() * ceiling);
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
