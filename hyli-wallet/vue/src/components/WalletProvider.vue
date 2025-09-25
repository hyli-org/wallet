<script setup lang="ts">
import { provide, watchEffect } from "vue";
import { setWalletConfig, useWalletInternal, walletKey, type WalletProviderProps } from "../composables/useWallet";

const props = defineProps<WalletProviderProps>();

watchEffect(() => setWalletConfig(props));
const walletInternal = useWalletInternal();
provide(walletKey, walletInternal);
</script>

<template>
    <slot></slot>
</template>
