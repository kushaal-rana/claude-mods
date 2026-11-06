import Foundation

/// A tiny HTTP/1.1 server on a private Unix domain socket. The mod reaches it with
/// `$.http.fetch(url, { socketPath })`; each request is `POST /cmd` with a JSON body,
/// answered with a JSON body. Blocking POSIX sockets on background threads keep it simple.
final class CommandServer {
    typealias Handler = (Data) async -> Data
    private let path: String
    private let handler: Handler
    private var fd: Int32 = -1

    init(path: String, handler: @escaping Handler) throws {
        self.path = path
        self.handler = handler
        let dir = (path as NSString).deletingLastPathComponent
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        unlink(path)
        fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw err("socket") }
        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(path.utf8)
        guard bytes.count < MemoryLayout.size(ofValue: addr.sun_path) else { throw err("socket path too long") }
        withUnsafeMutableBytes(of: &addr.sun_path) { raw in
            raw.copyBytes(from: bytes)
            raw[bytes.count] = 0
        }
        let size = socklen_t(MemoryLayout<sockaddr_un>.size)
        let bound = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, size) }
        }
        guard bound == 0 else { throw err("bind") }
        chmod(path, 0o600)
        guard listen(fd, 16) == 0 else { throw err("listen") }
        let thread = Thread { [weak self] in self?.acceptLoop() }
        thread.name = "command-server"
        thread.start()
    }

    deinit { close(fd); unlink(path) }

    private func err(_ what: String) -> NSError {
        NSError(domain: "CommandServer", code: Int(errno),
                userInfo: [NSLocalizedDescriptionKey: "\(what) failed: \(String(cString: strerror(errno)))"])
    }

    private func acceptLoop() {
        while true {
            let client = accept(fd, nil, nil)
            if client < 0 { if errno == EINTR { continue }; return }
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in self?.serve(client) }
        }
    }

    private func serve(_ client: Int32) {
        defer { close(client) }
        var buffer = Data()
        var chunk = [UInt8](repeating: 0, count: 65536)
        var body: Data?
        while body == nil {
            let n = read(client, &chunk, chunk.count)
            if n <= 0 { return }
            buffer.append(chunk, count: n)
            body = Self.completeBody(buffer)
        }
        let semaphore = DispatchSemaphore(value: 0)
        var reply = Data("{}".utf8)
        let handler = self.handler
        Task.detached {
            reply = await handler(body!)
            semaphore.signal()
        }
        semaphore.wait()
        var head = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n"
        head += "Content-Length: \(reply.count)\r\nConnection: close\r\n\r\n"
        var out = Data(head.utf8)
        out.append(reply)
        out.withUnsafeBytes { raw in
            var sent = 0
            while sent < raw.count {
                let n = write(client, raw.baseAddress!.advanced(by: sent), raw.count - sent)
                if n <= 0 { return }
                sent += n
            }
        }
    }

    /// The body once headers and Content-Length bytes have arrived; nil while incomplete.
    private static func completeBody(_ buffer: Data) -> Data? {
        guard let range = buffer.range(of: Data("\r\n\r\n".utf8)) else { return nil }
        let header = String(decoding: buffer[buffer.startIndex..<range.lowerBound], as: UTF8.self)
        var length = 0
        for line in header.split(separator: "\r\n") {
            let parts = line.split(separator: ":", maxSplits: 1)
            if parts.count == 2, parts[0].trimmingCharacters(in: .whitespaces).lowercased() == "content-length" {
                length = Int(parts[1].trimmingCharacters(in: .whitespaces)) ?? 0
            }
        }
        let start = range.upperBound
        guard buffer.endIndex - start >= length else { return nil }
        return buffer.subdata(in: start..<(start + length))
    }
}
