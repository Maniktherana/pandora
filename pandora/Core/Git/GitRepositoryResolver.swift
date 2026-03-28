import Foundation

struct ResolvedProject {
    let selectedPath: String
    let gitRootPath: String
    let gitContextSubpath: String?
    let displayName: String
    let gitRemoteOwner: String?
}

enum GitRepositoryResolverError: LocalizedError {
    case notGitRepository

    var errorDescription: String? {
        switch self {
        case .notGitRepository:
            return "The selected folder is not inside a Git repository."
        }
    }
}

struct GitRepositoryResolver {
    nonisolated func resolveProject(at selectedPath: String) throws -> ResolvedProject {
        let standardizedPath = (selectedPath as NSString).standardizingPath
        let gitRootPath = try runGit(arguments: ["-C", standardizedPath, "rev-parse", "--show-toplevel"]).trimmingCharacters(in: .whitespacesAndNewlines)
        guard gitRootPath.isEmpty == false else {
            throw GitRepositoryResolverError.notGitRepository
        }

        let contextSubpath: String?
        let normalizedSelected = URL(fileURLWithPath: standardizedPath).standardizedFileURL.path
        let normalizedRoot = URL(fileURLWithPath: gitRootPath).standardizedFileURL.path
        if normalizedSelected == normalizedRoot {
            contextSubpath = nil
        } else {
            let rootURL = URL(fileURLWithPath: normalizedRoot, isDirectory: true)
            let selectedURL = URL(fileURLWithPath: normalizedSelected, isDirectory: true)
            let relative = selectedURL.path.replacingOccurrences(of: rootURL.path + "/", with: "")
            contextSubpath = relative == selectedURL.path ? nil : relative
        }

        return ResolvedProject(
            selectedPath: normalizedSelected,
            gitRootPath: normalizedRoot,
            gitContextSubpath: contextSubpath,
            displayName: URL(fileURLWithPath: normalizedSelected).lastPathComponent,
            gitRemoteOwner: resolveRemoteOwner(gitRootPath: normalizedRoot)
        )
    }

    nonisolated func resolveRemoteOwner(gitRootPath: String) -> String? {
        let remoteCandidates = [
            try? runGit(arguments: ["-C", gitRootPath, "config", "--get", "remote.origin.url"]),
            try? runGit(arguments: ["-C", gitRootPath, "remote", "-v"])
        ]

        for rawCandidate in remoteCandidates.compactMap({ $0 }) {
            let candidate = rawCandidate.trimmingCharacters(in: .whitespacesAndNewlines)
            if let owner = parseGitHubOwner(from: candidate), owner.isEmpty == false {
                return owner
            }
        }

        if let email = try? runGit(arguments: ["-C", gitRootPath, "config", "--get", "user.email"])
            .trimmingCharacters(in: .whitespacesAndNewlines),
           let localPart = email.split(separator: "@").first,
           localPart.isEmpty == false {
            return slugify(String(localPart))
        }

        if let userName = try? runGit(arguments: ["-C", gitRootPath, "config", "--get", "user.name"])
            .trimmingCharacters(in: .whitespacesAndNewlines),
           userName.isEmpty == false {
            return slugify(userName)
        }

        return nil
    }

    private nonisolated func parseGitHubOwner(from remote: String) -> String? {
        let lines = remote
            .split(separator: "\n")
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }

        for line in lines where line.contains("github.com") {
            if let sshRange = line.range(of: "github.com:") {
                let repoPath = String(line[sshRange.upperBound...]).split(separator: " ").first.map(String.init) ?? ""
                return repoPath.split(separator: "/").first.map { slugify(String($0)) }
            }
            if let httpsRange = line.range(of: "github.com/") {
                let repoPath = String(line[httpsRange.upperBound...]).split(separator: " ").first.map(String.init) ?? ""
                return repoPath.split(separator: "/").first.map { slugify(String($0)) }
            }
        }

        return nil
    }

    private nonisolated func runGit(arguments: [String]) throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["git"] + arguments

        let outputPipe = Pipe()
        let errorPipe = Pipe()
        process.standardOutput = outputPipe
        process.standardError = errorPipe

        try process.run()
        process.waitUntilExit()

        let outputData = outputPipe.fileHandleForReading.readDataToEndOfFile()
        let errorData = errorPipe.fileHandleForReading.readDataToEndOfFile()
        if process.terminationStatus != 0 {
            let message = String(data: errorData, encoding: .utf8) ?? "Git command failed"
            throw NSError(domain: "GitRepositoryResolver", code: Int(process.terminationStatus), userInfo: [
                NSLocalizedDescriptionKey: message.trimmingCharacters(in: .whitespacesAndNewlines)
            ])
        }

        return String(data: outputData, encoding: .utf8) ?? ""
    }

    private nonisolated func slugify(_ raw: String) -> String {
        let lower = raw.lowercased()
        let scalars = lower.unicodeScalars.map { scalar -> Character in
            switch scalar {
            case "a"..."z", "0"..."9":
                return Character(scalar)
            default:
                return "-"
            }
        }
        let collapsed = String(scalars).replacingOccurrences(of: "-+", with: "-", options: .regularExpression)
        return collapsed.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
    }
}
