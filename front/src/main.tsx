import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { authProviderManager, GoogleAuthProvider, NodeService, IndexerService } from "hyli-wallet";
import { ConfigService } from "./services/ConfigService.ts";

// Initialize SDK services and register Google provider if configured
(() => {
    try {
        const GOOGLE_CLIENT_ID = ConfigService.getGoogleClientId();
        const NODE_URL = ConfigService.getNodeBaseUrl();
        const INDEXER_URL = ConfigService.getWalletServerBaseUrl();
        console.log("[Hyli] Config:", { GOOGLE_CLIENT_ID, NODE_URL, INDEXER_URL });
        if (NODE_URL) NodeService.initialize(NODE_URL);
        if (INDEXER_URL) IndexerService.initialize(INDEXER_URL);
        if (GOOGLE_CLIENT_ID) {
            authProviderManager.registerProvider(new GoogleAuthProvider(GOOGLE_CLIENT_ID));
            console.log("[Hyli] Google provider registered");

            // Load Google Identity Services and expose a helper to request an ID token
            const loadGsi = () =>
                new Promise<void>((resolve, reject) => {
                    if ((window as any).google?.accounts?.id) return resolve();
                    const s = document.createElement("script");
                    s.src = "https://accounts.google.com/gsi/client";
                    s.async = true;
                    s.defer = true;
                    s.onload = () => resolve();
                    s.onerror = () => reject(new Error("Failed to load Google Identity Services"));
                    document.head.appendChild(s);
                });

            // NOTE: 'account' doit être le username attendu par getNonce / Indexer
            (window as any).hyliRequestGoogleIdToken = async (): Promise<string> => {
                await loadGsi();

                const nonce = Date.now().toString(); // Nonce temporaire, remplacé plus tard par getNonce

                return new Promise<string>((resolve, reject) => {
                    try {
                        const google = (window as any).google;
                        let done = false;
                        google.accounts.id.initialize({
                            client_id: GOOGLE_CLIENT_ID,
                            callback: (resp: any) => {
                                if (resp?.credential && !done) {
                                    done = true;
                                    resolve(resp.credential as string);
                                }
                            },
                            ux_mode: "popup",
                            auto_select: true,
                            use_fedcm_for_prompt: false,
                            // IMPORTANT: on injecte le nonce retourné par getNonce
                            nonce,
                        });
                        console.log("[Hyli] GIS init with client_id:", GOOGLE_CLIENT_ID, "nonce:", nonce);

                        // Create a hidden container and render the official button (opens popup on click)
                        const container = document.createElement("div");
                        container.style.position = "fixed";
                        container.style.opacity = "0";
                        container.style.pointerEvents = "none";
                        container.style.bottom = "0";
                        container.style.right = "0";
                        document.body.appendChild(container);
                        google.accounts.id.renderButton(container, {
                            type: "standard",
                            theme: "outline",
                            size: "large",
                            text: "signin_with",
                            shape: "rectangular",
                        });
                        // Wait a tick for button to mount, then click it programmatically (user-initiated handler)
                        setTimeout(() => {
                            const btn = container.querySelector(
                                "div[role=button], div[aria-label]"
                            ) as HTMLElement | null;
                            if (!btn) {
                                try {
                                    document.body.removeChild(container);
                                } catch {}
                                return reject(new Error("Google button not rendered"));
                            }
                            // Make it clickable while still offscreen
                            container.style.pointerEvents = "auto";
                            btn.click();
                            // Clean up later if no callback
                            setTimeout(() => {
                                if (!done) {
                                    try {
                                        document.body.removeChild(container);
                                    } catch {}
                                    reject(new Error("Google popup was blocked or cancelled"));
                                }
                            }, 15000);
                        }, 0);
                    } catch (e) {
                        reject(e);
                    }
                });
            };
        } else {
            console.warn("[Hyli] Google provider NOT registered: missing GOOGLE_CLIENT_ID configuration");
        }
    } catch (e) {
        console.warn("Failed to initialize Google provider:", e);
    }
})();

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <App />
    </StrictMode>
);
