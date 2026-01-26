  import { createRoot } from "react-dom/client";
  import App from "./app/App.tsx";
  import "./styles/index.css";
import { BrowserRouter } from "react-router";
import { StrictMode } from "react";


  createRoot(document.getElementById("root")!).render(<StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>);