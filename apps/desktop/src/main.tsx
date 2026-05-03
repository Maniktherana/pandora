import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import App from "./App";
import "./index.css";
import { applyTheme } from "@/lib/shared/theme";
import { defaultTheme } from "@/lib/shared/theme";
import { PandoraDiffWorkerPoolProvider } from "@/components/editor/pierre-pandora";

applyTheme(defaultTheme);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <PandoraDiffWorkerPoolProvider>
      <App />
    </PandoraDiffWorkerPoolProvider>
  </QueryClientProvider>,
);
