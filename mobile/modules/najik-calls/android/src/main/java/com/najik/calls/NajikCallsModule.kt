package com.najik.calls

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NajikCallsModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context is not available" }

  override fun definition() = ModuleDefinition {
    Name("NajikCalls")

    Events("onVoipToken", "onIncomingPush", "onCallAction", "onAudioSession")

    OnStartObserving("onCallAction") {
      CallActions.listener = { bundle -> sendEvent("onCallAction", bundle) }
    }

    OnStopObserving("onCallAction") {
      CallActions.listener = null
    }

    OnDestroy {
      CallActions.listener = null
    }

    Function("ensureCallChannel") {
      CallNotifications.ensureChannels(context)
    }

    Function("showIncomingCall") { callId: String, callerId: String, callerName: String, media: String, expiresAt: String ->
      CallNotifications.showIncoming(context, IncomingCall(callId, callerId, callerName, media, expiresAt))
    }

    Function("dismissIncomingCall") { _: String ->
      CallNotifications.dismissIncoming(context)
    }

    Function("startOngoingCall") { callId: String, peerName: String, video: Boolean ->
      OngoingCallService.start(context, callId, peerName, video)
    }

    Function("stopOngoingCall") {
      OngoingCallService.stop(context)
    }

    Function("canUseFullScreenIntent") {
      CallNotifications.canUseFullScreenIntent(context)
    }

    Function("openFullScreenIntentSettings") {
      if (Build.VERSION.SDK_INT >= 34) {
        val intent = Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT)
          .setData(Uri.parse("package:${context.packageName}"))
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
          context.startActivity(intent)
        } catch (_: Exception) {
          // settings screen unavailable on this OEM build
        }
      }
    }

    Function("setShowWhenLocked") { show: Boolean ->
      val activity = appContext.currentActivity ?: CallActivityLifecycleListener.activity?.get()
      if (activity != null) CallActivityLifecycleListener.setShowWhenLocked(activity, show)
    }

    Function("consumePendingActions") {
      CallActions.consume()
    }

    // iOS-only API: no-ops on Android so JS can call them unconditionally.
    Function("registerVoip") {}
    Function("getVoipToken") { null as String? }
    AsyncFunction("reportIncomingCall") { _: String, _: String, _: Boolean -> false }
    Function("reportOutgoingCall") { _: String, _: String, _: Boolean -> }
    Function("reportOutgoingConnected") { _: String -> }
    Function("answerCall") { _: String -> }
    Function("endCall") { _: String -> }
    Function("reportCallEnded") { _: String, _: String -> }
    Function("setMuted") { _: String, _: Boolean -> }
  }
}
