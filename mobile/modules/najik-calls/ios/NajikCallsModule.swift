import ExpoModulesCore

public class NajikCallsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NajikCalls")

    Events("onVoipToken", "onIncomingPush", "onCallAction", "onAudioSession")

    OnStartObserving("onCallAction") {
      CallCenter.shared.emitter = { [weak self] name, body in
        self?.sendEvent(name, body)
      }
    }

    OnStopObserving("onCallAction") {
      CallCenter.shared.emitter = nil
    }

    Function("registerVoip") {
      CallCenter.shared.registerVoip()
    }

    Function("getVoipToken") { () -> String? in
      CallCenter.shared.voipToken
    }

    AsyncFunction("reportIncomingCall") { (callId: String, callerName: String, hasVideo: Bool, promise: Promise) in
      guard let uuid = UUID(uuidString: callId) else {
        promise.resolve(false)
        return
      }
      CallCenter.shared.report(uuid: uuid, callerName: callerName, handle: "", hasVideo: hasVideo) { error in
        // `callUUIDAlreadyExists` means the VoIP push reported it first, which is fine.
        promise.resolve(error == nil)
      }
    }

    Function("reportOutgoingCall") { (callId: String, handle: String, hasVideo: Bool) in
      if let uuid = UUID(uuidString: callId) {
        CallCenter.shared.reportOutgoing(uuid: uuid, handle: handle, hasVideo: hasVideo)
      }
    }

    Function("reportOutgoingConnected") { (callId: String) in
      if let uuid = UUID(uuidString: callId) { CallCenter.shared.reportOutgoingConnected(uuid: uuid) }
    }

    Function("answerCall") { (callId: String) in
      if let uuid = UUID(uuidString: callId) { CallCenter.shared.answer(uuid: uuid) }
    }

    Function("endCall") { (callId: String) in
      if let uuid = UUID(uuidString: callId) { CallCenter.shared.end(uuid: uuid) }
    }

    Function("reportCallEnded") { (callId: String, reason: String) in
      if let uuid = UUID(uuidString: callId) { CallCenter.shared.reportEnded(uuid: uuid, reason: reason) }
    }

    Function("setMuted") { (callId: String, muted: Bool) in
      if let uuid = UUID(uuidString: callId) { CallCenter.shared.setMuted(uuid: uuid, muted: muted) }
    }

    Function("consumePendingActions") { () -> [[String: Any]] in
      CallCenter.shared.consumePending()
    }

    // Android-only API: no-ops on iOS so JS can call them unconditionally.
    Function("ensureCallChannel") {}
    Function("showIncomingCall") { (_: String, _: String, _: String, _: String, _: String) in }
    Function("dismissIncomingCall") { (_: String) in }
    Function("startOngoingCall") { (_: String, _: String, _: Bool) in }
    Function("stopOngoingCall") {}
    Function("canUseFullScreenIntent") { () -> Bool in true }
    Function("openFullScreenIntentSettings") {}
    Function("setShowWhenLocked") { (_: Bool) in }
  }
}
