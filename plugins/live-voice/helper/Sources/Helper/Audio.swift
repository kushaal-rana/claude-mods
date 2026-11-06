import AVFoundation
import Foundation

/// The one AVAudioEngine the helper uses for both speaking and listening. Apple's voice
/// processing (echo cancellation) only removes audio that plays through the same engine,
/// so the player and the microphone have to share it.
final class AudioHost: @unchecked Sendable {
    static let shared = AudioHost()

    private(set) var engine = AVAudioEngine()
    let player = AVAudioPlayerNode()
    let pitch = AVAudioUnitTimePitch()
    let speechFormat = AVAudioFormat(standardFormatWithSampleRate: 24_000, channels: 1)!

    private let lock = NSLock()
    private var wired = false
    private(set) var voiceProcessing = false
    private(set) var micOn = false

    /// Connects player -> time-pitch -> output once, and starts the engine if it is stopped.
    func start() throws {
        lock.lock(); defer { lock.unlock() }
        try startLocked()
    }

    private func startLocked() throws {
        if !wired {
            engine.attach(player)
            engine.attach(pitch)
            engine.connect(player, to: pitch, format: speechFormat)
            engine.connect(pitch, to: engine.mainMixerNode, format: speechFormat)
            wired = true
        }
        if !engine.isRunning {
            engine.prepare()
            try engine.start()
        }
    }

    /// Starts listening: optional echo cancellation, and `tap` receiving every mic buffer.
    /// Voice processing only initializes reliably on a fresh engine where it is switched on
    /// before anything is connected, so the engine is rebuilt. On failure the engine is left
    /// fresh and working for playback. The caller restarts whatever was playing.
    func enableMic(voiceProcessing vp: Bool, tap: @escaping AVAudioNodeTapBlock) throws {
        lock.lock(); defer { lock.unlock() }
        rebuildLocked()
        do {
            // Order matters (tested on this M1): the mixer-to-output connection must exist before
            // voice processing is switched on, or the output unit fails to initialize (-10875).
            _ = engine.outputNode
            _ = engine.mainMixerNode
            let input = engine.inputNode
            if vp {
                try input.setVoiceProcessingEnabled(true)
                // Keep other apps' audio as loud as the voice processor allows.
                input.voiceProcessingOtherAudioDuckingConfiguration =
                    AVAudioVoiceProcessingOtherAudioDuckingConfiguration(enableAdvancedDucking: false, duckingLevel: .min)
            }
            voiceProcessing = vp
            if !wired {
                engine.attach(player)
                engine.attach(pitch)
                engine.connect(player, to: pitch, format: speechFormat)
                engine.connect(pitch, to: engine.mainMixerNode, format: speechFormat)
                wired = true
            }
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else {
                throw NSError(domain: "AudioHost", code: 1,
                              userInfo: [NSLocalizedDescriptionKey: "no microphone input is available"])
            }
            input.installTap(onBus: 0, bufferSize: 2048, format: format, block: tap)
            micOn = true
            engine.prepare()
            try engine.start()
            Events.log("mic on: voiceProcessing=\(vp) input=\(format)")
        } catch {
            Events.log("mic setup failed (voiceProcessing=\(vp)): \(error.localizedDescription)")
            rebuildLocked()
            throw error
        }
    }

    /// Stops listening and rebuilds the engine without an input, so the mic is fully released
    /// (the orange indicator goes away). The caller restarts whatever was playing.
    func disableMic() {
        lock.lock(); defer { lock.unlock() }
        guard micOn || voiceProcessing else { return }
        rebuildLocked()
    }

    /// A fresh engine with nothing attached; the player chain is wired again on next use.
    private func rebuildLocked() {
        if engine.isRunning { engine.stop() }
        if micOn { engine.inputNode.removeTap(onBus: 0) }
        if wired {
            engine.detach(pitch)
            engine.detach(player)
            wired = false
        }
        engine = AVAudioEngine()
        voiceProcessing = false
        micOn = false
    }
}
