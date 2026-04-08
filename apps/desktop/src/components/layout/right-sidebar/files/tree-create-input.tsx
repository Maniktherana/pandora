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

export function TreeCreateInput({ kind, parentRelPath, depth, onConfirm, onCancel }: TreeCreateInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const committedRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
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
      commit(inputRef.current?.value ?? "");
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  };

  const handleBlur = () => {
    const value = inputRef.current?.value?.trim();
    if (value) {
      commit(value);
    } else {
      cancel();
    }
  };

  return (
    <div
      className="flex min-w-0 w-full items-center gap-2 rounded-md pr-2 text-xs"
      style={{ paddingLeft: TREE_ROW_PADDING_LEFT_PX + depth * TREE_ROW_INDENT_PX, height: TREE_ROW_HEIGHT_PX }}
    >
      <HugeiconsIcon
        icon={kind === "directory" ? Folder01Icon : File01Icon}
        strokeWidth={1.8}
        className="size-4 shrink-0 text-[var(--theme-text-subtle)]"
      />
      <Input
        ref={inputRef}
        type="text"
        className="h-5 min-w-0 flex-1 rounded-sm border-[var(--theme-interactive)] bg-transparent px-1 py-0 text-xs text-[var(--theme-text)] focus-visible:ring-0"
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
      />
    </div>
  );
}
