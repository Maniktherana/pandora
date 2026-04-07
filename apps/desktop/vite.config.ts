import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import monacoEditorPluginPkg from "vite-plugin-monaco-editor";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const monacoEditorPlugin =
  (monacoEditorPluginPkg as { default?: typeof monacoEditorPluginPkg }).default ??
  monacoEditorPluginPkg;

export default defineConfig({
  plugins: [react(), tailwindcss(), monacoEditorPlugin({})],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "es2022",
    minify: !process.env.TAURI_DEBUG ? "oxc" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    rolldownOptions: {
      resolve: {
        mainFields: ["module", "main"],
      },
    },
  },
});
