import type { Plugin, ResolvedConfig } from "vite";
import * as esbuild from "esbuild";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

type MonacoWorkerLabel = "editorWorkerService" | "css" | "html" | "json" | "typescript";

type MonacoWorker = {
  label: MonacoWorkerLabel;
  entry: string;
};

type MonacoEditorPluginOptions = {
  languageWorkers: MonacoWorkerLabel[];
  publicPath?: string;
  globalAPI?: boolean;
};

const require = createRequire(import.meta.url);

const languageWorksByLabel: Record<MonacoWorkerLabel, MonacoWorker> = {
  editorWorkerService: {
    label: "editorWorkerService",
    entry: "monaco-editor/esm/vs/editor/editor.worker",
  },
  css: {
    label: "css",
    entry: "monaco-editor/esm/vs/language/css/css.worker",
  },
  html: {
    label: "html",
    entry: "monaco-editor/esm/vs/language/html/html.worker",
  },
  json: {
    label: "json",
    entry: "monaco-editor/esm/vs/language/json/json.worker",
  },
  typescript: {
    label: "typescript",
    entry: "monaco-editor/esm/vs/language/typescript/ts.worker",
  },
};

function getFilenameByEntry(entry: string): string {
  return `${path.basename(entry)}.bundle.js`;
}

function resolveMonacoPath(filePath: string): string {
  return require.resolve(`${filePath}.js`);
}

function getWorkerPaths(
  workers: MonacoWorker[],
  config: ResolvedConfig,
  publicPath: string,
): Record<string, string> {
  const workerPaths: Record<string, string> = {};

  for (const worker of workers) {
    workerPaths[worker.label] = `${config.base}${publicPath}/${getFilenameByEntry(worker.entry)}`;
  }

  if (workerPaths.typescript) {
    workerPaths.javascript = workerPaths.typescript;
  }

  if (workerPaths.css) {
    workerPaths.less = workerPaths.css;
    workerPaths.scss = workerPaths.css;
  }

  if (workerPaths.html) {
    workerPaths.handlebars = workerPaths.html;
    workerPaths.razor = workerPaths.html;
  }

  return workerPaths;
}

function buildWorker(worker: MonacoWorker, cacheDir: string): string {
  const outfile = path.join(cacheDir, getFilenameByEntry(worker.entry));

  if (!fs.existsSync(outfile)) {
    fs.mkdirSync(cacheDir, { recursive: true });
    esbuild.buildSync({
      entryPoints: [resolveMonacoPath(worker.entry)],
      bundle: true,
      outfile,
    });
  }

  return outfile;
}

export function monacoEditorPlugin({
  languageWorkers,
  publicPath = "monacoeditorwork",
  globalAPI = false,
}: MonacoEditorPluginOptions): Plugin {
  const workers = languageWorkers.map((label) => languageWorksByLabel[label]);
  let resolvedConfig: ResolvedConfig;
  let cacheDir: string;

  return {
    name: "pandora-monaco-editor-workers",

    configResolved(config) {
      resolvedConfig = config;
      cacheDir = path.join(config.root, "node_modules/.monaco");
    },

    configureServer(server) {
      fs.rmSync(cacheDir, { recursive: true, force: true });

      for (const worker of workers) {
        server.middlewares.use(
          `${resolvedConfig.base}${publicPath}/${getFilenameByEntry(worker.entry)}`,
          (_req, res) => {
            const workerPath = buildWorker(worker, cacheDir);
            const contentBuffer = fs.readFileSync(workerPath);

            res.setHeader("Content-Type", "text/javascript");
            res.end(contentBuffer);
          },
        );
      }
    },

    transformIndexHtml() {
      const workerPaths = getWorkerPaths(workers, resolvedConfig, publicPath);
      const monacoEnvironment = `(function (paths) {
        return {
          globalAPI: ${globalAPI},
          getWorkerUrl: function (_moduleId, label) {
            return paths[label];
          }
        };
      })(${JSON.stringify(workerPaths, null, 2)})`;

      return [
        {
          tag: "script",
          children: `self.MonacoEnvironment = ${monacoEnvironment};`,
          injectTo: "head-prepend",
        },
      ];
    },

    writeBundle() {
      const distPath = path.join(
        resolvedConfig.root,
        resolvedConfig.build.outDir,
        resolvedConfig.base,
        publicPath,
      );

      fs.mkdirSync(distPath, { recursive: true });

      for (const worker of workers) {
        const workerPath = buildWorker(worker, cacheDir);
        const workDistPath = path.resolve(distPath, getFilenameByEntry(worker.entry));

        fs.copyFileSync(workerPath, workDistPath);
      }
    },
  };
}
