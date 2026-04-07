import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";

function Collapsible({ ...props }: CollapsiblePrimitive.Root.Props) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

function CollapsibleTrigger({ ...props }: CollapsiblePrimitive.Trigger.Props) {
  return <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />;
}

function CollapsibleContent({
  noTransition,
  style,
  ...props
}: CollapsiblePrimitive.Panel.Props & { noTransition?: boolean }) {
  return (
    <CollapsiblePrimitive.Panel
      data-slot="collapsible-content"
      style={
        noTransition ? { transitionDuration: "0ms", animationDuration: "0ms", ...style } : style
      }
      {...props}
    />
  );
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
