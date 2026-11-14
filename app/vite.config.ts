import { defineConfig } from "vite";

// Tauri serves the built files in production and this dev server during `tauri dev`.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "safari15", outDir: "dist", emptyOutDir: true },
});
