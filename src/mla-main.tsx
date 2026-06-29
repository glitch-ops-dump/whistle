import React from "react";
import { createRoot } from "react-dom/client";
import AuthGate from "./AuthGate";
import MlaDashboard from "./MlaDashboard";
import "./mla-dashboard.css";

function mount() {
  const root = document.getElementById("mla-root");
  if (!root) return;
  createRoot(root).render(
    <React.StrictMode>
      <AuthGate surface="government" allowedRoles={["mla"]} defaultRole="mla" title="MLA Login" subtitle="Constituency issue closure">
        <MlaDashboard />
      </AuthGate>
    </React.StrictMode>,
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount, { once: true });
} else {
  mount();
}
