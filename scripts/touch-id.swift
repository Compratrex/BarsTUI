import Foundation
import LocalAuthentication
import Darwin

// This helper receives no BARS credentials or session data.
func finish(_ status: String) -> Never {
    let result = "{\"version\":1,\"status\":\"\(status)\"}\n"
    FileHandle.standardOutput.write(Data(result.utf8))
    exit(EXIT_SUCCESS)
}

func failureStatus(_ error: Error?) -> String {
    guard let error = error as? LAError else { return "failed" }
    switch error.code {
    case .userCancel, .userFallback, .systemCancel, .appCancel: return "cancelled"
    case .biometryNotAvailable, .biometryNotEnrolled, .passcodeNotSet: return "unavailable"
    case .biometryLockout: return "locked-out"
    default: return "failed"
    }
}

let mode = CommandLine.arguments.dropFirst().first
guard mode == "--check" || mode == "--authenticate" else { finish("failed") }
let context = LAContext()
context.localizedCancelTitle = "Отмена"
context.localizedFallbackTitle = ""
// Require a new fingerprint, even if the Mac was just unlocked with Touch ID.
context.touchIDAuthenticationAllowableReuseDuration = 0
var error: NSError?
guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
    finish(failureStatus(error))
}
guard context.biometryType == .touchID else { finish("unavailable") }
if mode == "--check" { finish("available") }

signal(SIGTERM, SIG_IGN)
let termination = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
termination.setEventHandler {
    context.invalidate()
    finish("cancelled")
}
termination.resume()
context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics,
                      localizedReason: "открыть сохранённую сессию БАРСа") { success, error in
    finish(success ? "authenticated" : failureStatus(error))
}
dispatchMain()
