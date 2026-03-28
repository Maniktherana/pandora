import Foundation

enum WorkspaceStatus: String, Codable, CaseIterable {
    case creating
    case ready
    case failed
    case deleting
}

enum RuntimeScope: Codable, Equatable {
    case workspace(workspaceID: String)
    case project(projectID: String)

    private enum CodingKeys: String, CodingKey {
        case kind
        case workspaceID
        case projectID
    }

    private enum Kind: String, Codable {
        case workspace
        case project
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(Kind.self, forKey: .kind) {
        case .workspace:
            self = .workspace(workspaceID: try container.decode(String.self, forKey: .workspaceID))
        case .project:
            self = .project(projectID: try container.decode(String.self, forKey: .projectID))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .workspace(let workspaceID):
            try container.encode(Kind.workspace, forKey: .kind)
            try container.encode(workspaceID, forKey: .workspaceID)
        case .project(let projectID):
            try container.encode(Kind.project, forKey: .kind)
            try container.encode(projectID, forKey: .projectID)
        }
    }
}

struct ProjectRecord: Identifiable, Codable, Equatable {
    let id: String
    var displayPath: String
    var gitRootPath: String
    var gitContextSubpath: String?
    var displayName: String
    var gitRemoteOwner: String?
    var isExpanded: Bool
    var createdAt: Date
    var updatedAt: Date

    var monogram: String {
        String(displayName.trimmingCharacters(in: .whitespacesAndNewlines).uppercased().prefix(1))
    }
}

struct WorkspaceRecord: Identifiable, Codable, Equatable {
    let id: String
    var projectID: String
    var name: String
    var gitBranchName: String
    var gitWorktreeOwner: String
    var gitWorktreeSlug: String
    var worktreePath: String
    var workspaceContextSubpath: String?
    var status: WorkspaceStatus
    var failureMessage: String?
    var createdAt: Date
    var updatedAt: Date
    var lastOpenedAt: Date?

    var runtimeScope: RuntimeScope {
        .workspace(workspaceID: id)
    }
}
