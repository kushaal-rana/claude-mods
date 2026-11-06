import AVFoundation
import CoreMedia
import FluidAudio
import Foundation
import Speech

/// Converts mic buffers (any rate, any channel count) to 16 kHz mono Float32, taking channel 0
/// (the voice processor reports odd channel counts).
final class MicConverter: @unchecked Sendable {
    static let vadFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16_000, channels: 1, interleaved: false)!
    private var converter: AVAudioConverter?
    private var sourceRate: Double = 0
    private var monoFormat: AVAudioFormat?

    func convert(_ buffer: AVAudioPCMBuffer) -> [Float] {
        guard let channels = buffer.floatChannelData, buffer.frameLength > 0 else { return [] }
        let rate = buffer.format.sampleRate
        if converter == nil || rate != sourceRate {
            sourceRate = rate
            monoFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: rate, channels: 1, interleaved: false)
            converter = AVAudioConverter(from: monoFormat!, to: Self.vadFormat)
        }
        guard let converter, let monoFormat,
              let mono = AVAudioPCMBuffer(pcmFormat: monoFormat, frameCapacity: buffer.frameLength) else { return [] }
        mono.frameLength = buffer.frameLength
        mono.floatChannelData![0].update(from: channels[0], count: Int(buffer.frameLength))
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * 16_000 / rate + 64)
        guard let out = AVAudioPCMBuffer(pcmFormat: Self.vadFormat, frameCapacity: capacity) else { return [] }
        var fed = false
        var error: NSError?
        converter.convert(to: out, error: &error) { _, status in
            if fed { status.pointee = .noDataNow; return nil }
            fed = true
            status.pointee = .haveData
            return mono
        }
        guard error == nil, out.frameLength > 0 else { return [] }
        return Array(UnsafeBufferPointer(start: out.floatChannelData![0], count: Int(out.frameLength)))
    }
}

/// One spoken turn being transcribed by Apple's on-device recognizer, with live partials.
final class Utterance: @unchecked Sendable {
    private let transcriber: SpeechTranscriber
    private let analyzer: SpeechAnalyzer
    private let continuation: AsyncStream<AnalyzerInput>.Continuation
    private let analyzeTask: Task<CMTime?, Error>
    private let resultsTask: Task<String, Error>
    private let format: AVAudioFormat
    private let converter: AVAudioConverter?
    private let lock = NSLock()
    private var _latest = ""
    let confidence = ConfidenceTally()

    var latest: String { lock.lock(); defer { lock.unlock() }; return _latest }
    var wordCount: Int { latest.split(whereSeparator: { $0 == " " }).count }

    init(format: AVAudioFormat, onPartial: @escaping @Sendable (String) -> Void) {
        let preset = SpeechTranscriber.Preset.progressiveTranscription
        let transcriber = SpeechTranscriber(
            locale: Locale(identifier: "en-US"),
            transcriptionOptions: preset.transcriptionOptions,
            reportingOptions: preset.reportingOptions,
            attributeOptions: preset.attributeOptions.union([.transcriptionConfidence]))
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        let (stream, continuation) = AsyncStream.makeStream(of: AnalyzerInput.self)
        self.transcriber = transcriber
        self.analyzer = analyzer
        self.continuation = continuation
        self.format = format
        converter = format == MicConverter.vadFormat ? nil : AVAudioConverter(from: MicConverter.vadFormat, to: format)
        analyzeTask = Task(priority: .userInitiated) { try await analyzer.analyzeSequence(stream) }
        let box = LatestBox()
        let confidence = self.confidence
        resultsTask = Task(priority: .userInitiated) {
            var finals = ""
            for try await result in transcriber.results {
                let text = String(result.text.characters)
                if result.isFinal {
                    finals += text
                    for run in result.text.runs {
                        if let c = run.transcriptionConfidence {
                            confidence.add(Double(c), weight: Double(result.text[run.range].characters.count))
                        }
                    }
                }
                let now = result.isFinal ? finals : finals + text
                box.set(now)
                onPartial(now.trimmingCharacters(in: .whitespaces))
            }
            return finals
        }
        box.onSet = { [weak self] text in
            guard let self else { return }
            self.lock.lock(); self._latest = text; self.lock.unlock()
        }
    }

