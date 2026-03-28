import AppKit
import Combine
import Foundation

@MainActor
final class ProjectsStore: ObservableObject {
    @Published private(set) var projects: [ProjectRecord] = []
    @Published private(set) var workspaces: [WorkspaceRecord] = []
    @Published var selectedProjectID: String?
    @Published var selectedWorkspaceID: String?
    @Published var lastErrorMessage: String?

    private let appDatabase: AppDatabase
    private let repositoryResolver: GitRepositoryResolver
    private let worktreeService: GitWorktreeService
    private let runtimeRegistry: WorkspaceRuntimeRegistry

    init(
        appDatabase: AppDatabase,
        repositoryResolver: GitRepositoryResolver,
        worktreeService: GitWorktreeService,
        runtimeRegistry: WorkspaceRuntimeRegistry
    ) {
        self.appDatabase = appDatabase
        self.repositoryResolver = repositoryResolver
        self.worktreeService = worktreeService
        self.runtimeRegistry = runtimeRegistry
        reload()
    }

    convenience init() {
        self.init(
            appDatabase: .shared,
            repositoryResolver: GitRepositoryResolver(),
            worktreeService: GitWorktreeService(),
            runtimeRegistry: WorkspaceRuntimeRegistry()
        )
    }

    var selectedWorkspace: WorkspaceRecord? {
        guard let selectedWorkspaceID else { return nil }
        return workspaces.first(where: { $0.id == selectedWorkspaceID })
    }

    func workspaces(for project: ProjectRecord) -> [WorkspaceRecord] {
        workspaces
            .filter { $0.projectID == project.id }
            .sorted { $0.createdAt < $1.createdAt }
    }

    func runtimeContext(for workspace: WorkspaceRecord) -> WorkspaceRuntimeRegistry.Context {
        runtimeRegistry.context(for: workspace)
    }

    func reload() {
        projects = appDatabase.loadProjects()
        workspaces = appDatabase.loadWorkspaces()
        selectedProjectID = appDatabase.loadSelectedProjectID() ?? projects.first?.id
        selectedWorkspaceID = appDatabase.loadSelectedWorkspaceID() ?? workspaces.first?.id

        if let selectedWorkspace,
           projects.contains(where: { $0.id == selectedWorkspace.projectID }) {
            selectedProjectID = selectedWorkspace.projectID
        }

        if selectedProjectID == nil {
            selectedProjectID = projects.first?.id
        }
        persistSelection()
    }

    func presentAddProjectPanel() {
        let panel = NSOpenPanel()
        panel.title = "Add Project"
        panel.message = "Choose a folder inside a Git repository."
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false

        guard panel.runModal() == .OK, let url = panel.url else { return }
        addProject(at: url.path)
    }

    func addProject(at selectedPath: String) {
        do {
            let resolved = try repositoryResolver.resolveProject(at: selectedPath)
            if let existing = appDatabase.project(matchingDisplayPath: resolved.selectedPath) {
                var reopened = existing
                reopened.isExpanded = true
                reopened.updatedAt = Date()
                appDatabase.upsert(project: reopened)
                reload()
                selectedProjectID = reopened.id
                selectedWorkspaceID = workspaces(for: reopened).first?.id
                persistSelection()
                return
            }

            let now = Date()
            let project = ProjectRecord(
                id: UUID().uuidString.lowercased(),
                displayPath: resolved.selectedPath,
                gitRootPath: resolved.gitRootPath,
                gitContextSubpath: resolved.gitContextSubpath,
                displayName: resolved.displayName,
                gitRemoteOwner: resolved.gitRemoteOwner,
                isExpanded: true,
                createdAt: now,
                updatedAt: now
            )
            appDatabase.upsert(project: project)
            reload()
            selectedProjectID = project.id
            selectedWorkspaceID = nil
            persistSelection()
        } catch {
            lastErrorMessage = error.localizedDescription
        }
    }

    func toggleProject(_ project: ProjectRecord) {
        var updated = project
        updated.isExpanded.toggle()
        updated.updatedAt = Date()
        appDatabase.upsert(project: updated)
        reload()
    }

    func selectWorkspace(_ workspace: WorkspaceRecord) {
        selectedWorkspaceID = workspace.id
        selectedProjectID = workspace.projectID
        persistSelection()

        var updated = workspace
        updated.lastOpenedAt = Date()
        updated.updatedAt = Date()
        appDatabase.upsert(workspace: updated)
        if updated.status == .ready {
            _ = runtimeRegistry.context(for: updated)
        }
        reload()
    }

    func createWorkspace(project: ProjectRecord) {
        let optimistic = worktreeService.makeOptimisticWorkspace(project: project, existingCount: workspaces(for: project).count)
        appDatabase.upsert(workspace: optimistic)
        reload()
        selectWorkspace(optimistic)

        Task.detached(priority: .userInitiated) { [worktreeService, appDatabase] in
            do {
                let created = try worktreeService.createWorkspace(optimistic, for: project)
                await MainActor.run {
                    appDatabase.upsert(workspace: created)
                    self.reload()
                    self.selectWorkspace(created)
                }
            } catch {
                await MainActor.run {
                    var failed = optimistic
                    failed.status = .failed
                    failed.failureMessage = error.localizedDescription
                    failed.updatedAt = Date()
                    appDatabase.upsert(workspace: failed)
                    self.reload()
                    self.selectWorkspace(failed)
                }
            }
        }
    }

    func retryWorkspace(_ workspace: WorkspaceRecord) {
        guard let project = projects.first(where: { $0.id == workspace.projectID }) else {
            lastErrorMessage = "The project no longer exists."
            return
        }

        var updating = workspace
        updating.status = .creating
        updating.failureMessage = nil
        updating.updatedAt = Date()
        appDatabase.upsert(workspace: updating)
        reload()

        Task.detached(priority: .userInitiated) { [worktreeService, appDatabase] in
            do {
                let recreated = try worktreeService.retryWorkspace(workspace, for: project)
                await MainActor.run {
                    appDatabase.upsert(workspace: recreated)
                    self.reload()
                    self.selectWorkspace(recreated)
                }
            } catch {
                await MainActor.run {
                    var failed = workspace
                    failed.status = .failed
                    failed.failureMessage = error.localizedDescription
                    failed.updatedAt = Date()
                    appDatabase.upsert(workspace: failed)
                    self.reload()
                    self.selectWorkspace(failed)
                }
            }
        }
    }

    func removeWorkspace(_ workspace: WorkspaceRecord) {
        guard let project = projects.first(where: { $0.id == workspace.projectID }) else { return }

        runtimeRegistry.removeContext(workspace: workspace)

        Task.detached(priority: .userInitiated) { [worktreeService, appDatabase] in
            try? worktreeService.removeWorkspace(workspace, project: project)
            await MainActor.run {
                appDatabase.removeWorkspace(id: workspace.id)
                self.reload()
                if self.selectedWorkspaceID == workspace.id {
                    self.selectedWorkspaceID = self.workspaces.first(where: { $0.projectID == project.id })?.id ?? self.workspaces.first?.id
                    self.selectedProjectID = self.selectedWorkspace.flatMap { $0.projectID } ?? self.projects.first?.id
                    self.persistSelection()
                }
            }
        }
    }

    func clearError() {
        lastErrorMessage = nil
    }

    private func persistSelection() {
        appDatabase.saveSelection(projectID: selectedProjectID, workspaceID: selectedWorkspaceID)
    }
}
