import AVFoundation
import Foundation
import NaturalLanguage

// claude-voice-helper: the audio side of the Live Voice mod.
//   --socket <path>   serve commands (POST /cmd, JSON) on a private Unix socket; events go to stdout
//   --say "<text>"    speak once and exit (a quick test from the terminal)
//   --voice <name>    af_heart, am_michael, bf_emma (Kokoro) or en_us_Hadley... (Phonon)

let args = CommandLine.arguments
func arg(_ name: String) -> String? {
    guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
    return args[i + 1]
}

// Record Core ML's (or anyone's) uncaught Objective-C exception before the process aborts.
NSSetUncaughtExceptionHandler { exception in
    let stack = exception.callStackSymbols.prefix(14).joined(separator: "\n    ")
    Events.log("UNCAUGHT \(exception.name.rawValue): \(exception.reason ?? "(no reason)")\n    \(stack)")
}

// A helper started by a background worker can inherit background priority, which may lose it
// the Neural Engine. Step up to normal priority before touching Core ML.
let backgroundBefore = getpriority(PRIO_DARWIN_PROCESS, 0)
let backgroundCleared = setpriority(PRIO_DARWIN_PROCESS, 0, 0)
pthread_set_qos_class_self_np(QOS_CLASS_USER_INITIATED, 0)
Events.log("priority: darwin-bg before=\(backgroundBefore) cleared=\(backgroundCleared == 0 ? "yes" : "no (errno \(errno))")")

do {
    var limit = rlimit()
    getrlimit(RLIMIT_NOFILE, &limit)
    let stdinOpen = fcntl(0, F_GETFD) != -1
    let env = ProcessInfo.processInfo.environment
    Events.log("start ppid=\(getppid()) cwd=\(FileManager.default.currentDirectoryPath) nofile=\(limit.rlim_cur) "
        + "stdin=\(stdinOpen ? "open" : "closed") qos=\(qos_class_self().rawValue) env=\(env.count) "
        + "bundleid=\(env["__CFBundleIdentifier"] ?? "-") args=\(args.dropFirst().joined(separator: " "))")
}

let base = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".claude-voice")
let cpuOnly = arg("--compute") != "auto"   // CPU by default: faster to start on this M1, and no accelerator crashes
let hub = VoiceHub(modelsDir: base.appendingPathComponent("models"), cpuOnly: cpuOnly)
let startVoice = arg("--voice") ?? "en_us_Everly"
let reader = Reader(hub: hub, voice: startVoice)
let listener = Listener(reader: reader)
if let r = arg("--rate").flatMap(Float.init) { Task { await reader.setRate(r) } }

// Leave when the session that started us goes away.
let parentPID = getppid()
let watchdog = DispatchSource.makeTimerSource(queue: .global())
watchdog.schedule(deadline: .now() + 2, repeating: 2)
watchdog.setEventHandler { if getppid() != parentPID { exit(0) } }
watchdog.resume()

// Headphones in or out stop the engine; resume from the current sentence.
NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: nil, queue: nil) { _ in
    Events.log("audio configuration changed")
    Task { await reader.engineRestarted() }
}

func sentences(of text: String) -> [String] {
    let tokenizer = NLTokenizer(unit: .sentence)
    tokenizer.string = text
    return tokenizer.tokens(for: text.startIndex..<text.endIndex)
        .map { text[$0].trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
}

func handle(_ body: Data) async -> Data {
    let cmd = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] ?? [:]
    var reply: [String: Any] = ["ok": true]
    switch cmd["op"] as? String ?? "" {
    case "speak":
        let list = (cmd["sentences"] as? [String]) ?? sentences(of: cmd["text"] as? String ?? "")
        await reader.speak(id: cmd["id"] as? String ?? "reading", sentences: list, start: cmd["start"] as? Int ?? 0)
    case "pause": await reader.pause()
    case "resume": await reader.resume()
    case "stop": await reader.stop()
    case "seek": await reader.seek(cmd["i"] as? Int ?? 0)
    case "rate": await reader.setRate(Float(cmd["value"] as? Double ?? 1.0))
    case "voice":
        do { try await reader.setVoice(cmd["name"] as? String ?? startVoice) } catch {
            reply = ["ok": false, "error": error.localizedDescription]
        }
    case "mic":
        if cmd["on"] as? Bool ?? true {
            // Answer at once; the result (or a permission problem) arrives as an event.
            let aec = cmd["aec"] as? Bool ?? true
            Task(priority: .userInitiated) {
                do { try await listener.start(echoCancellation: aec) } catch {
                    Events.emit("mic_error", ["msg": error.localizedDescription])
                }
            }
        } else {
            await listener.stop()
        }
    case "status", "ping": break
    case "quit":
        Task { try? await Task.sleep(nanoseconds: 100_000_000); exit(0) }
    default:
        reply = ["ok": false, "error": "unknown op"]
    }
    var status = await reader.status()
    status["mic"] = await listener.isOn
    reply.merge(status) { a, _ in a }
    return (try? JSONSerialization.data(withJSONObject: reply)) ?? Data("{}".utf8)
}

if let seconds = arg("--listen").flatMap(Double.init) {
    Task(priority: .userInitiated) {
        do { try await listener.start(echoCancellation: arg("--aec") != "off") } catch {
            Events.log("listen failed: \(error.localizedDescription)"); exit(1)
        }
        try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
        await listener.stop()
        exit(0)
    }
    dispatchMain()
}

if let text = arg("--say") {
    Task(priority: .userInitiated) {
        let t0 = Date()
        do { try await hub.prepare(voice: startVoice) } catch {
            Events.log("could not load voice: \(error)"); exit(1)
        }
        Events.log(String(format: "voice ready in %.1fs", Date().timeIntervalSince(t0)))
        let t1 = Date()
        await reader.speak(id: "cli", sentences: sentences(of: text), start: 0)
        var announced = false
        while await reader.state != .idle {
            if !announced, await reader.index >= 0 {
                announced = true
            }
            try? await Task.sleep(nanoseconds: 50_000_000)
        }
        Events.log(String(format: "finished speaking after %.1fs", Date().timeIntervalSince(t1)))
        exit(0)
    }
    dispatchMain()
}

guard let socketPath = arg("--socket") else {
    Events.log("usage: claude-voice-helper --socket <path> [--voice <name>] | --say \"text\"")
    exit(2)
}

let server: CommandServer
do { server = try CommandServer(path: socketPath, handler: handle) } catch {
    Events.emit("error", ["msg": "could not open control socket: \(error.localizedDescription)"])
    exit(1)
}
Task(priority: .userInitiated) {
    do {
        try await hub.prepare(voice: startVoice)
        _ = try? await hub.synthesize("Ready when you are.", voice: startVoice)   // warm the pipeline silently
        Events.emit("ready", ["voice": startVoice, "pid": Int(getpid())])
    } catch {
        Events.emit("error", ["msg": "voice failed to load: \(error.localizedDescription)"])
    }
}
withExtendedLifetime(server) { dispatchMain() }
