<script setup lang="ts">
import { HyliWallet, WalletProvider } from "hyli-wallet-vue";
</script>

<template>
    <WalletProvider
        :config="{
            nodeBaseUrl: 'http://localhost:4321',
            walletServerBaseUrl: 'http://localhost:4000',
            applicationWsUrl: 'ws://localhost:8081',
        }"
        :force-session-key="undefined"
    >
        <HyliWallet></HyliWallet>
    </WalletProvider>
</template>
