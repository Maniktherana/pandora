import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

type SimpleScripts = string[];
type NamedScripts = Array<{ name: string; command: string }>;

type ScriptEditorSectionProps =
  | {
      title: string;
      description: string;
      variant: "simple";
      scripts: SimpleScripts;
      onChange: (scripts: SimpleScripts) => void;
      autoRunToggle?: { checked: boolean; onChange: (v: boolean) => void };
    }
  | {
      title: string;
      description: string;
      variant: "named";
      scripts: NamedScripts;
      onChange: (scripts: NamedScripts) => void;
      autoRunToggle?: never;
    };

export default function ScriptEditorSection(props: ScriptEditorSectionProps) {
  const { title, description, variant, autoRunToggle } = props;

  return (
    <div className="rounded-lg border border-[var(--theme-border)] p-4 space-y-4">
      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-[var(--theme-text)]">{title}</h2>
        </div>
        <p className="mt-0.5 text-xs text-[var(--theme-text-subtle)]">{description}</p>
      </div>

      {autoRunToggle && (
        <div className="flex items-center justify-between">
          <div className="flex-1 pr-6">
            <span className="text-sm text-[var(--theme-text)]">Auto-run on workspace create</span>
          </div>
          <Switch checked={autoRunToggle.checked} onCheckedChange={autoRunToggle.onChange} />
        </div>
      )}

      <div className="space-y-2">
        {variant === "simple" ? (
          <>
            {props.scripts.map((script, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={script}
                  onChange={(e) => {
                    const next = [...props.scripts];
                    next[i] = (e.target as HTMLInputElement).value;
                    props.onChange(next);
                  }}
                  placeholder="e.g., npm install"
                  className="flex-1"
                  size="sm"
                />
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => {
                    const next = props.scripts.filter((_, idx) => idx !== i);
                    props.onChange(next);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5 text-[var(--theme-text-muted)]" />
                </Button>
              </div>
            ))}
            <Button
              variant="ghost"
              size="xs"
              onClick={() => props.onChange([...props.scripts, ""])}
              className="text-[var(--theme-text-subtle)] hover:text-[var(--theme-text)]"
            >
              <Plus className="h-3.5 w-3.5" />
              Add command
            </Button>
          </>
        ) : (
          <>
            {props.scripts.map((entry, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={entry.name}
                  onChange={(e) => {
                    const next = [...props.scripts];
                    next[i] = { ...next[i], name: (e.target as HTMLInputElement).value };
                    props.onChange(next);
                  }}
                  placeholder="Name"
                  className="w-[100px] shrink-0"
                  size="sm"
                />
                <Input
                  value={entry.command}
                  onChange={(e) => {
                    const next = [...props.scripts];
                    next[i] = { ...next[i], command: (e.target as HTMLInputElement).value };
                    props.onChange(next);
                  }}
                  placeholder="e.g., npm run dev"
                  className="flex-1"
                  size="sm"
                />
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => {
                    const next = props.scripts.filter((_, idx) => idx !== i);
                    props.onChange(next);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5 text-[var(--theme-text-muted)]" />
                </Button>
              </div>
            ))}
            <Button
              variant="ghost"
              size="xs"
              onClick={() => props.onChange([...props.scripts, { name: "", command: "" }])}
              className="text-[var(--theme-text-subtle)] hover:text-[var(--theme-text)]"
            >
              <Plus className="h-3.5 w-3.5" />
              Add command
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
