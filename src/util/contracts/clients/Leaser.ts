import { CosmWasmClient, ExecuteResult } from '@cosmjs/cosmwasm';
import { Coin as StargateCoin } from '@cosmjs/proto-signing';
import { StdFee } from '@cosmjs/stargate';
import { NolusWallet } from '../../nolus';

import {
  currentOpenLeasesByOwnerMsg,
  leaseQuoteMsg,
  leaserConfigMsg,
  openLeaseMsg,
} from '../messages';
import { LeaseApply, LeaserConfig, Permille } from '../types';

export class Leaser {
  constructor(
    private cosmWasmClient: CosmWasmClient,
    private contractAddress: string,
  ) {}

  async getLeaserConfig(): Promise<LeaserConfig> {
    return this.cosmWasmClient.queryContractSmart(
      this.contractAddress,
      leaserConfigMsg(),
    );
  }

  async getCurrentOpenLeasesByOwner(ownerAddress: string): Promise<string[]> {
    return this.cosmWasmClient.queryContractSmart(
      this.contractAddress,
      currentOpenLeasesByOwnerMsg(ownerAddress),
    );
  }

  async leaseQuote(
    downpaymentAmount: string,
    downpaymentCurrency: string,
    leaseAsset: string,
    maxLtd?: Permille,
  ): Promise<LeaseApply> {
    return this.cosmWasmClient.queryContractSmart(
      this.contractAddress,
      leaseQuoteMsg(downpaymentAmount, downpaymentCurrency, leaseAsset, maxLtd),
    );
  }

  async openLease(
    nolusWallet: NolusWallet,
    leaseCurrency: string,
    fee: StdFee | 'auto' | number,
    maxLtd?: Permille,
    fundCoin?: StargateCoin[],
  ): Promise<ExecuteResult> {
    return nolusWallet.executeContract(
      this.contractAddress,
      openLeaseMsg(leaseCurrency, maxLtd),
      fee,
      undefined,
      fundCoin,
    );
  }
}
