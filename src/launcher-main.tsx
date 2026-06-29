import React from "react";
import { createRoot } from "react-dom/client";
import Launcher from "./Launcher";
import "./launcher.css";

createRoot(document.getElementById("launcher-root")!).render(
  <React.StrictMode>
    <Launcher />
  </React.StrictMode>,
);
