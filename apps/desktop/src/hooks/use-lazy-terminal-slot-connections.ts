import { useEffect, useState } from "react";
import {
  areStringSetsEqual,
  mergeConnectedTerminalSlotIds,
} from "@/lib/shared/terminal/lazy-connections";

export function useLazyTerminalSlotConnections(
  scopeId: string,
  visibleSlotIds: readonly string[],
  liveSlotIds: readonly string[],
): ReadonlySet<string> {
  const [connectedSlotIds, setConnectedSlotIds] = useState<Set<string>>(
    () => new Set(visibleSlotIds),
  );

  useEffect(() => {
    setConnectedSlotIds(new Set(visibleSlotIds));
  }, [scopeId]);

  useEffect(() => {
    setConnectedSlotIds((current) => {
      const next = mergeConnectedTerminalSlotIds(current, visibleSlotIds, liveSlotIds);
      return areStringSetsEqual(current, next) ? current : next;
    });
  }, [liveSlotIds, visibleSlotIds]);

  return connectedSlotIds;
}
