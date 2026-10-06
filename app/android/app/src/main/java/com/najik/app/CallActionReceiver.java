package com.najik.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import java.util.regex.Pattern;

/** Handles "Decline" on the incoming-call notification without opening the app. */
public class CallActionReceiver extends BroadcastReceiver {
    static final String ACTION_DECLINE = "com.najik.app.DECLINE_CALL";
    private static final Pattern UUID = Pattern.compile("^[0-9a-fA-F-]{36}$");

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!ACTION_DECLINE.equals(intent.getAction())) return;
        String callId = intent.getStringExtra(CallNotifications.EXTRA_CALL_ID);
        if (callId == null || !UUID.matcher(callId).matches()) return;

        CallNotifications.cancel(context, callId);
        // Keep the receiver alive until the request completes.
        PendingResult pending = goAsync();
        PushStore.post(context, "/api/calls/" + callId + "/decline", "{}", pending::finish);
    }
}
