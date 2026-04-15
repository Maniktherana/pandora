import { type KeyboardEvent, useEffect, useRef } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { File01Icon, Folder01Icon } from "@hugeicons/core-free-icons";
import { Input } from "@/components/ui/input";
import { TREE_ROW_HEIGHT_PX, TREE_ROW_INDENT_PX, TREE_ROW_PADDING_LEFT_PX } from "./files.types";

type TreeCreateInputProps = {
  kind: "file" | "directory";
  parentRelPath: string;
  depth: number;
  onConfirm: (name: string, kind: "file" | "directory", parentRelPath: string) => void;
  onCancel: () => void;
};

export function TreeCreateInput({
  kind,
  parentRelPath,
  depth,
  onConfirm,
  onCancel,
}: TreeCreateInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const committedRef = useRef(false);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    queueMicrotask(() => {
      el.focus();
    });
  }, []);

  const commit = (value: string) => {
    if (committedRef.current) return;
    committedRef.current = true;
    onConfirm(value, kind, parentRelPath);
  };

  const cancel = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCancel();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit(event.currentTarget.value);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  };

  const handleBlur = () => {
    if (committedRef.current) return;
    const value = inputRef.current?.value.trim() ?? "";
    if (value) {
      commit(value);
    } else {
      cancel();
    }
  };

  return (
    <div
      className="flex min-w-0 w-full items-center gap-2 rounded-md pr-2 text-xs"
      style={{
        paddingLeft: TREE_ROW_PADDING_LEFT_PX + depth * TREE_ROW_INDENT_PX,
        height: TREE_ROW_HEIGHT_PX,
      }}
    >
      <HugeiconsIcon
        icon={kind === "directory" ? Folder01Icon : File01Icon}
        strokeWidth={1.8}
        className="size-4 shrink-0 text-[var(--theme-text-subtle)]"
      />
      <Input
        ref={inputRef}
        unstyled
        nativeInput
        type="text"
        autoCorrect="off"
        autoCapitalize="off"
        autoComplete="off"
        spellCheck={false}
        className="h-5 min-h-0 flex-1 rounded-sm border border-[var(--theme-interactive)] px-1.5 text-xs leading-5 text-[var(--theme-text)] focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/40"
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
      />
    </div>
  );
}
