import { IndexerApiHttpClient } from "hyli";
import { AccountInfo, walletContractName } from "hyli-wallet";
import { Transaction } from "./WebSocketService";

interface BalanceResponse {
    account: string;
    balance: number;
}

interface TransactionHistoryResponse {
    account: string;
    history: Transaction[];
}

class IndexerService {
    client: IndexerApiHttpClient;
    server: IndexerApiHttpClient;

    constructor() {
        this.client = new IndexerApiHttpClient(import.meta.env.VITE_INDEXER_BASE_URL);
        this.server = new IndexerApiHttpClient(import.meta.env.VITE_WALLET_SERVER_BASE_URL);
    }

    async getBalance(address: string, token: string): Promise<number> {
        try {
            const response = await this.client.get<BalanceResponse>(
                `v1/indexer/contract/${token}/balance/${address}`,
                "Fetching balance"
            );
            return response.balance;
        } catch (error) {
            console.error("Error while fetching the balance:", error);
            return 0;
        }
    }

    async getTransactionHistory(address: string): Promise<Transaction[]> {
        try {
            const response = await this.server.get<TransactionHistoryResponse>(
                `v1/indexer/contract/oranj/history/${address}`,
                "Fetching transaction history"
            );
            return response.history;
        } catch (error) {
            console.error("Error while fetching the transaction history:", error);
            return [];
        }
    }

    async getAccountInfo(address: string): Promise<AccountInfo> {
        try {
            const response = await this.server.get<AccountInfo>(
                `v1/indexer/contract/${walletContractName}/account/${address}`,
                "Fetching account info"
            );
            return response;
        } catch (error) {
            console.error("Error while fetching the account info:", error);
            throw new Error("Failed to fetch account info");
        }
    }
}

export const indexerService = new IndexerService();
