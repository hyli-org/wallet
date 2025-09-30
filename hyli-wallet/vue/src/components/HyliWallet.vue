<script setup lang="ts">
import { authProviderManager } from "hyli-wallet";
import type { ProviderOption } from "hyli-wallet";
import AuthForm from "./AuthForm.vue";

import { computed, onMounted, onUnmounted, ref } from "vue";
import { useWalletInternal } from "../lib";

// TODO: share this with react
// NB: the react props are slots in vue, so skipped here.
interface HyliWalletProps {
    /**
     * Optional explicit provider list (e.g., ["password", "google"]). If omitted, available providers will be detected automatically.
     */
    providers?: ProviderOption[];
    /**
     * CSS class prefix for styling overrides. Default is 'hyli'
     */
    classPrefix?: string;
    /**
     * Control modal open state from parent component
     */
    isOpen?: boolean;
    /**
     * Callback when modal should close
     */
    onClose?: () => void;
    /**
     * Default authentication mode when a provider is selected
     * 'login' - Show login form (default)
     * 'register' - Show registration form
     */
    defaultAuthMode?: "login" | "register";
}

const {
    providers,
    classPrefix = "hyli",
    isOpen: controlledIsOpen,
    onClose: controlledOnClose,
    defaultAuthMode = "login",
} = defineProps<HyliWalletProps>();

const { wallet, logout, forceSessionKey } = useWalletInternal();

console.log("HyliWallet component mounted with props:", { defaultAuthMode, providers });

const internalIsOpen = ref(false);

// Use controlled state if provided, otherwise use internal state
const isOpen = computed(() => controlledIsOpen || internalIsOpen.value);

const selectedProvider = ref<ProviderOption | null>(null);
const showLogin = ref(defaultAuthMode === "login");

const isDarkMode = ref(false);

// To prevent closing while registering or logging in
const lockOpen = ref(false);

// Get available providers dynamically
const availableProviders = computed(() => authProviderManager.getAvailableProviders() as ProviderOption[]);

const mq = window.matchMedia("(prefers-color-scheme: dark)");
const handler = (e: MediaQueryListEvent) => (isDarkMode.value = e.matches);
onMounted(() => {
    isDarkMode.value = mq.matches;
    mq.addEventListener("change", handler);
});
onUnmounted(() => mq.removeEventListener("change", handler));

const handleButtonClick = () => {
    if (wallet.value) {
        logout();
    } else {
        if (!controlledIsOpen) {
            internalIsOpen.value = true;
        }
        // If controlled, parent should handle opening via isOpen prop
    }
};

const closeModal = () => {
    if (lockOpen.value) {
        return;
    }
    if (!controlledIsOpen) {
        internalIsOpen.value = false;
    }
    if (controlledOnClose) {
        controlledOnClose();
    }
    selectedProvider.value = null;
    showLogin.value = defaultAuthMode === "login";
};
</script>

