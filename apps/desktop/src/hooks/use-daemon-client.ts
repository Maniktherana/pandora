import { Effect } from "effect";
import { useEffect } from "react";
import { useDesktopRuntime } from "@/hooks/use-bootstrap-desktop";
import { DaemonGateway } from "@/services/daemon/daemon-gateway";

export default function useDaemonClient() {
  const runtime = useDesktopRuntime();

  useEffect(() => {
    void runtime.runPromise(Effect.flatMap(DaemonGateway, (gateway) => gateway.connect()));

    return () => {
      void runtime.runPromise(Effect.flatMap(DaemonGateway, (gateway) => gateway.disconnect()));
    };
  }, [runtime]);
}
