import { useEffect, useState } from "react";
import {
  areStringSetsEqual,
  mergeConnectedTerminalSlotIds,
} from "@/lib/terminal/lazy-terminal-connections";

export function useLazyTerminalSlotConnections(
  runtimeId: string,
  visibleSlotIds: readonly string[],
  liveSlotIds: readonly string[],
): ReadonlySet<string> {
  const [connectedSlotIds, setConnectedSlotIds] = useState<Set<string>>(
    () => new Set(visibleSlotIds),
  );

  useEffect(() => {
    setConnectedSlotIds(new Set(visibleSlotIds));
  }, [runtimeId]);

  useEffect(() => {
    setConnectedSlotIds((current) => {
      const next = mergeConnectedTerminalSlotIds(current, visibleSlotIds, liveSlotIds);
      return areStringSetsEqual(current, next) ? current : next;
    });
  }, [liveSlotIds, visibleSlotIds]);

  return connectedSlotIds;
}
