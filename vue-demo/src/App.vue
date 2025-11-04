<script setup lang="ts">
import { watch } from "vue";
import type { ProviderOption } from "hyli-wallet";
import { HyliWallet, useWallet, WalletProvider } from "hyli-wallet-vue";

const { wallet, getEthereumProvider, selectEthereumProvider } = useWallet();
const modalProviders: ProviderOption[] = [
  "password",
  "google",
  "ethereum",
  "github",
];

const chooseEthWallet = () => {
  selectEthereumProvider();
};

watch(
  () => wallet.value?.ethereumProviderUuid,
  () => {
    if (!wallet.value?.ethereumProviderUuid) {
      return;
    }
    const provider = getEthereumProvider();
    if (provider) {
      // eslint-disable-next-line no-console
      console.log("Ethereum provider selected", provider);
    }
  }
);
</script>

<template>
  <WalletProvider
    :config="{
      nodeBaseUrl: 'http://localhost:4321',
      walletServerBaseUrl: 'http://localhost:4000',
      applicationWsUrl: 'ws://localhost:8081',
      providers: {
        password: { enabled: true },
        ethereum: { enabled: true },
        google: { clientId: 'YOUR_GOOGLE_CLIENT_ID' },
      },
    }"
    :force-session-key="undefined"
  >
    <template v-if="!wallet">
      <HyliWallet :providers="modalProviders" />
    </template>
    <template v-else>
      <div class="ethereum-provider-actions">
        <button @click="chooseEthWallet">Choose ETH Wallet</button>
      </div>
      <div style="display: none">
        <HyliWallet :providers="modalProviders" />
      </div>
    </template>
  </WalletProvider>
</template>

<style scoped>
.ethereum-provider-actions {
  margin: 24px 0;
  text-align: center;
}

.ethereum-provider-actions button {
  padding: 12px 24px;
  background: linear-gradient(90deg, #ff594b 0%, #ff9660 100%);
  color: #fff;
  border: none;
  border-radius: 24px;
  cursor: pointer;
  font-size: 16px;
  font-weight: 600;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.12);
  transition: transform 120ms cubic-bezier(0.16, 1, 0.3, 1),
    opacity 120ms cubic-bezier(0.16, 1, 0.3, 1);
}

.ethereum-provider-actions button:hover {
  transform: translateY(-2px);
}
</style>
