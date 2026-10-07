import { countEmojiOnly, isJumboEmoji } from '../emoji';

describe('emoji-only detection', () => {
  it.each([
    ['😀', 1],
    ['😀😀', 2],
    ['😀 🎉 ❤️', 3],
    ['👍🏽', 1], // skin tone modifier
    ['👨‍👩‍👧‍👦', 1], // ZWJ family
    ['🏳️‍🌈', 1], // ZWJ flag with VS16
    ['🇳🇵', 1], // regional indicator pair
    ['1️⃣', 1], // keycap
    ['❤️❤️❤️❤️', 4],
  ])('counts %s as %i cluster(s)', (text, expected) => {
    expect(countEmojiOnly(text)).toBe(expected);
  });

  it.each(['hello', 'hi 😀', '😀!', '123', '', '   '])('rejects %p', (text) => {
    expect(countEmojiOnly(text)).toBe(0);
  });

  it('jumbo only for 1–3 emoji', () => {
    expect(isJumboEmoji('😀')).toBe(true);
    expect(isJumboEmoji('😀😀😀')).toBe(true);
    expect(isJumboEmoji('😀😀😀😀')).toBe(false);
    expect(isJumboEmoji('ok 😀')).toBe(false);
    expect(isJumboEmoji('')).toBe(false);
  });
});
