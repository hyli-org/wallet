<script setup lang="ts">
import type { AuthProvider } from "hyli-wallet";
import type { ProviderOption } from "hyli-wallet";
import type { RegistrationStage, WalletEvent } from "hyli-wallet";
import type { PasswordAuthCredentials } from "hyli-wallet";
import type { GoogleAuthCredentials } from "hyli-wallet";
import { getAuthErrorMessage } from "hyli-wallet";
import { walletKey } from "../composables/useWallet";
import { computed, inject, ref, watch } from "vue";

type AuthStage =
    | "idle" // Initial state, no authentication in progress
    | RegistrationStage
    | "generating_proof" // Generating proof of password
    | "logged_in"
    | "error"; // An error occurred during authentication

interface AuthFormProps {
    provider: AuthProvider;
    mode: "login" | "register";
    /**
     * CSS class prefix for styling overrides. Default is 'hyli'
     */
    classPrefix?: string;
    /**
     * Call to close the modal after successful login or registration.
     */
    closeModal?: () => void;
    /**
     * Controls session key checkbox behavior:
     *  - true: force session key ON (checked, cannot change)
     *  - false: force session key OFF (do not show checkbox)
     *  - undefined: allow user to toggle checkbox
     */
    forceSessionKey?: boolean;

    /**
     * Use to prevent closing the modal while registering / logging in.
     */
    setLockOpen?: (lockOpen: boolean) => void;
}

const ZK_FUN_FACTS = [
    "ZKPs were invented in 1989 by Shafi Goldwasser, Silvio Micali, and Charles Rackoff.",
    "Zero-knowledge proofs are critical for privacy in blockchain and cryptocurrencies.",
    "You can prove you’re over 18 with a ZKP, without telling anyone your actual birthdate.",
    "ZKPs power privacy coins like Zcash, hiding transaction details from everyone except participants.",
    "zk-SNARKs (“succinct non-interactive arguments of knowledge”) are one of the most popular ZKP types.",
    "In 2022, Ethereum’s Vitalik Buterin called ZKPs “the future of Ethereum scaling.”",
    "Noir is the programming language we use for these client-side proofs.",
    "Reticulating splines.",
    "ZKPs are used for secure voting, to let people prove they voted (and voted once) without revealing who they voted for.",
    "ZKPs are pure math: no AI or machine learning involved, just logic and cryptography.",
    "The security of many ZKP systems relies on the hardness of mathematical problems, like factoring big numbers.",
    "Zero-knowledge proofs can be recursive: proving you proved something, without redoing the whole proof.",
    "The “zero-knowledge” part doesn’t mean “no information”. It means “no extra information.”",
    "How many times can you recursively prove you proved something?",
    "We’re composing proofs across the galaxy. Mars vibes only.",
    "ZK lets us check everything without seeing anything. No peeking!",
    "RISC Zero, SP1, Noir? We support them all. And more soon.",
    "Please stand by while Hyli makes blockchain less boring.",
    "Generating proof of vibes.",
];

function getRandomFact() {
    return ZK_FUN_FACTS[Math.floor(Math.random() * ZK_FUN_FACTS.length)]!;
}

function getRandomSalt() {
    return Math.random().toString(36).substring(2, 20);
}

const { provider, mode, classPrefix = "hyli", closeModal, forceSessionKey, setLockOpen } = defineProps<AuthFormProps>();

const { login, registerAccount: registerWallet, onWalletEvent, onError } = inject(walletKey)!;

const isLocalhost =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

const isGoogle = computed(() => provider.type === "google");
const credentials = ref<
    (PasswordAuthCredentials & { inviteCode: string }) | (GoogleAuthCredentials & { inviteCode: string })
