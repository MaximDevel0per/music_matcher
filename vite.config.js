import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Relative Pfade: nötig für GitHub Pages, wo die App unter
  // /<repo-name>/ liegt statt an der Domain-Wurzel.
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // shadcn-Konvention: Imports wie "@/components/ui/…"
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
