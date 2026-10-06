package com.najik.app;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static volatile boolean foreground = false;

    /** True while the app is visible, so pushes defer to the in-app call UI. */
    static boolean isInForeground() {
        return foreground;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before the bridge starts.
        registerPlugin(CallAudioPlugin.class);
        registerPlugin(NajikPushPlugin.class);
        super.onCreate(savedInstanceState);
        handleCallIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleCallIntent(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        foreground = true;
    }

    @Override
    public void onPause() {
        super.onPause();
        foreground = false;
    }

    /** Opened from an incoming-call notification (tap, full-screen intent or Answer). */
    private void handleCallIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getStringExtra(CallNotifications.EXTRA_ACTION);
        String callId = intent.getStringExtra(CallNotifications.EXTRA_CALL_ID);
        if (action == null || callId == null) return;

        CallNotifications.cancel(this, callId);
        // Show the call over the lock screen and wake the display.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        NajikPushPlugin.dispatchCallAction(action, callId);
        // Don't replay the action if the activity is recreated (e.g. rotation).
        intent.removeExtra(CallNotifications.EXTRA_ACTION);
    }
}
