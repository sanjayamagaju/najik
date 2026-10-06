package com.najik.app;

import androidx.annotation.NonNull;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;
import org.json.JSONObject;

/**
 * Receives the server's data-only FCM messages. Runs even when the app was
 * swiped away, so an incoming call can ring a closed / locked phone.
 */
public class NajikMessagingService extends FirebaseMessagingService {

    @Override
    public void onNewToken(@NonNull String token) {
        PushStore.setFcmToken(this, token);
        // Keep the server current even if the app isn't opened for a while.
        try {
            JSONObject body = new JSONObject().put("token", token).put("platform", "android");
            PushStore.post(this, "/api/push/register", body.toString(), null);
        } catch (Exception ignored) {
            // JSON construction cannot realistically fail here.
        }
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        Map<String, String> data = message.getData();
        String type = data.get("type");
        String callId = data.get("callId");
        if (callId == null) return;

        if ("call".equals(type)) {
            long ttl = parseLong(data.get("ttlMs"), 40_000L);
            long sentAt = message.getSentTime() > 0 ? message.getSentTime() : System.currentTimeMillis();
            long remaining = sentAt + ttl - System.currentTimeMillis();
            if (remaining < 2_000) return; // stale: the call has already stopped ringing
            // With the app on screen, the live in-app call UI rings instead.
            if (MainActivity.isInForeground()) return;
            String name = data.get("callerName");
            CallNotifications.showIncoming(this, callId, name == null || name.isEmpty() ? "Najik" : name, data.get("media"), remaining);
        } else if ("call-end".equals(type)) {
            CallNotifications.cancel(this, callId);
        }
    }

    private static long parseLong(String value, long fallback) {
        try {
            return value == null ? fallback : Long.parseLong(value);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }
}
