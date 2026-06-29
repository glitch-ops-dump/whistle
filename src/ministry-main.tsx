import React from "react";
import { createRoot } from "react-dom/client";
import AuthGate from "./AuthGate";
import MinistryOperationsConsole from "./MinistryOperationsConsole";
import "./ministry-operations-console.css";

function mount() {
  const root = document.getElementById("ministry-root");
  if (!root) return;
  createRoot(root).render(
    <React.StrictMode>
      <AuthGate
        surface="government"
        allowedRoles={["minister", "department_officer"]}
        defaultRole="minister"
        title="Ministry Login"
        subtitle="Department action dashboard"
      >
        <MinistryOperationsConsole />
      </AuthGate>
    </React.StrictMode>,
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount, { once: true });
} else {
  mount();
}