<template>
    <!-- Trigger button (supports optional render-prop-ish `button` or falls back to default) -->
    <div>
        <slot name="button" :onClick="handleButtonClick">
            <button :class="`${classPrefix}-btn`" @click="handleButtonClick">
                {{ wallet ? "Log Out" : "Connect Wallet" }}
            </button>
        </slot>
    </div>

    <!-- Modal portal -->
    <teleport to="body">
        <div v-if="isOpen" :class="[`${classPrefix}-overlay`, isDarkMode ? 'dark' : '']" @click="closeModal">
            <div :class="`${classPrefix}-modal`" @click.stop>
                <!-- Header / draggable handle -->
                <div :class="`${classPrefix}-modal-header`">
                    <div :class="`${classPrefix}-modal-logo`">
                        <!-- Logo SVG (kept from original) -->
                        <svg
                            width="120"
                            height="28"
                            viewBox="0 0 931 218"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                        >
                            <path
                                d="M438.309 64.7635C438.265 64.8332 438.222 64.9034 438.178 64.9733C433.718 72.0845 423.337 71.9325 419.169 64.646C419.13 64.5764 419.09 64.506 419.05 64.4361L379.267 0H314.541L374.846 99.1073C377.373 103.033 382.212 110.013 389.37 120.042C395.261 128.984 398.946 135.742 400.422 140.32V156.022L400.106 217.186H456.938V156.022C456.938 152.536 456.829 149.592 456.622 147.19V140.32C457.885 135.962 461.566 129.2 467.674 120.042L471.461 114.808C472.724 113.065 474.51 110.556 476.83 107.285C479.144 104.013 480.934 101.29 482.197 99.1073L542.502 0H477.462L438.309 64.7635Z"
                                fill="#FFFFFF"
                            />
                            <path
                                d="M636.271 0H579.756V217.187H805.769V164.853H647.325C641.22 164.853 636.271 159.905 636.271 153.8V0Z"
                                fill="#FFFFFF"
                            />
                            <path d="M930.193 0H873.678V217.187H930.193V0Z" fill="#FFFFFF" />
                            <path
                                d="M216.082 82.4269H68.1538C62.0491 82.4269 57.1002 77.4778 57.1002 71.3733V0H0.609375V217.187H57.1002V145.814C57.1002 139.709 62.0492 134.76 68.1538 134.76H216.082C222.187 134.76 227.136 139.709 227.136 145.814V217.187H283.916V0H227.136V71.3733C227.136 77.4779 222.187 82.4269 216.082 82.4269Z"
                                fill="#FFFFFF"
                            />
                        </svg>
                    </div>

                    <button :class="`${classPrefix}-modal-close`" @click="closeModal">&times;</button>
                </div>

                <!-- Provider selection -->
                <div v-if="selectedProvider === null" :class="`${classPrefix}-provider-selection`">
                    <h2 :class="`${classPrefix}-section-title`">Sign in</h2>
                    <div :class="`${classPrefix}-provider-list`">
                        <button
                            v-for="providerType in providers ?? availableProviders"
                            :key="providerType"
                            :class="[
                                'provider-row',
                                !authProviderManager.getProvider(providerType)?.isEnabled() ? 'disabled' : '',
                            ]"
                            @click="
                                !authProviderManager.getProvider(providerType)?.isEnabled()
                                    ? null
                                    : (console.log('Provider clicked:', {
                                          providerType,
                                          defaultAuthMode,
                                          willSetShowLoginTo: defaultAuthMode === 'login',
                                      }),
                                      (selectedProvider = providerType),
                                      (showLogin = defaultAuthMode === 'login'))
                            "
                        >
                            <span :class="['label', `${classPrefix}-provider-label`]">
                                <span :class="['provider-icon', `${classPrefix}-provider-icon`]">
                                    <!-- Icons chosen by providerType -->
                                    <svg
                                        v-if="providerType === 'password'"
                                        width="24"
                                        height="24"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        xmlns="http://www.w3.org/2000/svg"
                                    >
                                        <rect
                                            x="2"
                                            y="6"
                                            width="20"
                                            height="14"
                                            rx="2"
                                            stroke="currentColor"
                                            stroke-width="2"
                                        />
                                        <path
                                            d="M16 14C16 15.1046 16.8954 16 18 16C19.1046 16 20 15.1046 20 14C20 12.8954 19.1046 12 18 12C16.8954 12 16 12.8954 16 14Z"
                                            fill="currentColor"
                                        />
                                        <path d="M2 10H22" stroke="currentColor" stroke-width="2" />
                                    </svg>

                                    <svg
                                        v-else-if="providerType === 'google'"
                                        width="24"
                                        height="24"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        xmlns="http://www.w3.org/2000/svg"
                                    >
                                        <path
                                            d="M21.8055 10.0415H12V14.0415H17.6515C16.827 16.3275 14.6115 17.875 12 17.875C8.8385 17.875 6.25 15.2865 6.25 12.125C6.25 8.9635 8.8385 6.375 12 6.375C13.5145 6.375 14.8695 6.9525 15.9065 7.875L18.8075 4.974C17.0565 3.342 14.6805 2.375 12 2.375C6.6165 2.375 2.25 6.7415 2.25 12.125C2.25 17.5085 6.6165 21.875 12 21.875C16.8705 21.875 21.1875 18.3405 21.1875 12.125C21.1875 11.4405 21.0585 10.7275 20.9055 10.0415H21.8055Z"
                                            fill="#4285F4"
                                        />
                                        <path
                                            d="M3.8535 7.4675L7.209 9.9335C8.0865 7.8375 9.8865 6.375 12 6.375C13.5145 6.375 14.8695 6.9525 15.9065 7.875L18.8075 4.974C17.0565 3.342 14.6805 2.375 12 2.375C8.481 2.375 5.4405 4.455 3.8535 7.4675Z"
                                            fill="#EA4335"
                                        />
                                        <path
                                            d="M12 21.875C14.6235 21.875 16.9535 20.9475 18.694 19.3755L15.513 16.692C14.481 17.417 13.2455 17.8755 12 17.875C9.399 17.875 7.19 16.3415 6.3595 14.0695L3.0265 16.651C4.596 19.7105 8.1575 21.875 12 21.875Z"
                                            fill="#34A853"
                                        />
                                        <path
                                            d="M21.1875 12.125C21.1875 11.4405 21.0585 10.7275 20.9055 10.0415H12V14.0415H17.6515C17.2555 15.1905 16.536 16.1555 15.513 16.692L18.694 19.3755C20.7435 17.4545 21.1875 14.9455 21.1875 12.125Z"
                                            fill="#4285F4"
                                        />
                                        <path
                                            d="M6.3595 14.0695C6.1095 13.3845 5.9685 12.6465 5.9685 11.875C5.9685 11.1035 6.1095 10.3655 6.3595 9.6805L3.0265 7.1C2.4195 8.5785 2.0625 10.183 2.0625 11.875C2.0625 13.567 2.4195 15.1715 3.0265 16.65L6.3595 14.0695Z"
                                            fill="#FBBC05"
                                        />
                                    </svg>

                                    <svg
                                        v-else-if="providerType === 'github'"
                                        width="24"
                                        height="24"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        xmlns="http://www.w3.org/2000/svg"
                                    >
                                        <path
                                            d="M12 2C6.477 2 2 6.477 2 12C2 16.419 4.865 20.166 8.839 21.489C9.339 21.582 9.525 21.276 9.525 21.012C9.525 20.775 9.517 20.088 9.513 19.255C6.728 19.878 6.138 17.857 6.138 17.857C5.681 16.705 5.029 16.399 5.029 16.399C4.121 15.758 5.098 15.771 5.098 15.771C6.101 15.841 6.63 16.821 6.63 16.821C7.521 18.341 8.969 17.905 9.543 17.65C9.635 17.014 9.899 16.579 10.188 16.341C7.976 16.099 5.65 15.239 5.65 11.379C5.65 10.225 6.038 9.285 6.65 8.554C6.546 8.303 6.205 7.268 6.75 5.903C6.75 5.903 7.587 5.636 9.5 6.848C10.3 6.634 11.15 6.527 12 6.523C12.85 6.527 13.7 6.634 14.5 6.848C16.412 5.636 17.249 5.903 17.249 5.903C17.794 7.268 17.453 8.303 17.349 8.554C17.962 9.285 18.349 10.225 18.349 11.379C18.349 15.249 16.018 16.095 13.8 16.329C14.161 16.625 14.487 17.209 14.487 18.098C14.487 19.343 14.474 20.682 14.474 21.009C14.474 21.274 14.658 21.583 15.166 21.485C19.135 20.158 22 16.414 22 12C22 6.477 17.523 2 12 2Z"
                                            fill="#181616"
                                        />
                                    </svg>

                                    <svg
                                        v-else-if="providerType === 'x'"
                                        width="24"
                                        height="24"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        xmlns="http://www.w3.org/2000/svg"
                                    >
                                        <path
                                            d="M17.6 8.54542C17.6 8.70173 17.6 8.85805 17.6 9.0693C17.6 13.3514 14.3636 18.2898 8.40872 18.2898C6.57745 18.2898 4.89091 17.7638 3.49091 16.8667C3.74327 16.8917 4.00036 16.9042 4.26218 16.9042C5.76727 16.9042 7.15128 16.3782 8.26909 15.5311C6.84509 15.506 5.65127 14.5839 5.24 13.3139C5.44873 13.3514 5.66218 13.369 5.87564 13.369C6.18909 13.369 6.50254 13.334 6.79055 13.269C5.30909 12.9731 4.20727 11.6781 4.20727 10.1332V10.0957C4.63636 10.3291 5.13527 10.4729 5.65127 10.4854C4.78254 9.91432 4.22182 8.95736 4.22182 7.87492C4.22182 7.29131 4.37455 6.75271 4.63636 6.28427C6.21818 8.20184 8.56218 9.44424 11.1956 9.58148C11.1382 9.34807 11.1127 9.1021 11.1127 8.86868C11.1127 7.12953 12.5093 5.73999 14.2545 5.73999C15.1636 5.73999 15.9891 6.10846 16.5753 6.71715C17.3091 6.56584 18.0062 6.30988 18.6271 5.94141C18.3927 6.69214 17.8913 7.30083 17.2276 7.6943C17.8722 7.61685 18.4978 7.44792 19.0764 7.21949C18.6311 7.84575 18.0691 8.38935 17.4273 8.84524C17.6 8.84524 17.6 8.54542 17.6 8.54542Z"
                                            fill="black"
                                        />
                                    </svg>
                                </span>

                                <!-- Label -->
                                <span>
                                    {{
                                        providerType === "password"
                                            ? "Password"
                                            : providerType === "google"
                                            ? "Google"
                                            : providerType === "github"
                                            ? "GitHub"
                                            : "X"
                                    }}
                                </span>
                            </span>

                            <!-- Right side: "Soon" or chevron -->
                            <span
                                v-if="!authProviderManager.getProvider(providerType)?.isEnabled()"
                                :class="[`coming-soon`, `${classPrefix}-coming-soon`]"
                                >Soon</span
                            >
                            <span v-else :class="[`row-arrow`, `${classPrefix}-row-arrow`]">›</span>
                        </button>
                    </div>
                </div>

                <!-- Provider flow (password / oauth) -->
                <div v-else :class="`${classPrefix}-password-provider-flow`">
                    <template v-if="showLogin">
                        <h2 v-if="selectedProvider !== 'google'" :class="`${classPrefix}-auth-title`">Log in</h2>

                        <AuthForm
                            :provider="authProviderManager.getProvider(selectedProvider)!"
                            mode="login"
                            :class-prefix="classPrefix"
                            :close-modal="closeModal"
                            :force-session-key="forceSessionKey"
                            :set-lock-open="(val: boolean) => (lockOpen = val)"
                        />

                        <button :class="`${classPrefix}-switch-auth-button`" @click="showLogin = false">
                            Don't have an account? Sign up
                        </button>
                    </template>

                    <template v-else>
                        <h2 :class="`${classPrefix}-auth-title`">Create account</h2>

                        <AuthForm
                            :provider="authProviderManager.getProvider(selectedProvider)!"
                            mode="register"
                            :class-prefix="classPrefix"
                            :close-modal="closeModal"
                            :force-session-key="forceSessionKey"
                            :set-lock-open="(val: boolean) => (lockOpen = val)"
                        />

                        <button :class="`${classPrefix}-switch-auth-button`" @click="showLogin = true">
                            Already have an account? Log in
                        </button>
                    </template>
                </div>
            </div>
        </div>
    </teleport>
