import { IndexerApiHttpClient } from "hyle";

class IndexerService {
  client: IndexerApiHttpClient;

  constructor() {
    this.client = new IndexerApiHttpClient("http://localhost:4321");
  }

  async getBalance(address: string): Promise<number> {
    try {
      return await this.client.get<number>(
        `v1/indexer/contract/hyllar/balance/${address}`,
        "Fetching balance",
      );
    } catch (error) {
      console.error("Erreur lors de la récupération du solde:", error);
      return 0;
    }
  }

  async waitForTxSettled(tx_hash: string) {
    let settled = false;

    while (!settled) {
      const tx = await this.client.getTransaction(tx_hash);
      if (tx.transaction_status === "Success") {
        settled = true;
        return tx;
      } else if (
        tx.transaction_status === "Failure" ||
        tx.transaction_status === "TimedOut"
      ) {
        throw new Error(`Transaction ${tx_hash} failed or timed out`);
      } else {
        console.log("Transaction not settled yet:", tx);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }
}

export const indexerService = new IndexerService();
