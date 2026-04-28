import { useScmStore } from "./scm-store";
import type { RuntimeQueueEvent } from "@/services/runtime/runtime-event-queue";

export function isScmEvent(
  event: RuntimeQueueEvent,
): event is Extract<
  RuntimeQueueEvent,
  { type: "scm_snapshot" | "scm_refreshing" | "scm_operation_started" | "scm_error" }
> {
  return (
    event.type === "scm_snapshot" ||
    event.type === "scm_refreshing" ||
    event.type === "scm_operation_started" ||
    event.type === "scm_error"
  );
}

export function applyScmRuntimeEvent(event: RuntimeQueueEvent): void {
  switch (event.type) {
    case "scm_snapshot":
      useScmStore.getState().applySnapshot(event.runtimeId, event.snapshot);
      break;
    case "scm_refreshing":
      useScmStore.getState().setRefreshing(event.runtimeId, true);
      break;
    case "scm_operation_started":
      break;
    case "scm_error":
      useScmStore.getState().setError(event.runtimeId, event.message);
      break;
  }
}
