import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import AuthGate from "./AuthGate";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthGate surface="citizen" title="Citizen Login" subtitle="Raise and track complaints">
      {(session) => <App authSession={session} />}
    </AuthGate>
  </React.StrictMode>,
);