>({
    username: "bob",
    ...(isGoogle.value
        ? ({ googleToken: "", inviteCode: isLocalhost ? "vip" : "" } as any)
        : ({ password: isLocalhost ? "hylisecure" : "", confirmPassword: isLocalhost ? "hylisecure" : "" } as any)),
    inviteCode: isLocalhost ? "vip" : "",
    salt: getRandomSalt(),
});
const error = ref("");
const isSubmitting = ref(false);
const stage = ref<AuthStage>("idle");
// Session key checkbox state logic
const autoSessionKey = ref(forceSessionKey === true ? true : true);
const funFact = ref(getRandomFact());

// If forceSessionKey changes, update autoSessionKey accordingly
watch(
    () => forceSessionKey,
    (newValue) => {
        autoSessionKey.value = newValue;
    }
);

/*
watchEffect(() => {
    if (stage.value === "logged_in" && closeModal) {
        const timer = setTimeout(() => {
            closeModal();
        }, 2000);
        return () => clearTimeout(timer);
    }
}, [stage, closeModal]);
*/

/*
useEffect(() => {
    let timer: NodeJS.Timeout | undefined;
    if (isSubmitting) {
        setFunFact(getRandomFact());
        timer = setInterval(() => {
            setFunFact(getRandomFact());
        }, 2000);
    }
    return () => {
        if (timer) clearInterval(timer);
    };
}, [isSubmitting]);
*/

const deriveStatusMessage = (stage: AuthStage): string => {
    switch (stage) {
        case "sending_blob":
            return "Sending transaction...";
        case "generating_proof":
            return "Generating client-side ZK proof of password...";
        case "sending_proof":
            return "Sending proof of password...";
        case "proof_sent":
            return "Waiting for transaction confirmation...";
        case "logged_in":
            return "Logged on successfully!";
        case "error":
            return "Error occurred";
        default:
            return "";
    }
};

const statusMessage = computed(() => deriveStatusMessage(stage.value));

const onWalletEventWithStage = (event: WalletEvent) => {
    if (event.message) {
        if (event.type === "custom" && event.message.includes("Generating proof of password")) {
            stage.value = "generating_proof";
        } else if (["sending_proof", "proof_sent", "logged_in"].includes(event.type)) {
            stage.value = event.type as AuthStage;
        }
    }
    if (onWalletEvent.value) onWalletEvent.value(event);
};

const onErrorWithStage = (err: Error) => {
    console.error("AuthForm error:", err);
    const errorDetails = getAuthErrorMessage(err);
    error.value = errorDetails.userMessage;
    stage.value = "idle";
    isSubmitting.value = false;
    if (onError.value) onError.value(err);
};

const handleGoogleSubmit = async () => {
    try {
        isSubmitting.value = true;
        stage.value = "sending_blob";

        const idToken = await (window as any).hyliRequestGoogleIdToken?.();
        if (!idToken) {
            error.value = "Google sign-in failed or was cancelled";
            isSubmitting.value = false;
            return;
        }

        console.log("[Hyli][AuthForm] received Google token", idToken);

        credentials.value.googleToken = idToken;

        if (mode == "login") {
            await login(
                provider.type as ProviderOption,
                {
                    googleToken: idToken,
                    inviteCode: credentials.value.inviteCode,
                    username: credentials.value.username,
                } as any,
                onWalletEventWithStage,
                onErrorWithStage,
                { registerSessionKey: autoSessionKey.value }
            );
        } else {
            await registerWallet(
                provider.type as ProviderOption,
                {
                    googleToken: idToken,
                    inviteCode: credentials.value.inviteCode,
                    username: credentials.value.username,
                } as any,
                onWalletEventWithStage,
                onErrorWithStage,
                { registerSessionKey: autoSessionKey.value }
            );
        }
    } catch (err) {
        const errorDetails = getAuthErrorMessage(err as Error);
        error.value = errorDetails.userMessage;
        stage.value = "idle";
        return;
    } finally {
        setLockOpen?.(false);
        isSubmitting.value = false;
    }
    if (!closeModal) return;
    await new Promise((resolve) => setTimeout(resolve, 2000));
    closeModal();
};