    /// Feeds 16 kHz mono samples.
    func feed(_ samples: [Float]) {
        guard !samples.isEmpty,
              let buffer = AVAudioPCMBuffer(pcmFormat: MicConverter.vadFormat, frameCapacity: AVAudioFrameCount(samples.count))
        else { return }
        buffer.frameLength = AVAudioFrameCount(samples.count)
        samples.withUnsafeBufferPointer { buffer.floatChannelData![0].update(from: $0.baseAddress!, count: samples.count) }
        guard let converter else { continuation.yield(AnalyzerInput(buffer: buffer)); return }
        guard let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count) + 64) else { return }
        var fed = false
        var error: NSError?
        converter.convert(to: out, error: &error) { _, status in
            if fed { status.pointee = .noDataNow; return nil }
            fed = true
            status.pointee = .haveData
            return buffer
        }
        if error == nil, out.frameLength > 0 { continuation.yield(AnalyzerInput(buffer: out)) }
    }

    /// Ends the audio and returns the final transcript.
    func finish() async -> String {
        continuation.finish()
        do {
            if let last = try await analyzeTask.value {
                try await analyzer.finalizeAndFinish(through: last)
            } else {
                await analyzer.cancelAndFinishNow()
            }
        } catch {
            await analyzer.cancelAndFinishNow()
        }
        let finals = (try? await resultsTask.value) ?? ""
        let text = finals.trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? latest.trimmingCharacters(in: .whitespacesAndNewlines) : text
    }

    func cancel() async {
        continuation.finish()
        await analyzer.cancelAndFinishNow()
    }
}

/// Character-weighted mean of the recognizer's per-word confidence; -1 when none was given.
final class ConfidenceTally: @unchecked Sendable {
    private let lock = NSLock()
    private var sum = 0.0
    private var weight = 0.0
    func add(_ value: Double, weight w: Double) { lock.lock(); sum += value * w; weight += w; lock.unlock() }
    var mean: Double { lock.lock(); defer { lock.unlock() }; return weight > 0 ? sum / weight : -1 }
}

private final class LatestBox: @unchecked Sendable {
    var onSet: ((String) -> Void)?
    func set(_ text: String) { onSet?(text) }
}

