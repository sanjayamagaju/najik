import { useLocalSearchParams } from 'expo-router';

import { RouteErrorBoundary } from '@/components/RouteErrorBoundary';
import { ChatScreen } from '@/features/messages/screens/ChatScreen';

export { RouteErrorBoundary as ErrorBoundary };

export default function ChatRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // Remount per conversation so per-thread state never leaks between chats.
  return id ? <ChatScreen key={id} conversationId={id} /> : null;
}
