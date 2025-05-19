import { NodeApiHttpClient } from "hyli";

export class NodeService {
    private static instance: NodeService | null = null;
    client: NodeApiHttpClient;

    private constructor(nodeBaseUrl: string) {
        this.client = new NodeApiHttpClient(nodeBaseUrl);
    }

    static initialize(nodeBaseUrl: string): NodeService {
        NodeService.instance = new NodeService(nodeBaseUrl);
        return NodeService.instance;
    }

    static getInstance(): NodeService {
        if (!NodeService.instance) {
            throw new Error("NodeService not yet initialized.");
        }
        return NodeService.instance;
    }
}
