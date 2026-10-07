import * as Application from 'expo-application';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import {
  forgetVoipToken,
  registerVoipToken,
  resetCalls,
  unregisterVoipToken,
} from '@/features/calls/services/callService';
import { stopAllTyping } from '@/features/messages/services/typingSender';
import { authApi, usersApi } from '@/services/api/endpoints';
import { ApiError } from '@/services/api/errors';
import { tokenManager } from '@/services/api/instance';
import type { ForcedLogoutReason } from '@/services/api/tokenManager';
import {
  clearAllNotifications,
  forgetDeviceToken,
  registerDeviceToken,
  unregisterDeviceToken,
} from '@/services/notifications';
import { startRealtime, stopRealtime } from '@/services/realtime/realtime';
import { getDeviceId } from '@/services/storage/deviceId';
import { telemetry } from '@/services/telemetry';
import { setWsAuthRejectedHandler } from '@/services/websocket';
import { type SignOutReason, useAuthStore } from '@/store/authStore';
import {
  hydrateUserStores,
  resetUserData,
  sessionUserCache,
  startUserPersistence,
} from '@/store/persistence';
import type { AuthResponse, DeviceInfo, Me, Platform as ApiPlatform } from '@/types/protocol';

import type { LoginForm, RegisterForm } from '../validation';

async function deviceInfo(): Promise<DeviceInfo> {
  const name =
    Device.deviceName ?? [Device.manufacturer, Device.modelName].filter(Boolean).join(' ');
  return {
    device_id: await getDeviceId(),
    platform: (Platform.OS === 'ios' ? 'ios' : 'android') as ApiPlatform,
    name: (name || (Platform.OS === 'ios' ? 'iPhone' : 'Android')).slice(0, 64),
    app_version: Application.nativeApplicationVersion ?? '1.0.0',
  };
}

async function beginSession(user: Me): Promise<void> {
  telemetry.setUser(user.id);
  await hydrateUserStores(user.id);
  startUserPersistence(user.id);
  useAuthStore.getState().setSignedIn(user);
  startRealtime();
  void registerDeviceToken();
  registerVoipToken();
}

let ending: Promise<void> | null = null;

/** Tears down everything user-specific. Idempotent and safe to call concurrently. */
function endSession(reason: SignOutReason): Promise<void> {
  ending ??= (async () => {
    resetCalls(); // hangs up over the socket before it closes
    stopAllTyping();
    stopRealtime();
    await tokenManager.clear();
    await sessionUserCache.clear();
    await resetUserData();
    await clearAllNotifications();
    telemetry.setUser(null);
    useAuthStore.getState().setSignedOut(reason === 'user' ? null : reason);
  })().finally(() => {
    ending = null;
  });
  return ending;
}

async function completeAuth(response: AuthResponse): Promise<void> {
  await tokenManager.setTokens(response.tokens);
  await sessionUserCache.write(response.user, null);
  await beginSession(response.user);
}

export async function login(form: LoginForm): Promise<void> {
  const response = await authApi.login({
    username: form.username.trim(),
    password: form.password,
    device: await deviceInfo(),
  });
  await completeAuth(response);
}

export async function register(form: RegisterForm): Promise<void> {
  const email = form.email.trim();
  const response = await authApi.register({
    username: form.username.trim(),
    display_name: form.displayName.trim(),
    password: form.password,
    ...(email ? { email } : {}),
    device: await deviceInfo(),
  });
  await completeAuth(response);
}

/** User-initiated logout: unregister push, revoke the session server-side, wipe local data. */
export async function logout(): Promise<void> {
  await unregisterDeviceToken();
  await unregisterVoipToken();
  try {
    await authApi.logout();
  } catch (error) {
    // The local session ends regardless; the server session expires with its refresh token.
    telemetry.warn('auth', 'server logout failed', { error: String(error) });
  }
  await endSession('user');
}

/** Session revoked / token invalid / WS 4004: no server calls are possible any more. */
export function forceLogout(reason: ForcedLogoutReason): void {
  if (useAuthStore.getState().status !== 'signedIn') return;
  telemetry.warn('auth', 'session ended by server', { reason });
  forgetDeviceToken();
  forgetVoipToken();
  void endSession('forced');
}

export async function deleteAccount(password: string): Promise<void> {
  await usersApi.deleteMe(password);
  forgetDeviceToken();
  forgetVoipToken();
  await endSession('account_deleted');
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await authApi.changePassword({ current_password: currentPassword, new_password: newPassword });
}

export async function updateDisplayName(displayName: string): Promise<Me> {
  const user = await usersApi.updateMe({ display_name: displayName.trim() });
  useAuthStore.getState().setUser(user);
  await sessionUserCache.write(user, null);
  return user;
}

/** Server-side setting: whether message pushes include a text preview. */
export async function setMessagePreview(enabled: boolean): Promise<Me> {
  const user = await usersApi.updateMe({ show_message_preview: enabled });
  useAuthStore.getState().setUser(user);
  await sessionUserCache.write(user, null);
  return user;
}

/** Refreshes the cached profile in the background. */
async function refreshProfile(): Promise<void> {
  try {
    const user = await usersApi.me();
    if (useAuthStore.getState().status !== 'signedIn') return;
    useAuthStore.getState().setUser(user);
    await sessionUserCache.write(user, null);
  } catch (error) {
    if (!(error instanceof ApiError && error.isNetwork)) {
      telemetry.warn('auth', 'profile refresh failed', { error: String(error) });
    }
  }
}

let wired = false;

function wireForcedLogout(): void {
  if (wired) return;
  wired = true;
  tokenManager.setForcedLogoutHandler(forceLogout);
  setWsAuthRejectedHandler((reason) => forceLogout(reason === 'ws_4004' ? 'ws_4004' : reason));
}

/**
 * Cold start: restore the session from SecureStore + the cached profile. Works offline.
 * Resolves once the auth status is known so the splash screen can be hidden.
 */
export async function bootstrapSession(): Promise<void> {
  wireForcedLogout();
  try {
    await getDeviceId(); // wipes stale Keychain tokens on a fresh install
    const tokens = await tokenManager.hydrate();
    if (!tokens) {
      useAuthStore.getState().setSignedOut(null);
      return;
    }
    let user = await sessionUserCache.read(null);
    if (!user) {
      try {
        user = await usersApi.me();
        await sessionUserCache.write(user, null);
      } catch (error) {
        telemetry.warn('auth', 'no cached profile and /users/me failed', { error: String(error) });
        if (error instanceof ApiError && error.isNetwork) {
          // Without a profile we can't render the app; signing in again replaces this
          // device's session server-side (same device_id).
          await tokenManager.clear();
          useAuthStore.getState().setSignedOut(null);
          return;
        }
        await endSession('forced');
        return;
      }
    }
    await beginSession(user);
    void refreshProfile();
  } catch (error) {
    telemetry.error('auth', 'session bootstrap failed', error);
    useAuthStore.getState().setSignedOut(null);
  }
}
