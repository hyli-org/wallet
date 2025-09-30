import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import path from "path";
import fs from "fs";

// Fix for vite dev to serve wasm correctly
// The path rewrite might not be necessary if we exclude noir-lang, however it's easier like this.
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
    plugins: [
        // Polyfill for buffer is required for bb.js
        nodePolyfills({
            include: [],
            globals: {
                Buffer: true,
                global: false,
                process: false,
            },
        }),
        vue(),
        wasmContentTypePlugin(),
    ],
    // Required for web worker import in vite.
    optimizeDeps: {
        include: ["pino"],
        exclude: ["@aztec/bb.js"],
    },
});
