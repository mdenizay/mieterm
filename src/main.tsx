import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// Deliberately not wrapped in StrictMode. Its development double-mount runs every effect
// twice, which for this app means opening a terminal session, killing it, and opening
// another under the same id — a race against the backend that only exists in development.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
