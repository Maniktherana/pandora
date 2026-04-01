import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { applyOc2Theme } from "@/lib/theme/oc2";

applyOc2Theme();

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
