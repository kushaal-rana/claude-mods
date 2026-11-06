// swift-tools-version: 6.2
// Claude Voice helper: the local audio side of the Live Voice mod.
// It speaks (FluidAudio Phonon and Kokoro voices, on the CPU) and listens (mic, Apple echo cancellation, Silero VAD, Apple speech recognition).
import PackageDescription

let package = Package(
    name: "ClaudeVoiceHelper",
    platforms: [.macOS("26.0")],
    dependencies: [
        .package(url: "https://github.com/FluidInference/FluidAudio.git", exact: "0.18.2", traits: ["TTS"]),
    ],
    targets: [
        .executableTarget(
            name: "claude-voice-helper",
            dependencies: [.product(name: "FluidAudio", package: "FluidAudio")],
            path: "Sources/Helper",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
    ]
)
