<script setup lang="ts">
import { HyliWallet, useWallet, WalletProvider } from "hyli-wallet-vue";
const { getEthereumProvider } = useWallet();

let provider = getEthereumProvider();
console.log("Ethereum Provider:", provider);
</script>

<template>
    <WalletProvider
        :config="{
            nodeBaseUrl: 'http://localhost:4321',
            walletServerBaseUrl: 'http://localhost:4000',
            applicationWsUrl: 'ws://localhost:8081',
            providers: {
                password: {
                    enabled: true,
                },
                ethereum: {
                    enabled: true,
                },
                google: {
                    clientId: 'YOUR_GOOGLE_CLIENT_ID',
                },
            },
        }"
        :force-session-key="undefined"
    >
        <HyliWallet></HyliWallet>
    </WalletProvider>
</template>
