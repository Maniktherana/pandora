import { useEffect, useRef, useState } from "react";
import { Terminal, FitAddon, init } from "@/lib/ghostty-web";
import { getTerminalDaemonClient, subscribeTerminalOutput } from "@/lib/terminal-runtime";
import { terminalTheme } from "@/lib/theme";

interface WebTerminalSurfaceProps {
  sessionID: string;
  workspaceId: string;
  visible: boolean;
  focused: boolean;
  onFocus?: () => void;
}

let initPromise: Promise<void> | null = null;

function ensureTerminalRuntime(): Promise<void> {
  if (!initPromise) {
    initPromise = init().catch((error) => {
      initPromise = null;
      throw error;
    });
  }

  return initPromise;
}

function decodeBase64Chunk(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function encodeInputAsBase64(data: string): string {
  const bytes = new TextEncoder().encode(data);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * App-level keyboard shortcuts that the terminal should NOT consume.
 * Returns true if the event is an app shortcut (terminal should ignore it).
 */
function isAppShortcut(e: KeyboardEvent): boolean {
  if (e.metaKey && e.shiftKey) {
    // Cmd+Shift+[ / ] — tab navigation
    if (e.code === "BracketLeft" || e.code === "BracketRight") return true;
  }
  if (e.metaKey && !e.shiftKey) {
    if (e.code === "KeyQ") return true;  // Cmd+Q — quit app
    if (e.code === "KeyB") return true;  // Cmd+B — toggle sidebar
    if (e.code === "KeyT") return true;  // Cmd+T — new terminal
    if (e.code === "KeyW") return true;  // Cmd+W — close tab
  }
  return false;
}

export default function WebTerminalSurface({
  sessionID,
  workspaceId,
  visible,
  focused,
  onFocus,
}: WebTerminalSurfaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const pendingOutputRef = useRef<string[]>([]);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    const container = containerRef.current;
    if (!container) return;

    setInitError(null);

    void ensureTerminalRuntime()
      .then(() => {
        if (disposed || !containerRef.current) return;

        const terminal = new Terminal({
          fontSize: 14,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          cursorBlink: false,
          smoothScrollDuration: 40, // Short duration — smooths trackpad jitter without feeling laggy
          theme: terminalTheme,
        });

        // ghostty-web API: true = "custom handler consumed it, stop", false = "continue normal processing"
        terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
          // App-level shortcuts — let them bubble to the window handler
          if (isAppShortcut(e)) {
            return true;
          }

          // Cmd+Arrow → line navigation, Cmd+Backspace → delete line
          // These are macOS conventions not handled by the key encoder
          if (e.metaKey && !e.shiftKey && !e.altKey && !e.ctrlKey) {
            let seq: string | null = null;
            switch (e.code) {
              case "ArrowLeft":  seq = "\x01"; break; // Ctrl+A — beginning of line
              case "ArrowRight": seq = "\x05"; break; // Ctrl+E — end of line
              case "ArrowUp":    seq = "\x1b[1;5A"; break; // scroll/move up (Ctrl+Up)
              case "ArrowDown":  seq = "\x1b[1;5B"; break; // scroll/move down (Ctrl+Down)
              case "Backspace":  seq = "\x15"; break; // Ctrl+U — kill line
            }
            if (seq) {
              e.preventDefault();
              getTerminalDaemonClient()?.input(workspaceId, sessionID, encodeInputAsBase64(seq));
              return true;
            }
          }

          return false; // let terminal handle normally
        });

        const fitAddon = new FitAddon();

        terminal.loadAddon(fitAddon);
        terminal.open(containerRef.current);
        fitAddon.fit();
        fitAddon.observeResize();

        const client = getTerminalDaemonClient();

        terminal.onData((data) => {
          getTerminalDaemonClient()?.input(workspaceId, sessionID, encodeInputAsBase64(data));
        });

        terminal.onResize(({ cols, rows }) => {
          getTerminalDaemonClient()?.resize(workspaceId, sessionID, cols, rows);
        });

        terminalRef.current = terminal;
        fitAddonRef.current = fitAddon;

        for (const chunk of pendingOutputRef.current) {
          terminal.write(decodeBase64Chunk(chunk));
        }
        pendingOutputRef.current = [];

        if (focused) {
          terminal.focus();
        }

        // Trigger an initial PTY resize after fit settles.
        const measuredClient = client ?? getTerminalDaemonClient();
        if (measuredClient) {
          window.setTimeout(() => {
            measuredClient.resize(workspaceId, sessionID, terminal.cols, terminal.rows);
          }, 0);
        }
      })
      .catch((error) => {
        if (disposed) return;
        const message = error instanceof Error ? error.message : String(error);
        console.error("Failed to initialize web terminal:", error);
        setInitError(message);
      });

    return () => {
      disposed = true;
      fitAddonRef.current?.dispose();
      terminalRef.current?.dispose();
      fitAddonRef.current = null;
      terminalRef.current = null;
      pendingOutputRef.current = [];
    };
  }, [sessionID, workspaceId]);

  useEffect(() => {
    return subscribeTerminalOutput(sessionID, (data) => {
      const terminal = terminalRef.current;
      if (!terminal) {
        pendingOutputRef.current.push(data);
        return;
      }
      terminal.write(decodeBase64Chunk(data));
    });
  }, [sessionID]);

  useEffect(() => {
    if (focused && visible) {
      terminalRef.current?.focus();
    }
  }, [focused, visible]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden text-neutral-300"
      onMouseDown={onFocus}
      style={{ background: terminalTheme.background ?? "#0a0a0a" }}
    >
      {initError ? (
        <div className="flex h-full w-full items-center justify-center px-4 text-center text-sm text-red-300">
          <div>
            <div>Failed to load terminal runtime.</div>
            <div className="mt-1 text-xs text-red-200/80">{initError}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
