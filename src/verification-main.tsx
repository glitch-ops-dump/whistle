import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AuthGate from "./AuthGate";
import VerificationConsole from "./VerificationConsole";
import "./verification-console.css";

createRoot(document.getElementById("verification-root")!).render(
  <StrictMode>
    <AuthGate surface="government" allowedRoles={["verification"]} defaultRole="verification" title="Verification Login" subtitle="Ticket intake and routing">
      <VerificationConsole />
    </AuthGate>
  </StrictMode>,
);
