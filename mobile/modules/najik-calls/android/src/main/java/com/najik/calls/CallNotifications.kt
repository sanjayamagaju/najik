package com.najik.calls

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.content.ContextCompat
import java.time.Instant

/**
 * Incoming-call notification: `calls` channel (max importance, ringtone, vibration),
 * `CallStyle.forIncomingCall` with Answer / Decline, and a full-screen intent so the call UI
 * shows over the lock screen. Answer opens the activity directly (Android 12+ forbids
 * notification trampolines); Decline is handled by a broadcast receiver.
 */
object CallNotifications {
  /** Must match `ANDROID_CHANNELS.calls` in JS and the backend's FCM channel id. */
  const val CHANNEL_INCOMING = "calls"
  const val CHANNEL_ONGOING = "calls_ongoing"
  const val TAG_INCOMING = "najik_incoming_call"
  const val ID_INCOMING = 4101
  const val ID_ONGOING = 4102

  fun ensureChannels(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    if (manager.getNotificationChannel(CHANNEL_INCOMING) == null) {
      val incoming = NotificationChannel(CHANNEL_INCOMING, "Calls", NotificationManager.IMPORTANCE_HIGH).apply {
        description = "Incoming voice and video calls"
        enableVibration(true)
        vibrationPattern = longArrayOf(0, 900, 700, 900, 700)
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        setSound(
          RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build(),
        )
      }
      manager.createNotificationChannel(incoming)
    }
    if (manager.getNotificationChannel(CHANNEL_ONGOING) == null) {
      val ongoing = NotificationChannel(CHANNEL_ONGOING, "Ongoing call", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Shown while you are in a call"
        setSound(null, null)
        enableVibration(false)
      }
      manager.createNotificationChannel(ongoing)
    }
  }

  fun smallIcon(context: Context): Int {
    // expo-notifications generates `notification_icon` from app.config.ts.
    val id = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
    return if (id != 0) id else android.R.drawable.sym_call_incoming
  }

  fun launchIntent(context: Context): Intent {
    val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?: Intent(Intent.ACTION_MAIN).setPackage(context.packageName)
    return intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
  }

  private fun requestCode(callId: String, salt: Int) = (callId.hashCode() and 0x0fffffff) + salt

  private const val FLAGS = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

  fun showIncoming(context: Context, call: IncomingCall) {
    ensureChannels(context)
    if (!canPostNotifications(context)) return

    val remainingMs = remainingMs(call.expiresAt)
    if (remainingMs != null && remainingMs <= 0) return

    val open = PendingIntent.getActivity(
      context, requestCode(call.callId, 1),
      CallActions.putExtras(launchIntent(context), "show", call), FLAGS,
    )
    val answer = PendingIntent.getActivity(
      context, requestCode(call.callId, 2),
      CallActions.putExtras(launchIntent(context), "answer", call), FLAGS,
    )
    val decline = PendingIntent.getBroadcast(
      context, requestCode(call.callId, 3),
      CallActions.putExtras(
        Intent(context, CallActionReceiver::class.java).setAction(CallActionReceiver.ACTION_DECLINE),
        "decline", call,
      ),
      FLAGS,
    )
    val caller = Person.Builder().setName(call.callerName.ifBlank { "Najik" }).setImportant(true).build()
    val builder = NotificationCompat.Builder(context, CHANNEL_INCOMING)
      .setSmallIcon(smallIcon(context))
      .setContentTitle(call.callerName.ifBlank { "Najik" })
      .setContentText(if (call.media == "video") "Incoming video call" else "Incoming voice call")
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOngoing(true)
      .setAutoCancel(false)
      .setContentIntent(open)
      .setFullScreenIntent(open, true)
      .setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, decline, answer).setIsVideo(call.media == "video"))
    if (remainingMs != null) builder.setTimeoutAfter(remainingMs)
    val notification = builder.build()
    // Keep ringing until answered/declined/timed out.
    notification.flags = notification.flags or Notification.FLAG_INSISTENT
    try {
      NotificationManagerCompat.from(context).notify(TAG_INCOMING, ID_INCOMING, notification)
    } catch (_: SecurityException) {
      // POST_NOTIFICATIONS revoked between the check and notify.
    }
  }

  fun dismissIncoming(context: Context) {
    NotificationManagerCompat.from(context).cancel(TAG_INCOMING, ID_INCOMING)
  }

  fun canPostNotifications(context: Context): Boolean {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
      ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) {
      return false
    }
    return NotificationManagerCompat.from(context).areNotificationsEnabled()
  }

  fun canUseFullScreenIntent(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < 34) return true
    val manager = context.getSystemService(NotificationManager::class.java) ?: return false
    return manager.canUseFullScreenIntent()
  }

  private fun remainingMs(expiresAt: String): Long? {
    if (expiresAt.isBlank() || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return null
    return try {
      Instant.parse(expiresAt).toEpochMilli() - System.currentTimeMillis()
    } catch (_: Exception) {
      null
    }
  }
}