</template>

<style scoped>
/* === Design tokens & motion === */
:root {
    --color-primary: #ff594b;
    --color-secondary: #ff9660;
    --color-primary-emphasis: rgba(255, 89, 75, 0.2);
    --radius-l: 24px;
    --shadow-xl: 0 12px 32px rgba(0, 0, 0, 0.12);
    --overlay-bg: rgba(0, 0, 0, 0.5);
    --modal-bg: rgba(255, 255, 255, 0.75);
    --text-main: #333;
    --text-secondary: #666;
    --border-main: #e5e5e5;
    --background-main: #fff;
    --background-alt: #f9f9f9;
    --background-provider: #f5f5f5;
    --coming-soon-bg: #f0f0f0;
    --anim-ease: cubic-bezier(0.16, 1, 0.3, 1);
    --anim-fast: 120ms;
    --anim-normal: 220ms;
}

.dark {
    --color-primary: #ff594b;
    --color-secondary: #ff9660;
    --color-primary-emphasis: rgba(255, 89, 75, 0.12);
    --shadow-xl: 0 12px 32px rgba(0, 0, 0, 0.32);
    --overlay-bg: rgba(0, 0, 0, 0.7);
    --modal-bg: rgba(24, 24, 28, 0.98);
    --text-main: #f3f3f3;
    --text-secondary: #b0b0b0;
    --border-main: #333;
    --background-main: #18181c;
    --background-alt: #23232a;
    --background-provider: #23232a;
    --coming-soon-bg: #23232a;
}

