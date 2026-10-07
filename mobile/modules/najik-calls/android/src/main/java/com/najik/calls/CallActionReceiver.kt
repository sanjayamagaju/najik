package com.najik.calls

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Decline (incoming notification) and Hang up (ongoing-call notification) actions. */
class CallActionReceiver : BroadcastReceiver() {
  companion object {
    const val ACTION_DECLINE = "com.najik.calls.DECLINE"
    const val ACTION_HANGUP = "com.najik.calls.HANGUP"
  }

  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      ACTION_DECLINE -> {
        CallNotifications.dismissIncoming(context)
        // If JS isn't running the decline is buffered; the server then ends the call on its
        // 45 s ring timeout (no WebSocket to send `call.decline` over).
        CallActions.fromIntent(intent)?.let { CallActions.dispatch(it + ("action" to "decline")) }
      }
      ACTION_HANGUP -> {
        val callId = intent.getStringExtra(CallActions.EXTRA_CALL_ID) ?: return
        CallActions.dispatch(mapOf("action" to "end", "callId" to callId))
      }
    }
  }
}
