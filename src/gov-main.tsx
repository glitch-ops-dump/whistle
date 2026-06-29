import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AuthGate from "./AuthGate";
import GovDashboard from "./GovDashboard";
import "./gov-dashboard.css";

createRoot(document.getElementById("gov-root")!).render(
  <StrictMode>
    <AuthGate
      surface="government"
      allowedRoles={["cm_cell", "minister", "department_officer", "mla", "councillor", "verification"]}
      defaultRole="cm_cell"
      title="Government Login"
      subtitle="Role-scoped dashboard"
    >
      <GovDashboard />
    </AuthGate>
  </StrictMode>,
);
