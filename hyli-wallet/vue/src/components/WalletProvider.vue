<script setup lang="ts">
import { provide } from "vue";
import { useWalletInternal, walletKey, type WalletProviderProps } from "../composables/useWallet";

const props = defineProps<WalletProviderProps>();

const walletInternal = useWalletInternal(props);
provide(walletKey, walletInternal);
</script>

<template>
    <slot></slot>
</template>
