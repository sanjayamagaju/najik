import AVFoundation
import CallKit
import Foundation
import PushKit

/// Process-wide PushKit + CallKit owner. Lives independently of the JS runtime so that pushes
/// and CallKit actions that happen before React Native is up are buffered, not lost.
final class CallCenter: NSObject, PKPushRegistryDelegate, CXProviderDelegate {
  static let shared = CallCenter()

  /// Set by the Expo module while JS listens for `onCallAction`; nil ⇒ actions are buffered.
  var emitter: ((String, [String: Any]) -> Void)?

  private(set) var voipToken: String?
  private var registry: PKPushRegistry?
  private let provider: CXProvider
  private let callController = CXCallController()
  private var pending: [[String: Any]] = []
  private var payloads: [UUID: [String: Any]] = [:]
  private let lock = NSLock()

  private override init() {
    let config = CXProviderConfiguration()
    config.supportsVideo = true
    config.maximumCallGroups = 1
    config.maximumCallsPerCallGroup = 1
    config.supportedHandleTypes = [.generic]
    config.includesCallsInRecents = false
    provider = CXProvider(configuration: config)
    super.init()
    provider.setDelegate(self, queue: nil)
  }

  // MARK: - PushKit

  func registerVoip() {
    let register = {
      guard self.registry == nil else { return }
      let registry = PKPushRegistry(queue: .main)
      registry.delegate = self
      registry.desiredPushTypes = [.voIP]
      self.registry = registry
    }
    if Thread.isMainThread { register() } else { DispatchQueue.main.async(execute: register) }
  }