@keyframes fadeIn {
    from {
        opacity: 0;
    }
    to {
        opacity: 1;
    }
}

@keyframes slideUp {
    from {
        transform: translateY(24px) scale(0.98);
        opacity: 0;
    }
    to {
        transform: translateY(0) scale(1);
        opacity: 1;
    }
}

.hyli-btn {
    padding: 12px 24px;
    background: linear-gradient(90deg, var(--color-primary) 0%, var(--color-secondary) 100%);
    color: #fff;
    border: none;
    border-radius: var(--radius-l);
    cursor: pointer;
    font-size: 16px;
    font-weight: 600;
    box-shadow: var(--shadow-xl);
    transition: transform var(--anim-fast) var(--anim-ease), opacity var(--anim-fast) var(--anim-ease);
}

.hyli-btn:hover {
    opacity: 0.9;
    transform: scale(0.98);
}

/* Overlay */
.hyli-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: var(--overlay-bg);
    backdrop-filter: blur(8px) saturate(120%);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 999999;
    animation: fadeIn var(--anim-normal) var(--anim-ease);
}

/* Modal */
.hyli-modal {
    background: var(--modal-bg);
    color: var(--text-main);
    border: 1px solid var(--border-main);
    backdrop-filter: blur(16px) saturate(180%);
    border-radius: var(--radius-l);
    box-shadow: var(--shadow-xl);
    width: min(90%, 420px);
    min-height: min-content;
    max-height: 90vh;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 0 24px 28px;
    position: relative;
    animation: slideUp 0.3s var(--anim-ease);
    margin: 16px;
    display: flex;
    flex-direction: column;
}

