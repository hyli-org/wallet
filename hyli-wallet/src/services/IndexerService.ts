import { Blob, IndexerApiHttpClient } from "hyli";
import { AuthMethod, walletContractName } from "../types/wallet";
import { ConfigService } from "./ConfigService";

export interface BackendSessionKey {
    key: string;
    expiration_date: number;
    nonce: number;
    laneId?: string;
}

export interface AccountInfo {
    account: string;
    username: string;
    auth_method: AuthMethod;
    session_keys: BackendSessionKey[];
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

    async getAccountInfo(username: string): Promise<AccountInfo> {
        const response = await this.client.get<AccountInfo>(
            `v1/indexer/contract/${walletContractName}/account/${username}`,
            `Fetching "${username}" account`
        );
        return { ...response, username };
    }

    async claimInviteCode(code: string, wallet: string): Promise<Blob> {
        // Use wallet server URL for invite code endpoint (not indexer)
        const walletServerUrl = ConfigService.getConfig().walletServerBaseUrl;
        const response = await fetch(`${walletServerUrl}/api/consume_invite`, {
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
