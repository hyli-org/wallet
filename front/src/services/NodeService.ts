import { NodeApiHttpClient } from "hyle";

class NodeService {
  client: NodeApiHttpClient;

  constructor() {
    this.client = new NodeApiHttpClient("http://localhost:4321");
  }
}

export const nodeService = new NodeService();
