import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

import fs from "fs";
import path from "path";

// One day we'll figure out why this is necessary
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
    plugins: [react(), wasmContentTypePlugin()],
    optimizeDeps: {
        include: ["pino"],
        exclude: ["@aztec/bb.js"],
    },
});