  func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
    guard type == .voIP else { return }
    let token = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
    voipToken = token
    emit("onVoipToken", ["token": token], buffer: false)
  }

  func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
    if type == .voIP { voipToken = nil }
  }

  func pushRegistry(
    _ registry: PKPushRegistry,
    didReceiveIncomingPushWith payload: PKPushPayload,
    for type: PKPushType,
    completion: @escaping () -> Void
  ) {
    guard type == .voIP else {
      completion()
      return
    }
    var data: [String: Any] = [:]
    for (key, value) in payload.dictionaryRepresentation {
      if let key = key as? String, key != "aps" { data[key] = value }
    }
    let callIdString = (data["call_id"] as? String) ?? ""
    let parsed = UUID(uuidString: callIdString)
    let uuid = parsed ?? UUID()
    let callerName = (data["caller_name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Najik"
    let hasVideo = (data["media"] as? String) == "video"
    let valid = (data["type"] as? String) == "call.incoming" && parsed != nil
    let expired = Self.isExpired(data["expires_at"] as? String)

    // iOS requires a CallKit report for EVERY VoIP push, even stale or malformed ones.
    report(uuid: uuid, callerName: callerName, handle: (data["caller_id"] as? String) ?? "", hasVideo: hasVideo) { error in
      if !valid || expired {
        self.provider.reportCall(with: uuid, endedAt: nil, reason: .unanswered)
      } else if error == nil {
        self.lock.lock()
        self.payloads[uuid] = data
        self.lock.unlock()
        self.emit("onIncomingPush", data, buffer: false)
        self.bufferAction("show", uuid: uuid)
      }
      completion()
    }
  }

  private static func isExpired(_ iso: String?) -> Bool {
    guard let iso, !iso.isEmpty else { return false }
    let precise = ISO8601DateFormatter()
    precise.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let date = precise.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return false }
    return date < Date()
  }

  // MARK: - CallKit reporting (called from JS)

  func report(uuid: UUID, callerName: String, handle: String, hasVideo: Bool, completion: @escaping (Error?) -> Void) {
    let update = CXCallUpdate()
    update.remoteHandle = CXHandle(type: .generic, value: handle.isEmpty ? callerName : handle)
    update.localizedCallerName = callerName
    update.hasVideo = hasVideo
    update.supportsHolding = false
    update.supportsGrouping = false
    update.supportsUngrouping = false
    update.supportsDTMF = false
    provider.reportNewIncomingCall(with: uuid, update: update) { error in
      completion(error)
    }
  }

  func reportOutgoing(uuid: UUID, handle: String, hasVideo: Bool) {
    let action = CXStartCallAction(call: uuid, handle: CXHandle(type: .generic, value: handle))
    action.isVideo = hasVideo
    callController.request(CXTransaction(action: action)) { _ in }
  }

  func reportOutgoingConnected(uuid: UUID) {
    provider.reportOutgoingCall(with: uuid, connectedAt: nil)
  }

  func answer(uuid: UUID) {
    callController.request(CXTransaction(action: CXAnswerCallAction(call: uuid))) { _ in }
  }

  func end(uuid: UUID) {
    callController.request(CXTransaction(action: CXEndCallAction(call: uuid))) { _ in }
  }

  func reportEnded(uuid: UUID, reason: String) {
    let mapped: CXCallEndedReason
    switch reason {
    case "answered_elsewhere": mapped = .answeredElsewhere
    case "declined": mapped = .declinedElsewhere
    case "failed": mapped = .failed
    case "timeout", "missed", "cancelled", "busy": mapped = .unanswered
    default: mapped = .remoteEnded
    }
    provider.reportCall(with: uuid, endedAt: nil, reason: mapped)
    lock.lock()
    payloads.removeValue(forKey: uuid)
    lock.unlock()
  }

  func setMuted(uuid: UUID, muted: Bool) {
    callController.request(CXTransaction(action: CXSetMutedCallAction(call: uuid, muted: muted))) { _ in }
  }

  // MARK: - CXProviderDelegate

  func providerDidReset(_ provider: CXProvider) {
    lock.lock()
    let ids = Array(payloads.keys)
    payloads.removeAll()
    lock.unlock()
    for id in ids { bufferAction("end", uuid: id) }
  }

  func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
    configureAudioSession(video: action.isVideo)
    provider.reportOutgoingCall(with: action.callUUID, startedConnectingAt: nil)
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
    lock.lock()
    let data = payloads[action.callUUID]
    lock.unlock()
    configureAudioSession(video: (data?["media"] as? String) == "video")
    bufferAction("answer", uuid: action.callUUID)
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    bufferAction("end", uuid: action.callUUID)
    lock.lock()
    payloads.removeValue(forKey: action.callUUID)
    lock.unlock()
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
    bufferAction(action.isMuted ? "mute" : "unmute", uuid: action.callUUID)
    action.fulfill()
  }

  func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
    emit("onAudioSession", ["active": true], buffer: false)
  }

  func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
    emit("onAudioSession", ["active": false], buffer: false)
  }

  private func configureAudioSession(video: Bool) {
    let session = AVAudioSession.sharedInstance()
    try? session.setCategory(
      .playAndRecord,
      mode: video ? .videoChat : .voiceChat,
      options: [.allowBluetooth, .allowBluetoothA2DP]
    )
  }

  // MARK: - Event plumbing

  private func bufferAction(_ action: String, uuid: UUID) {
    var body: [String: Any] = ["action": action, "callId": uuid.uuidString.lowercased()]
    lock.lock()
    let data = payloads[uuid]
    lock.unlock()
    if let data {
      if let v = data["caller_id"] as? String { body["callerId"] = v }
      if let v = data["caller_name"] as? String { body["callerName"] = v }
      if let v = data["media"] as? String { body["media"] = v }
      if let v = data["expires_at"] as? String { body["expiresAt"] = v }
    }
    emit("onCallAction", body, buffer: true)
  }

  private func emit(_ name: String, _ body: [String: Any], buffer: Bool) {
    let send = { [weak self] in
      guard let self else { return }
      if let emitter = self.emitter {
        emitter(name, body)
      } else if buffer {
        self.lock.lock()
        self.pending.append(body)
        self.lock.unlock()
      }
    }
    if Thread.isMainThread { send() } else { DispatchQueue.main.async(execute: send) }
  }

  func consumePending() -> [[String: Any]] {
    lock.lock()
    defer { lock.unlock() }
    let out = pending
    pending.removeAll()
    return out
  }
}
