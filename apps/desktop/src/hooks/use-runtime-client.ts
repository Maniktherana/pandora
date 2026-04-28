import { useEffect } from "react";
import { runtimeGateway } from "@/services/runtime/runtime-gateway";

export default function useRuntimeClient() {
  useEffect(() => {
    void runtimeGateway.connect();
    return () => {
      runtimeGateway.disconnect();
    };
  }, []);
}
