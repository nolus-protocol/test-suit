import { CosmWasmClient } from '@cosmjs/cosmwasm';
import { CometClient, connectComet } from '@cosmjs/tendermint-rpc';

export class NolusClient {
  private static instance: NolusClient | null = null;

  private readonly cosmWasmClient: Promise<CosmWasmClient>;
  private readonly cometClient: Promise<CometClient>;

  private constructor(readonly rpcEndpoint: string) {
    this.cosmWasmClient = CosmWasmClient.connect(rpcEndpoint);
    this.cometClient = connectComet(rpcEndpoint);
  }

  static setInstance(tendermintRpc: string): void {
    this.instance = new NolusClient(tendermintRpc);
  }

  static getInstance(): NolusClient {
    if (this.instance === null) {
      throw new Error(
        'Set the Tendermint RPC address before getting the instance.',
      );
    }

    return this.instance;
  }

  async getCosmWasmClient(): Promise<CosmWasmClient> {
    return this.cosmWasmClient;
  }

  async getTendermintClient(): Promise<CometClient> {
    return this.cometClient;
  }
}
