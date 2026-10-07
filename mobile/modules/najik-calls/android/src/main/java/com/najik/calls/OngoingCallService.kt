package com.najik.calls

import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * Foreground service for the duration of a connected call so the microphone (and camera for
 * video) keep working when the app is backgrounded or the screen is locked. Android 14 requires
 * typed foreground services: `microphone` (+ `camera` for video). It must be started while the
 * app is visible, which is the case when a call connects.
 */
class OngoingCallService : Service() {
  companion object {
    private const val EXTRA_PEER = "najik_peer_name"
    private const val EXTRA_VIDEO = "najik_video"

    fun start(context: Context, callId: String, peerName: String, video: Boolean) {
      val intent = Intent(context, OngoingCallService::class.java)
        .putExtra(CallActions.EXTRA_CALL_ID, callId)
        .putExtra(EXTRA_PEER, peerName)
        .putExtra(EXTRA_VIDEO, video)
      try {
        ContextCompat.startForegroundService(context, intent)
      } catch (_: Exception) {
        // ForegroundServiceStartNotAllowedException (app not visible) — the call continues while
        // the app stays in the foreground.
      }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, OngoingCallService::class.java))
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val callId = intent?.getStringExtra(CallActions.EXTRA_CALL_ID) ?: ""
    val peer = intent?.getStringExtra(EXTRA_PEER)?.ifBlank { null } ?: "Najik"
    val video = intent?.getBooleanExtra(EXTRA_VIDEO, false) ?: false
    CallNotifications.ensureChannels(this)

    val open = PendingIntent.getActivity(
      this, 7001, CallNotifications.launchIntent(this),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val hangUp = PendingIntent.getBroadcast(
      this, 7002,
      Intent(this, CallActionReceiver::class.java)
        .setAction(CallActionReceiver.ACTION_HANGUP)
        .putExtra(CallActions.EXTRA_CALL_ID, callId),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val person = Person.Builder().setName(peer).setImportant(true).build()
    val notification = NotificationCompat.Builder(this, CallNotifications.CHANNEL_ONGOING)
      .setSmallIcon(CallNotifications.smallIcon(this))
      .setContentTitle(peer)
      .setContentText(if (video) "Video call in progress" else "Voice call in progress")
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setOngoing(true)
      .setUsesChronometer(true)
      .setWhen(System.currentTimeMillis())
      .setContentIntent(open)
      .setStyle(NotificationCompat.CallStyle.forOngoingCall(person, hangUp).setIsVideo(video))
      .build()

    var type = 0
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      type = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
      if (video) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
    }
    try {
      ServiceCompat.startForeground(this, CallNotifications.ID_ONGOING, notification, type)
    } catch (_: Exception) {
      stopSelf()
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }
}
