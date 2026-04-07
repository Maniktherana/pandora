import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { applyTheme } from "@/lib/theme";
import { defaultTheme } from "@/lib/theme";

applyTheme(defaultTheme);

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
