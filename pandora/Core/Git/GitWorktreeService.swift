import Foundation

enum GitWorktreeServiceError: LocalizedError {
    case missingProject
    case commandFailed(String)

    var errorDescription: String? {
        switch self {
        case .missingProject:
            return "The project no longer exists."
        case .commandFailed(let message):
            return message
        }
    }
}

struct GitWorktreeService {
    private let repositoryResolver = GitRepositoryResolver()

    nonisolated func makeOptimisticWorkspace(project: ProjectRecord, existingCount: Int) -> WorkspaceRecord {
        let timestamp = Date()
        let owner = repositoryResolver.resolveRemoteOwner(gitRootPath: project.gitRootPath) ?? "workspace"
        let slug = generateSlug()
        let branch = "\(owner)/\(slug)"
        return WorkspaceRecord(
            id: UUID().uuidString.lowercased(),
            projectID: project.id,
            name: "Workspace \(existingCount + 1)",
            gitBranchName: branch,
            gitWorktreeOwner: owner,
            gitWorktreeSlug: slug,
            worktreePath: worktreePath(projectID: project.id, owner: owner, slug: slug),
            workspaceContextSubpath: project.gitContextSubpath,
            status: .creating,
            failureMessage: nil,
            createdAt: timestamp,
            updatedAt: timestamp,
            lastOpenedAt: nil
        )
    }

    nonisolated func createWorkspace(_ workspace: WorkspaceRecord, for project: ProjectRecord) throws -> WorkspaceRecord {
        try runGit(arguments: ["-C", project.gitRootPath, "worktree", "add", "-b", workspace.gitBranchName, workspace.worktreePath])
        return updated(workspace, status: .ready, failureMessage: nil)
    }

    nonisolated func retryWorkspace(_ workspace: WorkspaceRecord, for project: ProjectRecord) throws -> WorkspaceRecord {
        try removePartialWorktree(at: workspace.worktreePath)
        let slug = generateSlug()
        let refreshed = WorkspaceRecord(
            id: workspace.id,
            projectID: workspace.projectID,
            name: workspace.name,
            gitBranchName: "\(workspace.gitWorktreeOwner)/\(slug)",
            gitWorktreeOwner: workspace.gitWorktreeOwner,
            gitWorktreeSlug: slug,
            worktreePath: worktreePath(projectID: project.id, owner: workspace.gitWorktreeOwner, slug: slug),
            workspaceContextSubpath: workspace.workspaceContextSubpath,
            status: .creating,
            failureMessage: nil,
            createdAt: workspace.createdAt,
            updatedAt: Date(),
            lastOpenedAt: workspace.lastOpenedAt
        )
        try runGit(arguments: ["-C", project.gitRootPath, "worktree", "add", "-b", refreshed.gitBranchName, refreshed.worktreePath])
        return updated(refreshed, status: .ready, failureMessage: nil)
    }

    nonisolated func removeWorkspace(_ workspace: WorkspaceRecord, project: ProjectRecord) throws {
        try runGit(arguments: ["-C", project.gitRootPath, "worktree", "remove", "--force", workspace.worktreePath])
        try removePartialWorktree(at: workspace.worktreePath)
    }

    nonisolated func worktreePath(projectID: String, owner: String, slug: String) -> String {
        pandoraHomeDirectory()
            .appendingPathComponent("workspaces", isDirectory: true)
            .appendingPathComponent(projectID, isDirectory: true)
            .appendingPathComponent(owner, isDirectory: true)
            .appendingPathComponent(slug, isDirectory: true)
            .path
    }

    private nonisolated func updated(_ workspace: WorkspaceRecord, status: WorkspaceStatus, failureMessage: String?) -> WorkspaceRecord {
        var copy = workspace
        copy.status = status
        copy.failureMessage = failureMessage
        copy.updatedAt = Date()
        return copy
    }

    private nonisolated func removePartialWorktree(at path: String) throws {
        let fileManager = FileManager.default
        if fileManager.fileExists(atPath: path) {
            try fileManager.removeItem(atPath: path)
        }
    }

    private nonisolated func runGit(arguments: [String]) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["git"] + arguments
        let outputPipe = Pipe()
        let errorPipe = Pipe()
        process.standardOutput = outputPipe
        process.standardError = errorPipe
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            let errorData = errorPipe.fileHandleForReading.readDataToEndOfFile()
            let message = String(data: errorData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "Git worktree command failed"
            throw GitWorktreeServiceError.commandFailed(message)
        }
    }

    private nonisolated func generateSlug() -> String {
        let characters = Array("abcdefghijklmnopqrstuvwxyz0123456789")
        return String((0..<8).map { _ in characters.randomElement()! })
    }

    private nonisolated func pandoraHomeDirectory() -> URL {
        if let override = ProcessInfo.processInfo.environment["PANDORA_HOME"], override.isEmpty == false {
            return URL(fileURLWithPath: override, isDirectory: true)
        }
        return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".pandora", isDirectory: true)
    }
}
