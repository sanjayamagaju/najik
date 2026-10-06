package com.najik.app;

import android.content.Context;
import android.content.SharedPreferences;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Small app-private store shared by the push service, the notification
 * actions and the JS bridge: the server URL + session token (so a call can be
 * declined from the notification without opening the app) and the FCM token.
 */
final class PushStore {
    private static final String PREFS = "najik_push";
    private static final String KEY_SERVER = "server_url";
    private static final String KEY_AUTH = "auth_token";
    private static final String KEY_FCM = "fcm_token";

    private PushStore() {}

    private static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void setSession(Context c, String serverUrl, String authToken) {
        prefs(c).edit().putString(KEY_SERVER, serverUrl).putString(KEY_AUTH, authToken).apply();
    }

    static void clearSession(Context c) {
        prefs(c).edit().remove(KEY_SERVER).remove(KEY_AUTH).apply();
    }

    static void setFcmToken(Context c, String token) {
        prefs(c).edit().putString(KEY_FCM, token).apply();
    }

    /**
     * Authenticated JSON POST to the Najik server on a background thread.
     * {@code done} (may be null) runs afterwards, success or not.
     */
    static void post(Context c, String path, String jsonBody, Runnable done) {
        String base = prefs(c).getString(KEY_SERVER, null);
        String auth = prefs(c).getString(KEY_AUTH, null);
        if (base == null || auth == null || base.isEmpty()) {
            if (done != null) done.run();
            return;
        }
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(base + path).openConnection();
                conn.setRequestMethod("POST");
                conn.setConnectTimeout(8000);
                conn.setReadTimeout(8000);
                conn.setDoOutput(true);
                conn.setRequestProperty("Authorization", "Bearer " + auth);
                conn.setRequestProperty("Content-Type", "application/json");
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(jsonBody.getBytes(StandardCharsets.UTF_8));
                }
                conn.getResponseCode();
            } catch (Exception ignored) {
                // Best effort: the call will time out server-side anyway.
            } finally {
                if (conn != null) conn.disconnect();
                if (done != null) done.run();
            }
        }).start();
    }
}
