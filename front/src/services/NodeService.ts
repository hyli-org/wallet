import { NodeApiHttpClient } from "hyli";
import { ConfigService } from "./ConfigService";

class NodeService {
    client: NodeApiHttpClient;

    constructor() {
        this.client = new NodeApiHttpClient(ConfigService.getNodeBaseUrl());
    }
}

export const nodeService = new NodeService();
