/// <reference types="vitest/config" />
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Kong (localhost:8000) định tuyến /api/<service>/...; proxy giữ cùng origin như apps/web.
const KONG_URL = "http://localhost:8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: { "/api": { target: KONG_URL, changeOrigin: true } },
  },
  preview: { port: 5174, strictPort: true },
  test: {
    environment: "node",
    include: ["src/**/*.spec.{ts,tsx}"],
    passWithNoTests: true,
  },
});
