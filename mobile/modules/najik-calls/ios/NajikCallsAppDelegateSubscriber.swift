import ExpoModulesCore

/// Registers PushKit at launch. A VoIP push that cold-starts the app is only delivered if the
/// registry exists before `didFinishLaunching` returns, and every VoIP push must be reported to
/// CallKit before the PushKit completion runs (iOS 13+ terminates apps that don't).
public class NajikCallsAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    CallCenter.shared.registerVoip()
    return true
  }
}
