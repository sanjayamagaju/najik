package com.najik.calls

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import expo.modules.core.interfaces.ReactActivityLifecycleListener
import java.lang.ref.WeakReference

/**
 * Picks up Answer / full-screen launches of the main activity (cold start or running) and lets
 * the activity show over the lock screen *only* for calls — the flag is cleared from JS when the
 * call ends so chats are never visible on a locked device.
 */
class CallActivityLifecycleListener : ReactActivityLifecycleListener {
  companion object {
    var activity: WeakReference<Activity>? = null

    fun setShowWhenLocked(target: Activity, show: Boolean) {
      target.runOnUiThread {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
          target.setShowWhenLocked(show)
          target.setTurnScreenOn(show)
        } else {
          @Suppress("DEPRECATION")
          val flags = WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
          @Suppress("DEPRECATION")
          if (show) target.window.addFlags(flags) else target.window.clearFlags(flags)
        }
      }
    }
  }

  override fun onCreate(activity: Activity?, savedInstanceState: Bundle?) {
    if (activity == null) return
    Companion.activity = WeakReference(activity)
    handle(activity, activity.intent)
  }

  override fun onResume(activity: Activity?) {
    if (activity != null) Companion.activity = WeakReference(activity)
  }

  override fun onNewIntent(intent: Intent?): Boolean {
    val current = activity?.get() ?: return false
    return handle(current, intent)
  }

  private fun handle(activity: Activity, intent: Intent?): Boolean {
    val event = CallActions.fromIntent(intent) ?: return false
    // Consume so a configuration change doesn't replay the action.
    intent?.removeExtra(CallActions.EXTRA_ACTION)
    setShowWhenLocked(activity, true)
    if (event["action"] == "answer") CallNotifications.dismissIncoming(activity)
    CallActions.dispatch(event)
    return true
  }
}