const handleSubmit = async (e: Event) => {
    e.preventDefault();
    error.value = "";

    const cred = credentials.value as PasswordAuthCredentials & { inviteCode: string };
    if (!cred.username) {
        error.value = "Please provide a username";
        return;
    }
    if (!cred.password) {
        error.value = "Please provide a password";
        return;
    }
    if (cred.password.length < 8) {
        error.value = "Password must be at least 8 characters long";
        return;
    }
    if (mode === "register" && cred.password !== cred.confirmPassword) {
        error.value = "Passwords do not match.";
        return;
    }
    if (mode === "register" && !cred.inviteCode) {
        error.value = "Invite code is required.";
        return;
    }
    isSubmitting.value = true;
    stage.value = "sending_blob";
    const authAction = async (
        provider: ProviderOption,
        credentials:
            | (PasswordAuthCredentials & { inviteCode: string })
            | (GoogleAuthCredentials & { inviteCode: string })
    ) => {
        console.log("[Hyli][AuthForm] submit", {
            provider,
            mode,
            username: cred.username,
            hasGoogleToken: Boolean(cred.googleToken),
        });

        if (mode === "login") {
            await login(provider, credentials, onWalletEventWithStage, onErrorWithStage, {
                registerSessionKey: autoSessionKey.value,
            });
        } else if (mode === "register") {
            let finalCreds = cred;
            console.log("[Hyli][AuthForm] registering with credentials", {
                ...finalCreds,
                googleToken: Boolean(finalCreds.googleToken),
            });
            await registerWallet(provider, finalCreds, onWalletEventWithStage, onErrorWithStage, {
                registerSessionKey: autoSessionKey.value,
            });
        }
    };
    try {
        setLockOpen?.(true);
        await authAction(provider.type as ProviderOption, cred);
    } catch (err) {
        const errorDetails = getAuthErrorMessage(err as Error);
        error.value = errorDetails.userMessage;
        stage.value = "idle";
        return;
    } finally {
        setLockOpen?.(false);
        isSubmitting.value = false;
    }
    if (!closeModal) return;
    await new Promise((resolve) => setTimeout(resolve, 2000));
    closeModal();
};
</script>

