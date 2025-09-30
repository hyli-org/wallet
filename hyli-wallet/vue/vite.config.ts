import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import dts from "unplugin-dts/vite";
//import analyzer from "vite-bundle-analyzer";

// https://vite.dev/config/
export default defineConfig({
    build: {
        lib: {
            entry: "src/lib.ts",
            name: "HyliWallet",
            fileName: (format) => `hyli-wallet.${format}.js`,
            formats: ["es", "cjs"],
        },
        rollupOptions: {
            external: ["hyli-noir", "vue"],
        },
        outDir: "dist",
        sourcemap: true,
        minify: true,
    },
    plugins: [vue(), dts({ tsconfigPath: "./tsconfig.app.json", processor: "vue" })],
});
