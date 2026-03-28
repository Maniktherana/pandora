import Foundation

@MainActor
final class WorkspaceRuntimeRegistry {
    struct Context {
        let daemonClient: DaemonClient
        let surfaceRegistry: SurfaceRegistry
        let workspaceController: PandoraWorkspaceController
        let runtimeStore: WorkspaceRuntimeStore
    }

    private let appDatabase: AppDatabase
    private let daemonLauncher: PandoraDaemonLauncher
    private var contexts: [String: Context] = [:]

    init(appDatabase: AppDatabase, daemonLauncher: PandoraDaemonLauncher) {
        self.appDatabase = appDatabase
        self.daemonLauncher = daemonLauncher
    }

    convenience init() {
        self.init(appDatabase: .shared, daemonLauncher: .shared)
    }

    func context(for workspace: WorkspaceRecord) -> Context {
        if let existing = contexts[workspace.id] {
            existing.runtimeStore.updateWorkspace(workspace)
            return existing
        }

        let defaultCwd: String
        if let subpath = workspace.workspaceContextSubpath, subpath.isEmpty == false {
            defaultCwd = URL(fileURLWithPath: workspace.worktreePath, isDirectory: true)
                .appendingPathComponent(subpath, isDirectory: true)
                .path
        } else {
            defaultCwd = workspace.worktreePath
        }

        daemonLauncher.ensureLaunched(workspacePath: workspace.worktreePath, defaultCwd: defaultCwd)

        let daemonClient = DaemonClient(workspacePath: workspace.worktreePath)
        let surfaceRegistry = SurfaceRegistry()
        let runtimeStore = WorkspaceRuntimeStore(
            workspace: workspace,
            daemonClient: daemonClient,
            surfaceRegistry: surfaceRegistry,
            appDatabase: appDatabase,
            defaultCwd: defaultCwd
        )
        let workspaceController = PandoraWorkspaceController()
        workspaceController.bind(store: runtimeStore, surfaceRegistry: surfaceRegistry)
        runtimeStore.connect()

        let context = Context(
            daemonClient: daemonClient,
            surfaceRegistry: surfaceRegistry,
            workspaceController: workspaceController,
            runtimeStore: runtimeStore
        )
        contexts[workspace.id] = context
        return context
    }

    func removeContext(workspace: WorkspaceRecord) {
        guard let context = contexts.removeValue(forKey: workspace.id) else { return }
        context.daemonClient.disconnect()
        daemonLauncher.stop(workspacePath: workspace.worktreePath)
    }
}
