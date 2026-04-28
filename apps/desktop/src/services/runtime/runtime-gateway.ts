import { RuntimeClient } from "@/services/runtime/runtime-client";
import { runtimeEventBus } from "./runtime-event-queue";

let client: RuntimeClient | null = null;

export const runtimeGateway = {
  async connect(): Promise<void> {
    if (client) return;
    const created = new RuntimeClient((event) => runtimeEventBus.publish(event));
    client = created;
    try {
      await created.connect();
    } catch (cause) {
      client = null;
      console.error("Failed to connect runtime gateway:", cause);
    }
  },

  disconnect(): void {
    if (!client) return;
    client.disconnect();
    client = null;
  },

  getClient(): RuntimeClient | null {
    return client;
  },
};
