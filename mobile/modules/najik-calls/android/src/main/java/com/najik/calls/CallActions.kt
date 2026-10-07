package com.najik.calls

import android.content.Intent
import android.os.Bundle

/**
 * Call actions coming from notifications (answer / decline / hang up / full-screen open).
 * Delivered to JS when it listens, otherwise buffered until JS calls `consumePendingActions()`
 * (cold start from a notification action).
 */
object CallActions {
  const val EXTRA_ACTION = "najik_call_action"
  const val EXTRA_CALL_ID = "najik_call_id"
  const val EXTRA_CALLER_ID = "najik_caller_id"
  const val EXTRA_CALLER_NAME = "najik_caller_name"
  const val EXTRA_MEDIA = "najik_media"
  const val EXTRA_EXPIRES_AT = "najik_expires_at"

  @Volatile
  var listener: ((Bundle) -> Unit)? = null

  private val pending = mutableListOf<Map<String, String>>()

  fun fromIntent(intent: Intent?): Map<String, String>? {
    val action = intent?.getStringExtra(EXTRA_ACTION) ?: return null
    val callId = intent.getStringExtra(EXTRA_CALL_ID) ?: return null
    val out = mutableMapOf("action" to action, "callId" to callId)
    intent.getStringExtra(EXTRA_CALLER_ID)?.let { out["callerId"] = it }
    intent.getStringExtra(EXTRA_CALLER_NAME)?.let { out["callerName"] = it }
    intent.getStringExtra(EXTRA_MEDIA)?.let { out["media"] = it }
    intent.getStringExtra(EXTRA_EXPIRES_AT)?.let { out["expiresAt"] = it }
    return out
  }

  fun putExtras(intent: Intent, action: String, payload: IncomingCall): Intent {
    return intent
      .putExtra(EXTRA_ACTION, action)
      .putExtra(EXTRA_CALL_ID, payload.callId)
      .putExtra(EXTRA_CALLER_ID, payload.callerId)
      .putExtra(EXTRA_CALLER_NAME, payload.callerName)
      .putExtra(EXTRA_MEDIA, payload.media)
      .putExtra(EXTRA_EXPIRES_AT, payload.expiresAt)
  }

  fun dispatch(event: Map<String, String>) {
    val current = listener
    if (current != null) {
      val bundle = Bundle()
      event.forEach { (k, v) -> bundle.putString(k, v) }
      current(bundle)
    } else {
      synchronized(pending) { pending.add(event) }
    }
  }

  fun consume(): List<Map<String, String>> {
    synchronized(pending) {
      val out = pending.toList()
      pending.clear()
      return out
    }
  }
}

data class IncomingCall(
  val callId: String,
  val callerId: String,
  val callerName: String,
  val media: String,
  val expiresAt: String,
)
