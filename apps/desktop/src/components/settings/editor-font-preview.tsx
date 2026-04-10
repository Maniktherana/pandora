import { useCallback, useMemo, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import {
  MONACO_THEME_ID,
  pandoraMonacoBeforeMount,
} from "@/components/editor/monaco-pandora";
import { cn } from "@/lib/shared/utils";
import { useWorkspaceActions } from "@/hooks/use-workspace-actions";

const SAMPLES: Record<string, { language: string; code: string }> = {
  TypeScript: {
    language: "typescript",
    code: `interface User {
  name: string;
  age: number;
  email?: string;
}

function greet(user: User): string {
  return \`Hello, \${user.name}!\`;
}

const users: User[] = [
  { name: "Alice", age: 30 },
  { name: "Bob", age: 25 },
];`,
  },
  JavaScript: {
    language: "javascript",
    code: `const greeting = "Hello, World!";
const sum = (a, b) => a + b;

async function fetchData(url) {
  const res = await fetch(url);
  const data = await res.json();
  return data.filter((i) => i.active);
}

class EventEmitter {
  #listeners = new Map();
  on(event, fn) {
    this.#listeners.set(event, fn);
  }
}`,
  },
  Python: {
    language: "python",
    code: `from dataclasses import dataclass
from typing import Optional

@dataclass
class User:
    name: str
    age: int
    email: Optional[str] = None

def fibonacci(n: int) -> list[int]:
    a, b = 0, 1
    result = []
    for _ in range(n):
        result.append(a)
        a, b = b, a + b`,
  },
  Rust: {
    language: "rust",
    code: `use std::collections::HashMap;

fn main() {
    let nums: Vec<i32> = (1..=10).collect();
    let sum: i32 = nums.iter().sum();
    println!("Sum: {sum}");

    let mut map = HashMap::new();
    map.insert("hello", 1);
    map.insert("world", 2);

    for (key, val) in &map {
        println!("{key}: {val}");
    }
}`,
  },
  Go: {
    language: "go",
    code: `package main

import "fmt"

func quickSort(a []int) []int {
	if len(a) <= 1 {
		return a
	}
	p := a[0]
	var l, r []int
	for _, v := range a[1:] {
		if v <= p {
			l = append(l, v)
		} else {
			r = append(r, v)
		}
	}`,
  },
  "C++": {
    language: "cpp",
    code: `#include <vector>
#include <algorithm>
#include <iostream>

template <typename T>
T find_max(const std::vector<T>& v) {
    return *std::max_element(
        v.begin(), v.end());
}

int main() {
    std::vector<int> n = {3,1,4,1,5,9};
    std::cout << find_max(n);
    auto e = std::count_if(
        n.begin(), n.end(),
        [](int x) { return x % 2 == 0; });`,
  },
};

const LANG_KEYS = Object.keys(SAMPLES);
const LINES_PER_SNIPPET = 16;

interface EditorFontPreviewProps {
  fontFamily: string;
  fontSize?: number;
}

export default function EditorFontPreview({ fontFamily, fontSize = 13 }: EditorFontPreviewProps) {
  const [activeLang, setActiveLang] = useState("TypeScript");
  const [editorHeight, setEditorHeight] = useState(400);
  const sample = SAMPLES[activeLang];
  const lineHeight = Math.round(fontSize * 1.6);
  const workspaceCommands = useWorkspaceActions();

  const handleMount: OnMount = useCallback((editor) => {
    // Auto-size to content
    const contentHeight = editor.getContentHeight();
    setEditorHeight(contentHeight);
    editor.onDidContentSizeChange(() => {
      setEditorHeight(editor.getContentHeight());
    });
    editor.onDidFocusEditorWidget(() => {
      workspaceCommands.setLayoutTargetRuntimeId(null);
      workspaceCommands.setNavigationArea("workspace");
    });
  }, [workspaceCommands]);

  const options = useMemo(
    () => ({
      readOnly: true,
      domReadOnly: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      scrollbar: { vertical: "hidden" as const, horizontal: "hidden" as const, handleMouseWheel: false },
      fontFamily,
      fontSize,
      lineHeight,
      lineNumbers: "on" as const,
      renderLineHighlight: "none" as const,
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      overviewRulerBorder: false,
      folding: false,
      glyphMargin: false,
      wordWrap: "off" as const,
      contextmenu: false,
      cursorStyle: "line" as const,
      mouseWheelScrollSensitivity: 0,
    }),
    [fontFamily, fontSize, lineHeight],
  );

  return (
    <div className="w-full overflow-hidden rounded-lg border border-[var(--theme-border)]">
      <div className="flex border-b border-[var(--theme-border)] bg-[var(--theme-panel)]">
        {LANG_KEYS.map((lang) => (
          <button
            key={lang}
            onClick={() => setActiveLang(lang)}
            className={cn(
              "px-3 py-1.5 text-xs transition-colors",
              activeLang === lang
                ? "text-[var(--theme-text)] border-b border-[var(--theme-primary)]"
                : "text-[var(--theme-text-faint)] hover:text-[var(--theme-text-subtle)]",
            )}
          >
            {lang}
          </button>
        ))}
      </div>
      <div className="overflow-hidden" style={{ height: editorHeight }}>
        <Editor
          key={`${activeLang}-${fontFamily}-${fontSize}`}
          height={editorHeight}
          language={sample.language}
          value={sample.code}
          theme={MONACO_THEME_ID}
          beforeMount={pandoraMonacoBeforeMount}
          onMount={handleMount}
          options={options}
          loading={
            <div className="flex items-center justify-center text-xs text-[var(--theme-text-subtle)]" style={{ height: 300 }}>
              Loading...
            </div>
          }
        />
      </div>
    </div>
  );
}
