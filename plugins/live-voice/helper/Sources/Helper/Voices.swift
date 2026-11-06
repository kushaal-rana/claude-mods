import Foundation
import FluidAudio

/// Text to 24 kHz mono samples. Kokoro voices are named like `af_heart`; Phonon voices like
/// `en_us_Hadley`. Only the engine in use stays loaded, to keep memory low on an 8 GB Mac.
///
/// Every load and synthesis runs strictly one at a time: Core ML aborts the process when
/// predictions overlap on the same model, and the reader asks for sentences ahead of time.
actor VoiceHub {
    private let modelsDir: URL
    private let cpuOnly: Bool
    private var kokoro: KokoroAneManager?
    private var phonon: PocketTtsSmallManager?
    private var tail: Task<Void, Never>?

    /// `cpuOnly` keeps every model off the Neural Engine and GPU: slower, but immune to
    /// accelerator failures in restricted launch contexts.
    init(modelsDir: URL, cpuOnly: Bool) {
        self.modelsDir = modelsDir
        self.cpuOnly = cpuOnly
    }

    private static let allCPU = KokoroAneComputeUnits(
        albert: .cpuOnly, postAlbert: .cpuOnly, alignment: .cpuOnly, prosody: .cpuOnly,
        noise: .cpuOnly, vocoder: .cpuOnly, tail: .cpuOnly)

    static func isPhonon(_ voice: String) -> Bool { voice.hasPrefix("en_us_") || voice.hasPrefix("en_gb_") }

    /// Loads (downloading on first use) the engine a voice needs, and drops the other one.
    func prepare(voice: String) async throws {
        try await serialized { try await self.prepareNow(voice: voice) }
    }

    func synthesize(_ text: String, voice: String) async throws -> [Float] {
        try await serialized { try await self.synthesizeNow(text, voice: voice) }
    }

    /// Runs `op` after every earlier job has finished. A caller that is cancelled while
    /// waiting never starts its job.
    private func serialized<T: Sendable>(_ op: @escaping @Sendable () async throws -> T) async throws -> T {
        let previous = tail
        let job = Task(priority: .userInitiated) { () async throws -> T in
            await previous?.value
            try Task.checkCancellation()
            return try await op()
        }
        tail = Task { _ = try? await job.value }
        return try await withTaskCancellationHandler {
            try await job.value
        } onCancel: {
            job.cancel()
        }
    }

    private func prepareNow(voice: String) async throws {
        if Self.isPhonon(voice) {
            kokoro = nil
            if phonon == nil {
                Events.emit("loading", ["engine": "phonon", "compute": cpuOnly ? "cpu" : "auto"])
                let manager = cpuOnly
                    ? PocketTtsSmallManager(model: .phonon31m, computeUnits: .cpuOnly)
                    : PocketTtsSmallManager(model: .phonon31m)
                try await manager.initialize(directory: modelsDir.appendingPathComponent("phonon"))
                phonon = manager
                Events.log("phonon loaded")
            }
        } else {
            phonon = nil
            if kokoro == nil {
                Events.emit("loading", ["engine": "kokoro", "compute": cpuOnly ? "cpu" : "auto"])
                let manager = KokoroAneManager(variant: .english, defaultVoice: voice,
                                               directory: modelsDir.appendingPathComponent("kokoro"),
                                               computeUnits: cpuOnly ? Self.allCPU : .default)
                try await manager.initialize(preloadVoices: [voice])
                kokoro = manager
                Events.log("kokoro loaded")
            }
        }
    }

    private func synthesizeNow(_ text: String, voice: String) async throws -> [Float] {
        try await prepareNow(voice: voice)
        if Self.isPhonon(voice), let phonon {
            return try await phonon.synthesizeSamples(text: text, voice: voice)
        }
        guard let kokoro else { throw NSError(domain: "VoiceHub", code: 1) }
        return try await kokoro.synthesizeDetailed(text: text, voice: voice, speed: 1.0).samples
    }
}
