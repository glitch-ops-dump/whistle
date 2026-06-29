import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import PublicTransparency from "./PublicTransparency";
import "./public-transparency.css";

createRoot(document.getElementById("transparency-root")!).render(
  <StrictMode>
    <PublicTransparency />
  </StrictMode>,
);