<template>
    <div :class="`${classPrefix}-auth-form-container`" style="position: relative">
        <!-- Loading Modal-Within-Modal -->
        <div
            v-if="['sending_blob', 'generating_proof', 'sending_proof', 'proof_sent'].includes(stage)"
            :class="`${classPrefix}-loading-modal-overlay`"
        >
            <div style="margin-bottom: 24px">
                <div
                    :class="`${classPrefix}-spinner`"
                    style="
                        border: 4px solid #eee;
                        border-top: 4px solid #0077ff;
                        border-radius: 50%;
                        width: 48px;
                        height: 48px;
                        animation: spin 1s linear infinite;
                        margin: 0 auto 16px auto;
                    "
                />
                <div style="text-align: center; font-weight: 600; font-size: 18px; margin-bottom: 8px">
                    {{ statusMessage || "Processing..." }}
                </div>
                <div style="text-align: center; color: #666; font-size: 14px; margin-bottom: 8px">
                    Please wait while we work our ZK magic...
                </div>
            </div>

            <div :class="`${classPrefix}-zk-fun-fact`">
                <span role="img" aria-label="lightbulb" style="margin-right: 6px">💡</span>
                {{ funFact }}
            </div>
        </div>

        <div
            v-if="stage === 'logged_in'"
            :class="`${classPrefix}-success-message`"
            style="text-align: center; padding: 32px"
            @click="closeModal"
        >
            <div style="font-size: 48px; color: #4bb543; margin-bottom: 16px">✓</div>
            <div style="font-size: 20px; font-weight: 600; margin-bottom: 8px">Login successful!</div>
            <div style="color: #666; margin-bottom: 16px">You are now logged in. Redirecting...</div>
        </div>

        <form v-else @submit.prevent="handleSubmit" :class="`${classPrefix}-auth-form`">
            <div :class="`${classPrefix}-form-group`">
                <label for="username" :class="`${classPrefix}-form-label`">Username</label>
                <input
                    id="username"
                    name="username"
                    type="text"
                    :value="credentials.username"
                    placeholder="Enter your username"
                    :disabled="isSubmitting"
                    :class="`${classPrefix}-form-input`"
                />
            </div>

            <div v-if="!isGoogle" :class="`${classPrefix}-form-group`">
                <label for="password" :class="`${classPrefix}-form-label`">Password</label>
                <input
                    id="password"
                    name="password"
                    type="password"
                    :value="(credentials as any).password"
                    placeholder="Enter your password (min. 8 characters)"
                    :disabled="isSubmitting"
                    :class="`${classPrefix}-form-input`"
                />
            </div>

            <template v-if="mode === 'register' && !isGoogle">
                <div :class="`${classPrefix}-form-group`">
                    <label for="confirmPassword" :class="`${classPrefix}-form-label`">Confirm Password</label>
                    <input
                        id="confirmPassword"
                        name="confirmPassword"
                        type="password"
                        :value="(credentials as any).confirmPassword"
                        placeholder="Confirm your password (min. 8 characters)"
                        :disabled="isSubmitting"
                        :class="`${classPrefix}-form-input`"
                    />
                </div>
            </template>

            <div v-if="mode === 'register'" :class="`${classPrefix}-form-group`">
                <label for="inviteCode" :class="`${classPrefix}-form-label`">Invite Code</label>
                <input
                    id="inviteCode"
                    name="inviteCode"
                    type="text"
                    :value="(credentials as any).inviteCode"
                    placeholder="Enter your invite code"
                    :disabled="isSubmitting"
                    :class="`${classPrefix}-form-input`"
                />
            </div>

            <!-- Session Key Checkbox Logic -->
            <div v-if="forceSessionKey !== false" :class="`${classPrefix}-form-group`">
                <label for="autoSessionKey" style="display: flex; flex-direction: row; align-items: center">
                    <input
                        id="autoSessionKey"
                        name="autoSessionKey"
                        type="checkbox"
                        :checked="autoSessionKey"
                        :disabled="isSubmitting || forceSessionKey === true"
                        style="margin-right: 8px; height: 1.4em; width: 1.4em"
                    />
                    <span v-if="forceSessionKey === true">Session key will be created (required)</span>
                    <span v-else>Create a session key for this website</span>
                </label>
            </div>

            <div v-if="isGoogle" :class="`${classPrefix}-form-group`">
                <button
                    type="button"
                    :class="`${classPrefix}-auth-submit-button`"
                    @click="handleGoogleSubmit"
                    :disabled="isSubmitting"
                >
                    {{
                        mode == "login"
                            ? isSubmitting
                                ? "Requesting Google token..."
                                : "Sign in with Google"
                            : "Bind Account with Google"
                    }}
                </button>
            </div>

            <div v-if="error" :class="`${classPrefix}-error-message`">{{ error }}</div>
            <div v-if="statusMessage" :class="`${classPrefix}-status-message`">{{ statusMessage }}</div>

            <button
                v-if="!isGoogle"
                type="submit"
                :class="`${classPrefix}-auth-submit-button`"
                :disabled="isSubmitting"
            >
                {{ isSubmitting ? "Processing..." : mode === "login" ? "Login" : "Create Account" }}
            </button>
        </form>
    </div>
</template>

<style scoped>
.hyli-auth-form {
    display: flex;
    flex-direction: column;
    gap: 16px;
    width: 100%;
}

.hyli-form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.hyli-form-group label {
    font-size: 14px;
    font-weight: 500;
    color: #333;
}

.hyli-form-label {
    font-size: 14px;
    font-weight: 500;
    color: #333;
    display: block;
    margin-bottom: 6px;
}

