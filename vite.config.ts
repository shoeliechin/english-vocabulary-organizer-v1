import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    // `npm run dev` runs the Worker on :8787 and Vite on :5173.
    proxy: { "/api": "http://localhost:8787" },
  },
  test: { include: ["worker/**/*.test.ts", "src/**/*.test.ts", "shared/**/*.test.ts"] },
});
