import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative Pfade: nötig für GitHub Pages, wo die App unter
  // /<repo-name>/ liegt statt an der Domain-Wurzel.
  base: "./",
  plugins: [react()],
});
