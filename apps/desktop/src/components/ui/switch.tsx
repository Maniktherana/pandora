import * as React from "react";
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "@/lib/shared/utils";

function Switch({
  className,
  ...props
}: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "group/switch peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent shadow-sm transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-interactive)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-panel)] disabled:cursor-not-allowed disabled:opacity-50 data-[checked]:bg-[var(--theme-interactive)] data-[unchecked]:bg-[var(--theme-border)]",
        className,
      )}
      {...props}
    >
      <SwitchThumb />
    </SwitchPrimitive.Root>
  );
}

function SwitchThumb({
  className,
  ...props
}: SwitchPrimitive.Thumb.Props) {
  return (
    <SwitchPrimitive.Thumb
      data-slot="switch-thumb"
      className={cn(
        "pointer-events-none block size-4 rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ease-in-out data-[checked]:translate-x-4 data-[unchecked]:translate-x-0.5",
        className,
      )}
      {...props}
    />
  );
}

export { Switch, SwitchThumb };
