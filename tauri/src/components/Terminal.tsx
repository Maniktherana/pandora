import { useEffect, useRef, useCallback } from "react";
import { Terminal as XTerminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";

interface TerminalProps {
  sessionID: string;
  onInput: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  onFocus?: () => void;
  isFocused?: boolean;
}

// Global registry of terminal instances so they persist across re-renders
const terminalRegistry = new Map<string, XTerminal>();
const fitAddonRegistry = new Map<string, FitAddon>();

export function feedTerminalOutput(sessionID: string, data: string) {
  const term = terminalRegistry.get(sessionID);
  if (term) {
    // Data comes as base64 from daemon
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    term.write(bytes);
  }
}

export function getTerminal(sessionID: string): XTerminal | undefined {
  return terminalRegistry.get(sessionID);
}

export default function Terminal({ sessionID, onInput, onResize, onFocus, isFocused }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);

  const handleResize = useCallback(() => {
    const fitAddon = fitAddonRegistry.get(sessionID);
    const term = terminalRegistry.get(sessionID);
    if (fitAddon && term) {
      try {
        fitAddon.fit();
        onResize(term.cols, term.rows);
      } catch {}
    }
  }, [sessionID, onResize]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mountedRef.current) return;
    mountedRef.current = true;

    let term = terminalRegistry.get(sessionID);
    let fitAddon = fitAddonRegistry.get(sessionID);

    if (!term) {
      term = new XTerminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
        theme: {
          background: "#0a0a0a",
          foreground: "#e4e4e7",
          cursor: "#e4e4e7",
          selectionBackground: "#3b82f680",
          black: "#18181b",
          red: "#ef4444",
          green: "#22c55e",
          yellow: "#eab308",
          blue: "#3b82f6",
          magenta: "#a855f7",
          cyan: "#06b6d4",
          white: "#e4e4e7",
          brightBlack: "#52525b",
          brightRed: "#f87171",
          brightGreen: "#4ade80",
          brightYellow: "#facc15",
          brightBlue: "#60a5fa",
          brightMagenta: "#c084fc",
          brightCyan: "#22d3ee",
          brightWhite: "#fafafa",
        },
        allowProposedApi: true,
        scrollback: 10000,
      });

      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      terminalRegistry.set(sessionID, term);
      fitAddonRegistry.set(sessionID, fitAddon);

      term.onData((data) => onInput(data));
    }

    // Open in container (or re-attach)
    if (container.children.length === 0) {
      term.open(container);

      // Try WebGL addon for GPU-accelerated rendering
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        term.loadAddon(webgl);
      } catch {
        // WebGL not available, canvas renderer is fine
      }
    }

    // Initial fit
    requestAnimationFrame(() => {
      handleResize();
    });

    const observer = new ResizeObserver(() => handleResize());
    observer.observe(container);

    return () => {
      observer.disconnect();
      mountedRef.current = false;
    };
  }, [sessionID, onInput, handleResize]);

  useEffect(() => {
    if (isFocused) {
      const term = terminalRegistry.get(sessionID);
      term?.focus();
    }
  }, [isFocused, sessionID]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      onClick={onFocus}
    />
  );
}
