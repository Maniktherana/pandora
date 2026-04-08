import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/shared/utils";

type ToggleGroupType = "single" | "multiple";

type ToggleGroupContextValue = {
  type: ToggleGroupType;
  value: string | string[] | undefined;
  disabled: boolean;
  variant: NonNullable<VariantProps<typeof toggleGroupItemVariants>["variant"]>;
  size: NonNullable<VariantProps<typeof toggleGroupItemVariants>["size"]>;
  onItemToggle: (itemValue: string) => void;
};

const ToggleGroupContext = React.createContext<ToggleGroupContextValue | null>(null);

const toggleGroupVariants = cva(
  "inline-flex items-center rounded-md border border-[var(--theme-code-surface-separator)] bg-[var(--theme-panel)] p-0.5",
  {
    variants: {
      size: {
        default: "gap-0.5",
        sm: "gap-0.5",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

const toggleGroupItemVariants = cva(
  "inline-flex items-center justify-center rounded-sm border border-transparent font-medium whitespace-nowrap transition-colors outline-none disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "text-muted-foreground hover:text-foreground data-[state=on]:border-border data-[state=on]:bg-background data-[state=on]:text-foreground",
        diff:
          "text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] data-[state=on]:border-[var(--theme-code-diff-modified-base)] data-[state=on]:bg-[var(--theme-code-diff-modified-fill)] data-[state=on]:text-[var(--theme-text)]",
      },
      size: {
        default: "h-7 px-2.5 text-xs/relaxed",
        sm: "h-6 px-2 text-xs/relaxed",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function toggleMultipleValue(currentValue: string[] | undefined, nextValue: string): string[] {
  if (currentValue?.includes(nextValue)) {
    return currentValue.filter((value) => value !== nextValue);
  }

  return [...(currentValue ?? []), nextValue];
}

type ToggleGroupProps = Omit<React.ComponentProps<"div">, "defaultValue" | "onChange"> &
  VariantProps<typeof toggleGroupItemVariants> & {
    type?: ToggleGroupType;
    value?: string | string[];
    defaultValue?: string | string[];
    onValueChange?: (value: string | string[]) => void;
    disabled?: boolean;
  };

function ToggleGroup({
  className,
  type = "single",
  value,
  defaultValue,
  onValueChange,
  disabled = false,
  variant = "default",
  size = "default",
  ...props
}: ToggleGroupProps) {
  const resolvedVariant = variant ?? "default";
  const resolvedSize = size ?? "default";
  const [uncontrolledValue, setUncontrolledValue] = React.useState<string | string[] | undefined>(
    defaultValue,
  );

  const currentValue = value ?? uncontrolledValue;

  const handleItemToggle = React.useCallback(
    (itemValue: string) => {
      const nextValue =
        type === "multiple"
          ? toggleMultipleValue(Array.isArray(currentValue) ? currentValue : undefined, itemValue)
          : itemValue;

      if (value === undefined) {
        setUncontrolledValue(nextValue);
      }

      onValueChange?.(nextValue);
    },
    [currentValue, onValueChange, type, value],
  );

  const contextValue = React.useMemo(
    () => ({
      type,
      value: currentValue,
      disabled,
      variant: resolvedVariant,
      size: resolvedSize,
      onItemToggle: handleItemToggle,
    }),
    [currentValue, disabled, handleItemToggle, resolvedSize, resolvedVariant, type],
  );

  return (
    <ToggleGroupContext.Provider value={contextValue}>
      <div
        data-slot="toggle-group"
        role={type === "single" ? "radiogroup" : "group"}
        className={cn(toggleGroupVariants({ size: resolvedSize }), className)}
        {...props}
      />
    </ToggleGroupContext.Provider>
  );
}

type ToggleGroupItemProps = React.ComponentProps<"button"> & {
  value: string;
};

function ToggleGroupItem({ className, value, disabled, ...props }: ToggleGroupItemProps) {
  const context = React.useContext(ToggleGroupContext);

  if (!context) {
    throw new Error("ToggleGroupItem must be used within ToggleGroup");
  }

  const selected = Array.isArray(context.value)
    ? context.value.includes(value)
    : context.value === value;

  return (
    <button
      type="button"
      data-slot="toggle-group-item"
      data-state={selected ? "on" : "off"}
      role={context.type === "single" ? "radio" : undefined}
      aria-checked={context.type === "single" ? selected : undefined}
      aria-pressed={context.type === "multiple" ? selected : undefined}
      disabled={context.disabled || disabled}
      className={cn(toggleGroupItemVariants({ variant: context.variant, size: context.size }), className)}
      onClick={() => context.onItemToggle(value)}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem };
