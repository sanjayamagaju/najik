import { useEffect, useState } from 'react';

import { Text, type TextProps } from '@/components/Text';

import { formatCallDuration } from '../model/qualityUi';

/** Live mm:ss since `since` (epoch ms), ticking once per second. */
export function CallDuration({
  since,
  ...textProps
}: { since: number } & Omit<TextProps, 'children'>) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);
  const label = formatCallDuration((now - since) / 1000);
  return (
    <Text accessibilityLabel={`Call duration ${label}`} {...textProps}>
      {label}
    </Text>
  );
}
