<script setup lang="ts">
import type { WalletProviderProps } from "../composables/useWallet";
import HyliWallet from "./HyliWallet.vue";
import WalletProvider from "./WalletProvider.vue";

const props = defineProps<WalletProviderProps>();
</script>

<template>
    <WalletProvider :config="props.config">
        <HyliWallet></HyliWallet>
    </WalletProvider>
</template>
