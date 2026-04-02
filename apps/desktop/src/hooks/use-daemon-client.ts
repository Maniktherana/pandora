import { Effect } from "effect";
import { useEffect } from "react";
import { useAppRuntime } from "@/hooks/use-app-runtime";
import { DaemonGateway } from "@/lib/effect/services/daemon-gateway";

export default function useDaemonClient() {
  const runtime = useAppRuntime();

  useEffect(() => {
    void runtime.runPromise(
      Effect.flatMap(DaemonGateway, (gateway) => gateway.connect())
    );

    return () => {
      void runtime.runPromise(
        Effect.flatMap(DaemonGateway, (gateway) => gateway.disconnect())
      );
    };
  }, [runtime]);
}
