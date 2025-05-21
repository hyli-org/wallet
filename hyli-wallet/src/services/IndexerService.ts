import { IndexerApiHttpClient } from "hyli";
import { AuthMethod, walletContractName } from "../types/wallet";

interface SessionKey {
  key: string;
  expiration_date: number;
  nonce: number;
}

interface AccountInfo {
  account: string;
  auth_method: AuthMethod;
  session_keys: SessionKey[];
  nonce: number;
}

export class IndexerService {
    private static instance: IndexerService | null = null;
    client: IndexerApiHttpClient;

    private constructor(indexerBaseUrl: string) {
        this.client = new IndexerApiHttpClient(indexerBaseUrl);
    }

    static initialize(indexerBaseUrl: string): IndexerService {
        IndexerService.instance = new IndexerService(indexerBaseUrl);
        return IndexerService.instance;
    }

    static getInstance(): IndexerService {
        if (!IndexerService.instance) {
            throw new Error("IndexerService not yet initialized.");
        }
        return IndexerService.instance;
    }


  async getAccountInfo(address: string): Promise<AccountInfo> {
    const response = await this.client.get<AccountInfo>(
      `v1/indexer/contract/${walletContractName}/account/${address}`,
      `Fetching "${address}" account`
    );

    return response;
  }
}