/// Listens to the mic: Silero voice detection every 256 ms, Apple's recognizer for the words.
/// Speech while the reader is playing pauses it at once (barge-in); a short acknowledgement,
/// a cough or no words resumes it from the exact spot; anything else goes to the mod.
actor Listener {
    private let reader: Reader
    private let host = AudioHost.shared
    private var vad: VadManager?
    private var vadState = VadStreamState.initial()
    private var analyzerFormat: AVAudioFormat?
    private var consumer: Task<Void, Never>?
    private var continuation: AsyncStream<[Float]>.Continuation?
    private var pending: [Float] = []
    private var ring: [Float] = []
    private var utterance: Utterance?
    private var started = Date()
    private var silenceMs = 0
    private var bargedIn = false
    private var lastPartial = Date.distantPast
    private var speechEnergy = 0.0
    private var speechSamples = 0
    private(set) var isOn = false
    private(set) var echoCancellation = false
    private let alive = AliveFlag()

    private static let chunk = VadManager.chunkSize          // 4096 samples = 256 ms at 16 kHz
    private static let chunkMs = 256
    private static let preRoll = 12_000                        // 0.75 s of audio before speech starts

    init(reader: Reader) { self.reader = reader }

    func start(echoCancellation wantAEC: Bool) async throws {
        guard !isOn else { return }
        try await Self.ensureMicPermission()
        if vad == nil {
            Events.emit("loading", ["engine": "listener"])
            vad = try await VadManager(config: VadConfig(defaultThreshold: 0.5, computeUnits: .cpuOnly))
        }
        if analyzerFormat == nil {
            let probe = SpeechTranscriber(locale: Locale(identifier: "en-US"), preset: .progressiveTranscription)
            if let request = try await AssetInventory.assetInstallationRequest(supporting: [probe]) {
                Events.emit("loading", ["engine": "speech"])
                try await request.downloadAndInstall()
            }
            analyzerFormat = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [probe]) ?? MicConverter.vadFormat
            Events.log("speech format: \(analyzerFormat!)")
        }
        do {
            try await open(aec: wantAEC)
        } catch where wantAEC {
            // Echo cancellation couldn't start on this device: listen without it.
            try await open(aec: false)
            Events.emit("mic_warning", ["msg": "Echo cancellation isn't available right now, so headphones will work best."])
            return
        }
        // Some devices deliver no audio with voice processing on: fall back to the plain mic.
        if wantAEC {
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            if !alive.seen {
                Events.log("no mic audio with echo cancellation; retrying without it")
                await close(releaseMic: false)
                try await open(aec: false)
                Events.emit("mic_warning", ["msg": "Echo cancellation isn't available on this audio device. Headphones will work best."])
            }
        }
    }

    private func open(aec: Bool) async throws {
        let (stream, continuation) = AsyncStream.makeStream(of: [Float].self, bufferingPolicy: .bufferingNewest(128))
        self.continuation = continuation
        let converter = MicConverter()
        let alive = self.alive
        alive.seen = false
        try host.enableMic(voiceProcessing: aec) { buffer, _ in
            let samples = converter.convert(buffer)
            if !samples.isEmpty {
                alive.seen = true
                continuation.yield(samples)
            }
        }
        await reader.engineRestarted()
        echoCancellation = aec
        isOn = true
        pending = []
        ring = []
        vadState = VadStreamState.initial()
        consumer = Task(priority: .userInitiated) { [weak self] in
            for await samples in stream { await self?.process(samples) }
        }
        Events.emit("mic", ["on": true, "aec": aec])
    }

    func stop() async {
        await close(releaseMic: true)
        Events.emit("mic", ["on": false])
    }

    private func close(releaseMic: Bool) async {
        guard isOn else { return }
        isOn = false
        continuation?.finish()
        continuation = nil
        consumer?.cancel()
        consumer = nil
        if let u = utterance { utterance = nil; await u.cancel() }
        if bargedIn { bargedIn = false; await reader.resume(reason: "mic-off") }
        if releaseMic {
            host.disableMic()
            await reader.engineRestarted()
        }
    }

    private static func ensureMicPermission() async throws {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return
        case .notDetermined:
            Events.emit("mic_permission", ["state": "asking"])
            if await AVCaptureDevice.requestAccess(for: .audio) { return }
        default: break
        }
        throw NSError(domain: "Listener", code: 2, userInfo: [NSLocalizedDescriptionKey:
            "Microphone access is off. Turn it on for Claude in System Settings > Privacy & Security > Microphone."])
    }

    // MARK: audio processing

    private func process(_ samples: [Float]) async {
        ring.append(contentsOf: samples)
        if ring.count > Self.preRoll { ring.removeFirst(ring.count - Self.preRoll) }
        utterance?.feed(samples)
        pending.append(contentsOf: samples)
        while pending.count >= Self.chunk {
            let chunk = Array(pending.prefix(Self.chunk))
            pending.removeFirst(Self.chunk)
            await analyze(chunk)
        }
    }

    private func analyze(_ chunk: [Float]) async {
        guard let vad else { return }
        let probability: Float
        do {
            let result = try await vad.processStreamingChunk(chunk, state: vadState)
            vadState = result.state
            probability = result.probability
        } catch {
            Events.log("vad error: \(error)")
            return
        }
        let playing = await reader.isPlaying
        if utterance == nil {
            // Stricter while the voice is playing, in case a little of it leaks back in.
            let threshold: Float = playing ? (echoCancellation ? 0.7 : 0.9) : 0.5
            if probability >= threshold { await begin(barge: playing) }
            return
        }
        if probability >= 0.5 {
            speechEnergy += chunk.reduce(0.0) { $0 + Double($1 * $1) }
            speechSamples += chunk.count
        }
        silenceMs = probability < 0.35 ? silenceMs + Self.chunkMs : 0
        let words = utterance?.wordCount ?? 0
        let elapsed = Date().timeIntervalSince(started)
        let endAfter = words == 0 ? 1_500 : (words <= 3 ? 600 : 900)
        if silenceMs >= endAfter || elapsed > 30 {
            await end()
        }
    }

    private func begin(barge: Bool) async {
        bargedIn = barge
        if barge { await reader.pause(reason: "barge") }
        started = Date()
        silenceMs = 0
        speechEnergy = 0
        speechSamples = 0
        guard let format = analyzerFormat else { return }
        let u = Utterance(format: format) { [weak self] text in
            Task { await self?.partial(text) }
        }
        utterance = u
        u.feed(ring)
        Events.emit("speech_start", ["barge": barge])
    }

    private func partial(_ text: String) {
        guard utterance != nil, !text.isEmpty, Date().timeIntervalSince(lastPartial) > 0.15 else { return }
        lastPartial = Date()
        Events.emit("partial", ["text": text])
    }

    private func end() async {
        guard let u = utterance else { return }
        utterance = nil
        let barged = bargedIn
        bargedIn = false
        let text = await u.finish()
        let words = Self.words(text)
        let level = speechSamples > 0 ? 10 * log10(max(speechEnergy / Double(speechSamples), 1e-12)) : -120
        let confidence = u.confidence.mean
        let measures: [String: Any] = ["level": (level * 10).rounded() / 10, "confidence": (confidence * 100).rounded() / 100]
        if words.isEmpty || (barged && Self.isBackchannel(words)) || Self.isFiller(words) {
            Events.emit("ignored", ["text": text, "barge": barged].merging(measures) { a, _ in a })
            if barged { await reader.resume(reason: "backchannel") }
            return
        }
        Events.emit("utterance", ["text": text, "barge": barged].merging(measures) { a, _ in a })
    }

    private static func words(_ text: String) -> [String] {
        text.lowercased()
            .replacingOccurrences(of: "-", with: " ")
            .components(separatedBy: CharacterSet.letters.union(.decimalDigits).union(CharacterSet(charactersIn: "'")).inverted)
            .filter { !$0.isEmpty }
    }

    private static let backchannels: Set<String> = [
        "mm", "mmm", "mhm", "mmhmm", "hmm", "uh", "huh", "uhhuh", "um", "ah", "oh", "yeah", "yep", "yes", "yup",
        "okay", "ok", "right", "sure", "cool", "nice", "great", "good", "alright", "got", "it", "i", "see", "all",
        "wow", "interesting", "true", "exactly",
    ]
    private static let fillers: Set<String> = ["mm", "mmm", "mhm", "hmm", "uh", "um", "ah", "oh", "huh"]

    /// "mm-hmm", "yeah", "okay okay", "got it", "I see": keep reading.
    private static func isBackchannel(_ words: [String]) -> Bool {
        words.count <= 3 && words.allSatisfy { backchannels.contains($0) }
    }

    private static func isFiller(_ words: [String]) -> Bool {
        words.allSatisfy { fillers.contains($0) }
    }
}

private final class AliveFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var _seen = false
    var seen: Bool {
        get { lock.lock(); defer { lock.unlock() }; return _seen }
        set { lock.lock(); _seen = newValue; lock.unlock() }
    }
}
