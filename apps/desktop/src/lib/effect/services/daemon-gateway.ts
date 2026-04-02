import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { invoke } from "@tauri-apps/api/core";
import { DaemonSendError } from "../errors";
import type { ClientMessage, DaemonMessage } from "@/lib/shared/types";
import { DaemonGateway, type DaemonGatewayService } from "./contracts";

function makeInitialView() {
  return {
    connectionState: "disconnected" as const,
    lastMessage: null as DaemonMessage | null,
  };
}

export function makeDaemonGatewayLive() {
  return Layer.effect(
    DaemonGateway,
    Effect.gen(function* () {
      const view = yield* SubscriptionRef.make(makeInitialView());

      const service: DaemonGatewayService = {
        view,
        connect: Effect.sync(() => {
          void SubscriptionRef.set(view, { ...makeInitialView(), connectionState: "connecting" });
        }),
        disconnect: Effect.sync(() => {
          void SubscriptionRef.set(view, makeInitialView());
        }),
        send: (workspaceId: string, message: ClientMessage) =>
          Effect.tryPromise({
            try: () =>
              invoke("daemon_send", {
                workspaceId,
                message: JSON.stringify(message),
              }),
            catch: (cause) =>
              new DaemonSendError({
                workspaceId,
                cause,
              }),
          }),
        input: (workspaceId: string, sessionID: string, data: string) =>
          service.send(workspaceId, { type: "input", sessionID, data }),
        resize: (workspaceId: string, sessionID: string, cols: number, rows: number) =>
          service.send(workspaceId, { type: "resize", sessionID, cols, rows }),
        openSessionInstance: (workspaceId: string, sessionDefID: string) =>
          service.send(workspaceId, { type: "open_session_instance", sessionDefID }),
      };

      return service;
    })
  );
}
