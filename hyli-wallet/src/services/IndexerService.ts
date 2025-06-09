import { Blob, IndexerApiHttpClient } from "hyli";
import { AuthMethod, walletContractName } from "../types/wallet";

export interface SessionKey {
    key: string;
    expiration_date: number;
    nonce: number;
    laneId?: string;
}

export interface AccountInfo {
    account: string;
    auth_method: AuthMethod;
    session_keys: SessionKey[];
    nonce: number;
    salt: string;
}

export class IndexerService {
    private static instance: IndexerService | null = null;
    client: IndexerApiHttpClient;
    url: string;

    private constructor(indexerBaseUrl: string) {
        this.url = indexerBaseUrl;
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

    async claimInviteCode(code: string, wallet: string): Promise<Blob> {
        const response = await fetch(`${this.url}/api/consume_invite`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                code,
                wallet,
            }),
        });
        return await response.json();
    }
}
