import AVFoundation
import Foundation

/// Plays a reading: a list of sentences spoken in order. Sentences are synthesized a couple
/// ahead, played through the shared engine with a time-pitch unit (speed changes are instant and
/// keep the pitch), and can be paused, resumed, or restarted at any sentence.
actor Reader {
    enum State: String { case idle, playing, paused }

    private let hub: VoiceHub
    private let host = AudioHost.shared

    private var gen = 0                       // bumps on every stop/restart; stale callbacks compare it
    private var readingId = ""
    private var sentences: [String] = []
    private var cache: [Int: Task<[Float], Error>] = [:]
    private var playerStale = false           // the engine restarted under a paused sentence
    private(set) var index = 0
    private(set) var state: State = .idle
    private(set) var voice: String
    private(set) var rate: Float = 1.0

    init(hub: VoiceHub, voice: String) {
        self.hub = hub
        self.voice = voice
    }

    var isPlaying: Bool { state == .playing }

    // MARK: commands

    /// Starts a new reading at sentence `start`, replacing whatever was playing.
    func speak(id: String, sentences: [String], start: Int) {
        halt(keepCache: false)
        readingId = id
        self.sentences = sentences
        state = .playing
        let g = gen
        let first = max(0, min(start, sentences.count))
        Task(priority: .userInitiated) { await self.play(at: first, gen: g) }
    }

    /// Restarts the current reading at sentence `i` (audio already made is reused).
    func seek(_ i: Int) {
        guard !sentences.isEmpty else { return }
        halt(keepCache: true)
        state = .playing
        let g = gen
        let target = max(0, min(i, sentences.count))
        Task(priority: .userInitiated) { await self.play(at: target, gen: g) }
    }

    func pause(reason: String = "command") {
        guard state == .playing else { return }
        state = .paused
        host.player.pause()
        Events.emit("paused", ["id": readingId, "i": index, "reason": reason])
    }

    func resume(reason: String = "command") {
        guard state == .paused else { return }
        if playerStale {
            playerStale = false
            seek(index)
        } else {
            state = .playing
            if host.engine.isRunning { host.player.play() }
        }
        Events.emit("resumed", ["id": readingId, "i": index, "reason": reason])
    }

    func stop() {
        let wasActive = state != .idle
        halt(keepCache: false)
        state = .idle
        if wasActive { Events.emit("stopped", ["id": readingId, "i": index]) }
    }

    func setRate(_ value: Float) {
        rate = max(0.5, min(value, 2.5))
        host.pitch.rate = rate
    }

    func setVoice(_ name: String) async throws {
        guard name != voice else { return }
        try await hub.prepare(voice: name)
        voice = name
        // Sentences not yet played are made again in the new voice.
        for (k, t) in cache where k > index { t.cancel(); cache[k] = nil }
    }

    func status() -> [String: Any] {
        ["state": state.rawValue, "id": readingId, "i": index, "count": sentences.count,
         "voice": voice, "rate": rate]
    }

    /// The engine restarted (output device changed, or echo cancellation switched): the
    /// player lost its queue, so pick the sentence up again from its start.
    func engineRestarted() {
        switch state {
        case .playing: seek(index)
        case .paused: playerStale = true
        case .idle: break
        }
    }

    // MARK: playback

    private func halt(keepCache: Bool) {
        gen += 1
        playerStale = false
        host.player.stop()
        if !keepCache {
            for t in cache.values { t.cancel() }
            cache = [:]
        }
    }

    private func audio(for i: Int) -> Task<[Float], Error> {
        if let t = cache[i] { return t }
        let text = sentences[i], voice = self.voice, hub = self.hub
        let t = Task(priority: .userInitiated) { try await hub.synthesize(text, voice: voice) }
        cache[i] = t
        return t
    }

    private func play(at i: Int, gen g: Int) async {
        guard g == gen else { return }
        guard i < sentences.count else {
            state = .idle
            Events.emit("done", ["id": readingId])
            return
        }
        index = i
        let current = audio(for: i)
        for j in (i + 1)..<min(i + 3, sentences.count) { _ = audio(for: j) }   // stay two ahead

        let samples: [Float]
        do { samples = try await current.value } catch {
            guard g == gen else { return }
            Events.emit("error", ["msg": "could not voice sentence \(i): \(error.localizedDescription)", "i": i])
            await play(at: i + 1, gen: g)
            return
        }
        guard g == gen else { return }
        for k in cache.keys where k < i { cache[k] = nil }

        do { try host.start() } catch {
            Events.emit("error", ["msg": "audio output failed: \(error.localizedDescription)"])
            stop()
            return
        }
        host.pitch.rate = rate
        let buffer = makeBuffer(samples)
        let id = readingId
        host.player.scheduleBuffer(buffer, at: nil, options: [], completionCallbackType: .dataPlayedBack) { _ in
            Task { await self.finished(gen: g, index: i) }
        }
        if state == .playing { host.player.play() }
        Events.emit("sentence", ["id": id, "i": i])
    }

    private func finished(gen g: Int, index i: Int) async {
        guard g == gen else { return }
        await play(at: i + 1, gen: g)
    }

    /// Samples into a buffer, with 4 ms fades against clicks and a short breath after the sentence.
    private func makeBuffer(_ samples: [Float]) -> AVAudioPCMBuffer {
        let format = host.speechFormat
        let tail = Int(format.sampleRate * 0.12)
        let total = samples.count + tail
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(total))!
        buffer.frameLength = AVAudioFrameCount(total)
        let out = buffer.floatChannelData![0]
        samples.withUnsafeBufferPointer { src in out.update(from: src.baseAddress!, count: samples.count) }
        for k in samples.count..<total { out[k] = 0 }
        let fade = min(Int(format.sampleRate * 0.004), samples.count / 2)
        for k in 0..<fade {
            let g = Float(k) / Float(max(fade, 1))
            out[k] *= g
            out[samples.count - 1 - k] *= g
        }
        return buffer
    }
}
