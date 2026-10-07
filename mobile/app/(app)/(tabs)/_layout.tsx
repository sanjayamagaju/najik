import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/js-tabs';
import { StyleSheet } from 'react-native';

import { RouteErrorBoundary } from '@/components/RouteErrorBoundary';
import { useTheme } from '@/hooks/useTheme';
import { selectTotalUnread, useConversationsStore } from '@/store/conversationsStore';
import { haptics } from '@/utils/haptics';

export { RouteErrorBoundary as ErrorBoundary };

export default function TabsLayout() {
  const { colors, typography } = useTheme();
  const unread = useConversationsStore(selectTotalUnread);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarStyle: {
          backgroundColor: colors.tabBar,
          borderTopColor: colors.separator,
          borderTopWidth: StyleSheet.hairlineWidth,
        },
        tabBarLabelStyle: { fontFamily: typography.caption.fontFamily, fontSize: 11 },
        tabBarBadgeStyle: {
          backgroundColor: colors.primary,
          color: colors.onPrimary,
          fontFamily: typography.micro.fontFamily,
        },
        sceneStyle: { backgroundColor: colors.background },
      }}
      screenListeners={{ tabPress: () => haptics.selection() }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Chats',
          tabBarAccessibilityLabel: unread > 0 ? `Chats, ${unread} unread` : 'Chats',
          tabBarBadge: unread > 0 ? (unread > 99 ? '99+' : unread) : undefined,
          tabBarIcon: ({ color, focused, size }) => (
            <Ionicons
              name={focused ? 'chatbubbles' : 'chatbubbles-outline'}
              color={color}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, focused, size }) => (
            <Ionicons name={focused ? 'settings' : 'settings-outline'} color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
