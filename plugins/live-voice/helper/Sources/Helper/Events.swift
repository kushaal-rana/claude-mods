import Foundation

/// One JSON object per line on stdout: the mod reads these as the helper's events.
/// Everything is also written to ~/.claude-voice/run/helper.log for diagnosis.
enum Events {
    private static let lock = NSLock()
    private static let fileLock = NSLock()
    private static let started = Date()
    private static let debug = ProcessInfo.processInfo.environment["CV_DEBUG"] != nil
    static let logURL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".claude-voice/run/helper.log")

    static func emit(_ event: String, _ fields: [String: Any] = [:]) {
        var obj = fields
        obj["ev"] = event
        guard let data = try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys]) else { return }
        lock.lock()
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0A]))
        lock.unlock()
        let text = String(decoding: data, as: UTF8.self)
        if debug { FileHandle.standardError.write(Data("[voice-helper] +\(elapsed()) \(text)\n".utf8)) }
        appendToFile("event \(text)")
    }

    /// Diagnostics go to stderr (never stdout, which carries events) and to the log file.
    static func log(_ message: String) {
        FileHandle.standardError.write(Data(("[voice-helper] " + message + "\n").utf8))
        appendToFile(message)
    }

    private static func elapsed() -> String { String(format: "%.2fs", Date().timeIntervalSince(started)) }

    private static func appendToFile(_ message: String) {
        fileLock.lock(); defer { fileLock.unlock() }
        let line = "\(ISO8601DateFormatter().string(from: Date())) [\(getpid()) +\(elapsed())] \(message)\n"
        let fm = FileManager.default
        try? fm.createDirectory(at: logURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        // Keep the log small: start over past 1 MB.
        if let size = (try? fm.attributesOfItem(atPath: logURL.path))?[.size] as? Int, size > 1_000_000 {
            try? fm.removeItem(at: logURL)
        }
        if let handle = try? FileHandle(forWritingTo: logURL) {
            handle.seekToEndOfFile()
            handle.write(Data(line.utf8))
            try? handle.close()
        } else {
            try? Data(line.utf8).write(to: logURL)
        }
    }
}