/* Modal header with brand gradient */
.hyli-modal-header {
    height: 56px;
    background: linear-gradient(90deg, var(--color-primary) 0%, var(--color-secondary) 100%);
    border-top-left-radius: var(--radius-l);
    border-top-right-radius: var(--radius-l);
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    margin: 0 -24px 24px; /* stretch full width, then push content */
}

.hyli-modal-logo {
    margin: 0;
    display: flex;
    justify-content: center;
}

.hyli-modal-close {
    position: absolute;
    right: 12px;
    top: 50%;
    transform: translateY(-50%);
    background: transparent;
    border: none;
    color: #fff;
    font-size: 24px;
    cursor: pointer;
    transition: transform var(--anim-fast) var(--anim-ease);
}

.hyli-modal-close:hover {
    transform: translateY(-50%) rotate(45deg);
}

.hyli-provider-selection h2 {
    margin-top: 0;
    text-align: center;
    font-size: 24px;
    color: var(--text-main);
}

.hyli-password-provider-flow .hyli-auth-title {
    margin: 0 0 20px 0;
    text-align: center;
    font-size: 24px;
    color: var(--text-main);
}

.hyli-provider-selection .subtitle {
    text-align: center;
    color: var(--text-secondary);
    margin: 8px 0 24px;
    font-size: 14px;
}

.hyli-provider-btn {
    flex: 1 1 40%;
    padding: 12px 8px;
    border: 1px solid #ccc;
    border-radius: 4px;
    background: #f9f9f9;
    cursor: pointer;
    font-size: 14px;
}

.hyli-provider-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}

.hyli-coming-soon {
    color: var(--text-secondary) !important;
    background-color: var(--coming-soon-bg);
    font-size: 12px;
}

.hyli-password-provider-flow .hyli-switch-auth-button {
    margin-top: 16px;
    width: 100%;
    padding: 8px;
    border: none;
    background: #eee;
    cursor: pointer;
    border-radius: 4px;
}

/* Sleek link-style button for toggling between login and sign-up */
.hyli-password-provider-flow .hyli-switch-auth-button {
    /* link style button */
    background: none;
    color: var(--color-primary);
    font-size: 14px;
    width: auto;
    padding: 0;
}

.hyli-password-provider-flow .hyli-switch-auth-button:hover {
    opacity: 0.8;
    text-decoration: none;
}

/* Provider vertical list */
.hyli-provider-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 16px;
}

.provider-row {
    width: 100%;
    padding: 12px 16px;
    border: 1px solid var(--border-main);
    border-radius: 8px;
    background: var(--background-main);
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 16px;
    cursor: pointer;
    transition: background 0.15s ease;
    color: var(--text-main);
}

.provider-row:hover:not(.disabled) {
    background: var(--background-alt);
}

.provider-row.disabled {
    opacity: 0.6;
    cursor: not-allowed;
}

.provider-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background-color: var(--background-provider);
    color: var(--text-main);
}

.provider-row .provider-icon svg {
    display: block;
}

/* Email field styling */
.provider-row:first-child {
    position: relative;
    background-color: var(--background-main);
    border-radius: 8px;
    overflow: hidden;
}

.label {
    display: flex;
    align-items: center;
    gap: 12px;
    color: var(--text-main);
}

.row-arrow {
    font-size: 20px;
    color: var(--text-main);
}

.hyli-password-provider-flow .wallet-login-container h1,
.hyli-password-provider-flow .wallet-creation-container h1 {
    display: none;
}

