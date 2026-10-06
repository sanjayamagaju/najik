package com.najik.app;

import android.Manifest;
import android.app.NotificationManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.view.WindowManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;

/** JS bridge for push: FCM token, notification permission, call actions from notifications. */
@CapacitorPlugin(
    name = "NajikPush",
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class NajikPushPlugin extends Plugin {
    private static NajikPushPlugin instance;
    private static JSObject pendingAction;

    @Override
    public void load() {
        instance = this;
        CallNotifications.ensureChannel(getContext());
        if (pendingAction != null) {
            notifyListeners("callAction", pendingAction, true);
            pendingAction = null;
        }
    }

    /** Called by MainActivity when it was opened from a call notification. */
    static void dispatchCallAction(String action, String callId) {
        JSObject data = new JSObject();
        data.put("action", action);
        data.put("callId", callId);
        if (instance != null) {
            // Retained until the web app attaches its listener (cold start).
            instance.notifyListeners("callAction", data, true);
        } else {
            pendingAction = data;
        }
    }

    @PluginMethod
    public void getToken(PluginCall call) {
        if (FirebaseApp.getApps(getContext()).isEmpty()) {
            call.reject("Firebase is not configured (android/app/google-services.json is missing)", "UNAVAILABLE");
            return;
        }
        FirebaseMessaging.getInstance()
            .getToken()
            .addOnCompleteListener(task -> {
                if (!task.isSuccessful() || task.getResult() == null) {
                    call.reject("Could not get an FCM token", "UNAVAILABLE");
                    return;
                }
                String token = task.getResult();
                PushStore.setFcmToken(getContext(), token);
                JSObject ret = new JSObject();
                ret.put("token", token);
                call.resolve(ret);
            });
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState("notifications") == PermissionState.GRANTED) {
            resolveGranted(call, true);
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationsCallback");
    }

    @PermissionCallback
    private void notificationsCallback(PluginCall call) {
        resolveGranted(call, getPermissionState("notifications") == PermissionState.GRANTED);
    }

    private void resolveGranted(PluginCall call, boolean granted) {
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    /** Lets notification actions (Decline) talk to the server while the app is closed. */
    @PluginMethod
    public void setSession(PluginCall call) {
        String serverUrl = call.getString("serverUrl");
        String token = call.getString("token");
        if (serverUrl == null || token == null) {
            call.reject("serverUrl and token are required");
            return;
        }
        PushStore.setSession(getContext(), serverUrl, token);
        call.resolve();
    }

    @PluginMethod
    public void clearSession(PluginCall call) {
        PushStore.clearSession(getContext());
        call.resolve();
    }

    /** Android 14+ requires the user to allow full-screen call alerts. */
    @PluginMethod
    public void fullScreenStatus(PluginCall call) {
        boolean allowed = true;
        if (Build.VERSION.SDK_INT >= 34) {
            NotificationManager nm = getContext().getSystemService(NotificationManager.class);
            allowed = nm == null || nm.canUseFullScreenIntent();
        }
        JSObject ret = new JSObject();
        ret.put("allowed", allowed);
        call.resolve(ret);
    }

    @PluginMethod
    public void openFullScreenSettings(PluginCall call) {
        Intent intent;
        if (Build.VERSION.SDK_INT >= 34) {
            intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + getContext().getPackageName()));
        } else {
            intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    /** After a call ends, stop showing the app over the lock screen. */
    @PluginMethod
    public void releaseLockScreen(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                getActivity().setShowWhenLocked(false);
                getActivity().setTurnScreenOn(false);
            } else {
                getActivity()
                    .getWindow()
                    .clearFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
            }
        });
        call.resolve();
    }
}
