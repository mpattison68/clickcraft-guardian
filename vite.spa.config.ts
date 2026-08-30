import { tanstackRouter } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Standalone SPA build used by the Docker image.
 * Output: dist/spa (served as static files by the Node API container).
 */
export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: false }),
    react(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  define: {
    "import.meta.env.VITE_SPA_MODE": JSON.stringify("true"),
  },
  build: {
    outDir: "dist/spa",
    emptyOutDir: true,
    sourcemap: false,
  },
});