.hyli-password-provider-flow .wallet-creation-form p {
    display: none;
}

.hyli-password-provider-flow .form-group {
    margin-bottom: 10px;
}

.hyli-password-provider-flow .form-group label {
    display: block;
    margin-bottom: 4px;
    font-size: 14px;
    font-weight: 500;
    color: #333;
}

.hyli-password-provider-flow input {
    width: 100%;
    height: 42px;
    background: rgba(255, 255, 255, 0.8);
    border: 1px solid rgba(0, 0, 0, 0.1);
    border-radius: 12px;
    font-size: 15px;
    transition: border-color var(--anim-fast) ease;
    position: relative;
}

.hyli-password-provider-flow .form-group {
    position: relative;
}

/* 
  .hyli-password-provider-flow .form-group::before {
    content: "";
    position: absolute;
    left: 12px;
    top: 34px;
    width: 16px;
    height: 16px;
    background-repeat: no-repeat;
    background-position: center;
    opacity: 0.5;
  }
  
  .hyli-password-provider-flow .form-group:nth-of-type(1)::before {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2'%3E%3C/path%3E%3Ccircle cx='12' cy='7' r='4'%3E%3C/circle%3E%3C/svg%3E");
  }
  
  .hyli-password-provider-flow .form-group:nth-of-type(2)::before,
  .hyli-password-provider-flow .form-group:nth-of-type(3)::before {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='11' width='18' height='11' rx='2' ry='2'%3E%3C/rect%3E%3Cpath d='M7 11V7a5 5 0 0 1 10 0v4'%3E%3C/path%3E%3C/svg%3E");
  }
  */

.hyli-password-provider-flow input:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 3px var(--color-primary-emphasis);
}

.hyli-password-provider-flow .login-wallet-button,
.hyli-password-provider-flow .create-wallet-button {
    width: 100%;
    height: 48px;
    background: linear-gradient(90deg, var(--color-primary) 0%, var(--color-secondary) 100%);
    color: #fff;
    border: none;
    border-radius: 24px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: transform var(--anim-fast) var(--anim-ease), opacity var(--anim-fast) var(--anim-ease);
    margin: 0;
    padding: 0;
}

.hyli-password-provider-flow .login-wallet-button:hover,
.hyli-password-provider-flow .create-wallet-button:hover {
    opacity: 0.9;
    transform: translateY(-1px);
}

.hyli-password-provider-flow .login-wallet-button:active,
.hyli-password-provider-flow .create-wallet-button:active {
    transform: translateY(1px);
}

.hyli-password-provider-flow .login-wallet-button:disabled,
.hyli-password-provider-flow .create-wallet-button:disabled {
    opacity: 0.7;
    cursor: not-allowed;
    background: linear-gradient(90deg, #ccc 0%, #ddd 100%);
}

.hyli-password-provider-flow .error-message {
    color: #e53935;
    margin: 8px 0;
    padding: 8px 12px;
    background-color: rgba(229, 57, 53, 0.1);
    border-radius: 8px;
    font-size: 14px;
}

.hyli-password-provider-flow .hyli-status-message {
    color: #2196f3;
    margin: 8px 0;
    padding: 8px 12px;
    background-color: rgba(33, 150, 243, 0.1);
    border-radius: 8px;
    font-size: 14px;
}

.hyli-password-provider-flow .transaction-hash {
    margin-top: 16px;
    font-size: 13px;
    text-align: center;
    opacity: 0.7;
}

.hyli-password-provider-flow .transaction-hash a {
    color: var(--color-primary);
    text-decoration: none;
}

.hyli-password-provider-flow .transaction-hash a:hover {
    text-decoration: underline;
}

.hyli-password-provider-flow {
    flex: 1;
    display: flex;
    flex-direction: column;
    width: 100%;
    min-height: 0;
}

.hyli-password-provider-flow .wallet-login-container,
.hyli-password-provider-flow .wallet-creation-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 16px 0;
}

.hyli-provider-selection {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.hyli-provider-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-right: 4px;
    margin-right: -4px;
}

.hyli-provider-row.disabled {
    opacity: 0.6;
    cursor: not-allowed;
}

.hyli-coming-soon {
    font-size: 12px;
    color: var(--text-secondary);
    padding: 2px 8px;
    border-radius: 4px;
    background-color: var(--coming-soon-bg);
}

.transaction-hash {
    color: #2196f3;
    text-decoration: none;
}
</style>
