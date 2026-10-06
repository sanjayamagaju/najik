import EmojiPicker, { EmojiStyle, SkinTonePickerLocation, SuggestionMode, Theme } from 'emoji-picker-react';
import { useTheme } from '../../stores/theme';

/** Lazy-loaded so the emoji dataset doesn't weigh down app start-up. */
export default function EmojiPanel({ onPick }: { onPick: (emoji: string) => void }) {
  const dark = useTheme((s) => s.dark);
  return (
    <EmojiPicker
      onEmojiClick={(e) => onPick(e.emoji)}
      theme={dark ? Theme.DARK : Theme.LIGHT}
      emojiStyle={EmojiStyle.NATIVE}
      suggestedEmojisMode={SuggestionMode.RECENT}
      skinTonePickerLocation={SkinTonePickerLocation.SEARCH}
      lazyLoadEmojis
      autoFocusSearch={false}
      previewConfig={{ showPreview: false }}
      width="100%"
      height="100%"
    />
  );
}
