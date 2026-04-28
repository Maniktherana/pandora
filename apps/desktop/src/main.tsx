import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./index.css";
import { applyTheme } from "@/lib/theme";
import { defaultTheme } from "@/lib/theme";
import { PandoraDiffWorkerPoolProvider } from "@/components/editor/pierre-pandora";

applyTheme(defaultTheme);

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <PandoraDiffWorkerPoolProvider>
      <App />
    </PandoraDiffWorkerPoolProvider>
  </QueryClientProvider>,
);
