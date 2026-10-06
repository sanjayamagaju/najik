package com.najik.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;
import androidx.core.content.ContextCompat;

/** Incoming-call notification: ringtone, full-screen intent, Answer / Decline. */
final class CallNotifications {
    static final String CHANNEL_ID = "najik_incoming_calls";
    static final String EXTRA_ACTION = "najik_call_action"; // "accept" | "open"
    static final String EXTRA_CALL_ID = "najik_call_id";

    private static final int NOTIFICATION_ID = 7701;
    private static final long[] VIBRATION = {0, 900, 700, 900, 700};

    private CallNotifications() {}

    static void ensureChannel(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Incoming calls", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Rings when someone calls you on Najik");
        ch.setSound(
            ringtone(),
            new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
        );
        ch.enableVibration(true);
        ch.setVibrationPattern(VIBRATION);
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ch);
    }

    @SuppressLint("MissingPermission") // checked explicitly below
    static void showIncoming(Context c, String callId, String callerName, String media, long timeoutMs) {
        ensureChannel(c);
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return;
        }
        boolean video = "video".equals(media);

        PendingIntent open = activityIntent(c, callId, "open", 1);
        PendingIntent answer = activityIntent(c, callId, "accept", 2);
        Intent declineIntent = new Intent(c, CallActionReceiver.class)
            .setAction(CallActionReceiver.ACTION_DECLINE)
            .putExtra(EXTRA_CALL_ID, callId);
        PendingIntent decline = PendingIntent.getBroadcast(
            c,
            requestCode(callId, 3),
            declineIntent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        Person caller = new Person.Builder().setName(callerName).setImportant(true).build();

        NotificationCompat.Builder builder = new NotificationCompat.Builder(c, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_najik)
            .setColor(0xFF8B5CF6)
            .setContentTitle(callerName)
            .setContentText(video ? "Incoming video call" : "Incoming voice call")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(open)
            // Takes over the screen when the phone is locked / idle.
            .setFullScreenIntent(open, true)
            .setTimeoutAfter(timeoutMs)
            // Pre-Android 8 devices take sound & vibration from the notification itself.
            .setSound(ringtone(), AudioManager.STREAM_RING)
            .setVibrate(VIBRATION)
            .setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, decline, answer).setIsVideo(video));

        Notification notification = builder.build();
        notification.flags |= Notification.FLAG_INSISTENT; // keep ringing until handled
        NotificationManagerCompat.from(c).notify(callId, NOTIFICATION_ID, notification);
    }

    static void cancel(Context c, String callId) {
        NotificationManagerCompat.from(c).cancel(callId, NOTIFICATION_ID);
    }

    private static PendingIntent activityIntent(Context c, String callId, String action, int n) {
        Intent intent = new Intent(c, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_ACTION, action)
            .putExtra(EXTRA_CALL_ID, callId);
        return PendingIntent.getActivity(
            c,
            requestCode(callId, n),
            intent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
    }

    private static int requestCode(String callId, int n) {
        return callId.hashCode() * 31 + n;
    }

    private static Uri ringtone() {
        return RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
    }
}
