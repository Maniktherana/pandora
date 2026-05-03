import { parseDiffFromFile } from "@pierre/diffs";
import type { FileDiffMetadata } from "@pierre/diffs";

interface WorkerRequest {
  id: string;
  relativePath: string;
  original: string;
  modified: string;
}

interface WorkerResponse {
  id: string;
  diffMetadata?: FileDiffMetadata | null;
  parseError?: string;
}

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const { id, relativePath, original, modified } = event.data;
  let response: WorkerResponse;
  try {
    const diffMetadata = parseDiffFromFile(
      { name: relativePath, contents: original },
      { name: relativePath, contents: modified },
    );
    response = { id, diffMetadata };
  } catch (error) {
    response = { id, parseError: String(error) };
  }
  self.postMessage(response);
});
