import React from "react";
import { createRoot } from "react-dom/client";
import AuthGate from "./AuthGate";
import LocalOwnerConsole from "./LocalOwnerConsole";
import "./local-owner-console.css";

function mount() {
  const root = document.getElementById("local-root");
  if (!root) return;
  createRoot(root).render(
    <React.StrictMode>
      <AuthGate surface="government" allowedRoles={["councillor"]} defaultRole="councillor" title="Local Owner Login" subtitle="Ward issue closure">
        <LocalOwnerConsole />
      </AuthGate>
    </React.StrictMode>,
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount, { once: true });
} else {
  mount();
}
