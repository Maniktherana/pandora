import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { applyTheme } from "@/lib/theme/theme";
import { defaultTheme } from "@/lib/theme/themes";

applyTheme(defaultTheme);

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
