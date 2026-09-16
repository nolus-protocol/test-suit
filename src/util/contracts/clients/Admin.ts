import { CosmWasmClient } from '@cosmjs/cosmwasm-stargate';

import { protocolMsg, protocolsMsg } from '../messages';
import { Protocol } from '../types';

export class Admin {
  constructor(
    private cosmWasmClient: CosmWasmClient,
    private contractAddress: string,
  ) {}

  async getProtocols(): Promise<string[]> {
    return this.cosmWasmClient.queryContractSmart(
      this.contractAddress,
      protocolsMsg(),
    );
  }

  async getProtocol(protocol: string): Promise<Protocol> {
    return this.cosmWasmClient.queryContractSmart(
      this.contractAddress,
      protocolMsg(protocol),
    );
  }
}
