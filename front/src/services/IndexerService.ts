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

    async getTransactionHistory(address: string, token: string = "oranj"): Promise<Transaction[]> {
        try {
            const response = await this.server.get<TransactionHistoryResponse>(
                `v1/indexer/contract/${token}/history/${address}`,
                "Fetching transaction history"
            );
            // Add token field to each transaction
            return response.history.map(tx => ({ ...tx, token }));
        } catch (error) {
            console.error(`Error while fetching ${token} transaction history:`, error);
            return [];
        }
    }

    async getAllTransactionHistory(address: string): Promise<Transaction[]> {
        const tokens = ["oranj", "oxygen", "vitamin"];
        try {
            const historyPromises = tokens.map(token => this.getTransactionHistory(address, token));
            const histories = await Promise.all(historyPromises);
            
            // Combine all histories and sort by timestamp
            const allTransactions = histories.flat();
            return allTransactions.sort((a, b) => b.timestamp - a.timestamp);
        } catch (error) {
            console.error("Error while fetching all transaction histories:", error);
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
