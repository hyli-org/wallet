import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    target: "esnext",
  },
  optimizeDeps: {
    esbuildOptions: { target: "esnext" },
    exclude: ["@noir-lang/noirc_abi", "@noir-lang/acvm_js", "crypto"],
  },
});
