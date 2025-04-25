import { IndexerApiHttpClient } from "hyle";
import { Transaction } from "../types/wallet";

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
    this.client = new IndexerApiHttpClient(
      import.meta.env.VITE_INDEXER_BASE_URL,
    );
    this.server = new IndexerApiHttpClient(
      import.meta.env.VITE_SERVER_BASE_URL,
    );
  }

  async getBalance(address: string): Promise<number> {
    try {
      const response = await this.client.get<BalanceResponse>(
        `v1/indexer/contract/hyllar/balance/${address}`,
        "Fetching balance",
      );
      return response.balance;
    } catch (error) {
      console.error("Erreur lors de la récupération du solde:", error);
      return 0;
    }
  }

  async getTransactionHistory(address: string): Promise<Transaction[]> {
    try {
      const response = await this.server.get<TransactionHistoryResponse>(
        `v1/indexer/contract/hyllar/history/${address}`,
        "Fetching transaction history",
      );
      return response.history;
    } catch (error) {
      console.error("Erreur lors de la récupération de l'historique:", error);
      return [];
    }
  }
}

export const indexerService = new IndexerService();
