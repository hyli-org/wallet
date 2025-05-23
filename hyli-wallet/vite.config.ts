import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dts from "vite-plugin-dts";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
//import analyzer from "vite-bundle-analyzer";

export default defineConfig({
    build: {
        lib: {
            entry: "src/index.ts",
            name: "HyliWallet",
            fileName: (format) => `hyli-wallet.${format}.js`,
            formats: ["es", "cjs"],
        },
        rollupOptions: {
            external: ["hyli-check-secret", "react", "react-dom"],
            output: {
                globals: {
                    react: "React",
                    "react-dom": "ReactDOM",
                },
            },
        },
        outDir: "dist",
        sourcemap: true,
        minify: true,
    },
    plugins: [
        react(),
        dts({
            entryRoot: "src",
            insertTypesEntry: true,
        }),
        cssInjectedByJsPlugin(),
        //analyzer(),
    ],
});
