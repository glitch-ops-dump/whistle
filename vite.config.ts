import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        app: resolve(__dirname, "index.html"),
        citizen: resolve(__dirname, "citizen.html"),
        verification: resolve(__dirname, "verification.html"),
        dashboard: resolve(__dirname, "dashboard.html"),
        admin: resolve(__dirname, "admin.html"),
        local: resolve(__dirname, "local.html"),
        cmCell: resolve(__dirname, "cm-cell.html"),
        ministry: resolve(__dirname, "ministry.html"),
        mla: resolve(__dirname, "mla.html"),
        transparency: resolve(__dirname, "transparency.html"),
        workflow: resolve(__dirname, "workflow.html"),
      },
    },
  },
});