.hyli-form-group input {
    padding: 12px 16px;
    border-radius: 8px;
    border: 1px solid #e0e0e0;
    font-size: 16px;
    transition: border-color 0.2s ease;
    color: #333;
}

.hyli-form-input {
    padding: 12px 16px;
    border-radius: 8px;
    border: 1px solid #e0e0e0;
    font-size: 16px;
    transition: border-color 0.2s ease;
    width: 100%;
    box-sizing: border-box;
    color: #333;
}

.hyli-form-group input:focus {
    border-color: #007bff;
    outline: none;
    box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.1);
}

.hyli-form-input:focus {
    border-color: #007bff;
    outline: none;
    box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.1);
}

.hyli-form-group input::placeholder {
    color: #aaa;
}

.hyli-form-input::placeholder {
    color: #aaa;
}

.hyli-form-group input:disabled {
    background-color: #f5f5f5;
    cursor: not-allowed;
}

.hyli-form-input:disabled {
    background-color: #f5f5f5;
    cursor: not-allowed;
}

.hyli-error-message {
    color: #dc3545;
    font-size: 14px;
    padding: 8px;
    border-radius: 4px;
    background-color: rgba(220, 53, 69, 0.1);
}

.hyli-status-message {
    color: #0077ff;
    font-size: 14px;
}

.hyli-auth-submit-button {
    margin-top: 8px;
    padding: 14px 20px;
    background-color: #0077ff;
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
}

.hyli-auth-submit-button:hover {
    background-color: #0066dd;
    transform: translateY(-1px);
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
}

.hyli-auth-submit-button:active {
    background-color: #0055cc;
    transform: translateY(1px);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.hyli-auth-submit-button:disabled {
    background-color: #cccccc;
    cursor: not-allowed;
    transform: none;
    box-shadow: none;
}

.hyli-loading-modal-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(255, 255, 255, 1);
    border-radius: 12px;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    animation: fadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes spin {
    0% {
        transform: rotate(0deg);
    }
    100% {
        transform: rotate(360deg);
    }
}

.hyli-spinner {
    border: 4px solid #eee;
    border-top: 4px solid #0077ff;
    border-radius: 50%;
    width: 48px;
    height: 48px;
    animation: spin 1s linear infinite;
    margin: 0 auto 16px auto;
}

.hyli-zk-fun-fact {
    padding: 16px 20px;
    color: #000;
    font-size: 15px;
    max-width: 320px;
    text-align: center;
}

.dark .hyli-form-group label,
.dark .hyli-form-label {
    color: #f3f3f3;
}

.dark .hyli-form-group input,
.dark .hyli-form-input {
    background: #23232a;
    color: #f3f3f3;
    border: 1px solid #333;
}

.dark .hyli-form-group input:focus,
.dark .hyli-form-input:focus {
    border-color: #ff594b;
    box-shadow: 0 0 0 3px rgba(255, 89, 75, 0.12);
}

.dark .hyli-form-group input::placeholder,
.dark .hyli-form-input::placeholder {
    color: #888;
}

.dark .hyli-form-group input:disabled,
.dark .hyli-form-input:disabled {
    background-color: #18181c;
    color: #888;
}

.dark .hyli-error-message {
    color: #ff8a80;
    background-color: rgba(255, 89, 75, 0.08);
}

.dark .hyli-status-message {
    color: #80bfff;
}

.dark .hyli-auth-submit-button {
    background-color: #ff594b;
    color: #fff;
}

.dark .hyli-auth-submit-button:hover {
    background-color: #ff9660;
}

.dark .hyli-auth-submit-button:active {
    background-color: #ff594b;
}

.dark .hyli-auth-submit-button:disabled {
    background-color: #444;
    color: #888;
}

.dark .hyli-loading-modal-overlay {
    background: rgba(24, 24, 28, 0.98);
}

.dark .hyli-spinner {
    border: 4px solid #333;
    border-top: 4px solid #ff594b;
}

.dark .hyli-zk-fun-fact {
    color: #f3f3f3;
}
</style>
