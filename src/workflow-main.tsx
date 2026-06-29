import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import WorkflowInfographic from "./WorkflowInfographic";
import "./workflow-infographic.css";

createRoot(document.getElementById("workflow-root")!).render(
  <StrictMode>
    <WorkflowInfographic />
  </StrictMode>,
);
