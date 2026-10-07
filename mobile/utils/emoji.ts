/**
 * Emoji-only detection without Unicode property escapes or Intl.Segmenter (not guaranteed on
 * every Hermes build). Counts emoji *clusters*: ZWJ sequences, skin tones, flags, keycaps and
 * tag sequences each count as one.
 */

const ZWJ = 0x200d;
const VS16 = 0xfe0f;
const KEYCAP = 0x20e3;

function isRegionalIndicator(cp: number): boolean {
  return cp >= 0x1f1e6 && cp <= 0x1f1ff;
}

function isModifierOrTag(cp: number): boolean {
  return cp === VS16 || (cp >= 0x1f3fb && cp <= 0x1f3ff) || (cp >= 0xe0020 && cp <= 0xe007f);
}

function isPictographic(cp: number): boolean {
  return (
    (cp >= 0x1f000 && cp <= 0x1faff) ||
    (cp >= 0x2600 && cp <= 0x27bf) ||
    (cp >= 0x2300 && cp <= 0x23ff) ||
    (cp >= 0x2b00 && cp <= 0x2bff) ||
    (cp >= 0x2190 && cp <= 0x21ff) ||
    (cp >= 0x25a0 && cp <= 0x25ff) ||
    (cp >= 0x2900 && cp <= 0x297f) ||
    cp === 0x00a9 ||
    cp === 0x00ae ||
    cp === 0x203c ||
    cp === 0x2049 ||
    cp === 0x2122 ||
    cp === 0x2139 ||
    cp === 0x24c2 ||
    cp === 0x3030 ||
    cp === 0x303d ||
    cp === 0x3297 ||
    cp === 0x3299
  );
}

function isKeycapBase(cp: number): boolean {
  return (cp >= 0x30 && cp <= 0x39) || cp === 0x23 || cp === 0x2a;
}

function isWhitespace(cp: number): boolean {
  return cp === 0x20 || cp === 0x0a || cp === 0x0d || cp === 0x09 || cp === 0xa0;
}

/** Number of emoji clusters if `text` consists only of emoji (and whitespace); otherwise 0. */
export function countEmojiOnly(text: string): number {
  const cps = Array.from(text, (ch) => ch.codePointAt(0) ?? 0);
  let i = 0;
  let clusters = 0;
  while (i < cps.length) {
    const cp = cps[i] as number;
    if (isWhitespace(cp)) {
      i += 1;
      continue;
    }
    if (isRegionalIndicator(cp)) {
      i += isRegionalIndicator(cps[i + 1] ?? 0) ? 2 : 1;
      clusters += 1;
      continue;
    }
    if (isKeycapBase(cp)) {
      let j = i + 1;
      if (cps[j] === VS16) j += 1;
      if (cps[j] !== KEYCAP) return 0;
      i = j + 1;
      clusters += 1;
      continue;
    }
    if (!isPictographic(cp)) return 0;
    i += 1;
    while (i < cps.length && isModifierOrTag(cps[i] as number)) i += 1;
    while (cps[i] === ZWJ && isPictographic(cps[i + 1] ?? 0)) {
      i += 2;
      while (i < cps.length && isModifierOrTag(cps[i] as number)) i += 1;
    }
    clusters += 1;
  }
  return clusters;
}

/** 1–3 emoji with nothing else ⇒ render large ("jumbo"). */
export function isJumboEmoji(text: string): boolean {
  const n = countEmojiOnly(text);
  return n >= 1 && n <= 3;
}
