import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AuthGate from "./AuthGate";
import CmCellMockup from "./CmCellMockup";
import "./cm-cell-mockup.css";

function mountCmCellMockup() {
  const root = document.getElementById("cm-cell-root");
  if (!root) return;

  createRoot(root).render(
    <StrictMode>
      <AuthGate surface="government" allowedRoles={["cm_cell"]} defaultRole="cm_cell" title="CM Cell Login" subtitle="State escalation command center">
        <CmCellMockup />
      </AuthGate>
    </StrictMode>,
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountCmCellMockup, { once: true });
} else {
  mountCmCellMockup();
}
