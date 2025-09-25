import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import fs from "fs";
import path from "path";
// @ts-expect-error
import dts from "unplugin-dts/vite";
//import analyzer from "vite-bundle-analyzer";

const wasmContentTypePlugin = () => ({
    name: "wasm-content-type-plugin",
    configureServer(server: any) {
        server.middlewares.use((req: any, res: any, next: any) => {
            const wasm_map = {
                "/node_modules/.vite/deps/acvm_js_bg.wasm": "node_modules/@noir-lang/acvm_js/web/",
                "/node_modules/.vite/deps/noirc_abi_wasm_bg.wasm": "node_modules/@noir-lang/noirc_abi/web/",
            } as const;
            if (req.url.endsWith(".wasm") && req.url in wasm_map) {
                const wasmPath = path.join(
                    __dirname,
                    wasm_map[req.url as keyof typeof wasm_map],
                    path.basename(req.url)
                );

                const wasmFile = fs.readFileSync(wasmPath);
                res.setHeader("Content-Type", "application/wasm");
                res.end(wasmFile);
                return;
            }
            next();
        });
    },
});

// https://vite.dev/config/
export default defineConfig({
    optimizeDeps: {
        include: ["hyli-noir"],
    },
    resolve: {
        dedupe: ["hyli-noir"], // prevents duplicate instances (React-style issues)
        // preserveSymlinks: true // try this if you're using pnpm/yarn workspaces and symlinks
    },
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
    plugins: [vue(), wasmContentTypePlugin(), dts({ tsconfigPath: "./tsconfig.app.json", processor: "vue" })],
});
