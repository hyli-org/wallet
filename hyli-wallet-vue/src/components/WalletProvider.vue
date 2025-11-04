<script setup lang="ts">
import { watchEffect } from "vue";
import { setWalletConfig, type WalletProviderProps } from "../composables/useWallet";

const props = defineProps<WalletProviderProps>();

watchEffect(() => setWalletConfig(props));
</script>

<template>
    <slot></slot>
</template>
