import React from "react";
import { createRoot } from "react-dom/client";

function ensureRoot(preferredId: string) {
  const existing = document.getElementById(preferredId) ?? document.getElementById("root") ?? document.getElementById("verification-root");
  if (existing) return existing;
  const fallback = document.createElement("div");
  fallback.id = preferredId;
  document.body.append(fallback);
  return fallback;
}

function isVerificationConsoleRoute() {
  const pathname = window.location.pathname.toLowerCase();
  return (
    pathname.endsWith("/verification.html") ||
    pathname.endsWith("/console.html") ||
    pathname.endsWith("/verify-console.html") ||
    pathname.includes("verification-console")
  );
}

function isLauncherRoute() {
  const pathname = window.location.pathname.toLowerCase();
  return pathname === "/" || pathname.endsWith("/index.html");
}

async function boot() {
  if (isLauncherRoute()) {
    await import("./launcher.css");
    const { default: Launcher } = await import("./Launcher");
    createRoot(ensureRoot("launcher-root")).render(
      <React.StrictMode>
        <Launcher />
      </React.StrictMode>,
    );
    return;
  }

  if (isVerificationConsoleRoute()) {
    await import("./verification-console.css");
    const { default: VerificationConsole } = await import("./VerificationConsole");
    createRoot(ensureRoot("verification-root")).render(
      <React.StrictMode>
        <VerificationConsole />
      </React.StrictMode>,
    );
    return;
  }

  await import("./styles.css");
  const { default: App } = await import("./App");
  createRoot(ensureRoot("root")).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void boot();
