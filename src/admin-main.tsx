import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AdminConsole from "./AdminConsole";
import AuthGate from "./AuthGate";
import "./admin-console.css";

createRoot(document.getElementById("admin-root")!).render(
  <StrictMode>
    <AuthGate surface="government" allowedRoles={["admin"]} defaultRole="admin" title="Admin Login" subtitle="Whistle platform controls">
      <AdminConsole />
    </AuthGate>
  </StrictMode>,
);
