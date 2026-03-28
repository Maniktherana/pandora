import Foundation

@MainActor
final class PandoraDaemonLauncher {
    static let shared = PandoraDaemonLauncher()

    private var processes: [String: Process] = [:]

    func ensureLaunched(workspacePath: String, defaultCwd: String?) {
        if let process = processes[workspacePath], process.isRunning {
            return
        }

        let process = Process()
        let environment = launchEnvironment()
        process.environment = environment
        let outputPipe = Pipe()
        let errorPipe = Pipe()
        process.standardOutput = outputPipe
        process.standardError = errorPipe

        if let bundled = bundledDaemonExecutablePath() {
            process.executableURL = URL(fileURLWithPath: bundled)
            process.arguments = [workspacePath, defaultCwd ?? workspacePath]
        } else if let dev = devLaunchContext() {
            process.executableURL = URL(fileURLWithPath: dev.bunExecutable)
            process.arguments = ["run", dev.entryArgument, workspacePath, defaultCwd ?? workspacePath]
            process.currentDirectoryURL = URL(fileURLWithPath: dev.workingDirectory)
        } else {
            DebugLogStore.shared.append(
                "Unable to resolve daemon launch context for \(workspacePath)",
                source: "runtime"
            )
            return
        }

        outputPipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            guard data.isEmpty == false, let output = String(data: data, encoding: .utf8) else { return }
            Task { @MainActor in
                DebugLogStore.shared.append(output, source: "daemon stdout")
            }
        }

        errorPipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            guard data.isEmpty == false, let output = String(data: data, encoding: .utf8) else { return }
            Task { @MainActor in
                DebugLogStore.shared.append(output, source: "daemon stderr")
            }
        }

        do {
            try process.run()
            processes[workspacePath] = process
            process.terminationHandler = { [weak self] terminated in
                Task { @MainActor [weak self] in
                    if self?.processes[workspacePath] === terminated {
                        self?.processes.removeValue(forKey: workspacePath)
                    }
                }
            }
        } catch {
            DebugLogStore.shared.append("Failed to launch daemon for \(workspacePath): \(error.localizedDescription)", source: "runtime")
        }
    }

    func stop(workspacePath: String) {
        guard let process = processes.removeValue(forKey: workspacePath), process.isRunning else { return }
        process.terminate()
    }

    private func bundledDaemonExecutablePath() -> String? {
        let executable = (Bundle.main.resourcePath as NSString?)?.appendingPathComponent("pandorad")
        guard let executable, FileManager.default.isExecutableFile(atPath: executable) else { return nil }
        return executable
    }

    private func devLaunchContext() -> (bunExecutable: String, entryArgument: String, workingDirectory: String)? {
        #if DEBUG
        let sourceURL = URL(fileURLWithPath: #filePath)
        let repoRoot = sourceURL
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let daemonDirectory = repoRoot.appendingPathComponent("daemon", isDirectory: true)
        let entry = daemonDirectory.appendingPathComponent("src/index.ts")
        guard FileManager.default.fileExists(atPath: entry.path) else { return nil }

        let environment = ProcessInfo.processInfo.environment
        let candidates = [
            environment["BUN_BIN"],
            environment["HOME"].map { "\($0)/.bun/bin/bun" },
            "/opt/homebrew/bin/bun",
            "/usr/local/bin/bun"
        ].compactMap { $0 }

        guard let bunExecutable = candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) else {
            return nil
        }

        return (bunExecutable, "./src/index.ts", daemonDirectory.path)
        #else
        return nil
        #endif
    }

    private func launchEnvironment() -> [String: String] {
        var environment = ProcessInfo.processInfo.environment
        #if DEBUG
        let devPandoraHome = (NSTemporaryDirectory() as NSString).appendingPathComponent("pandora-dev-home")
        environment["PANDORA_HOME"] = devPandoraHome
        #endif
        environment["PANDORA_PARENT_PID"] = String(ProcessInfo.processInfo.processIdentifier)
        return environment
    }
}
