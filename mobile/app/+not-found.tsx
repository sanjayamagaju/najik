import { router } from 'expo-router';

import { EmptyState } from '@/components/EmptyState';
import { Screen } from '@/components/Screen';
import { routes } from '@/navigation/routes';

export default function NotFound() {
  return (
    <Screen edges={['top', 'bottom']}>
      <EmptyState
        icon="compass-outline"
        title="Nothing here"
        message="This link doesn't lead anywhere in Najik."
        actionLabel="Go to chats"
        onAction={() => router.replace(routes.chats)}
      />
    </Screen>
  );
}
