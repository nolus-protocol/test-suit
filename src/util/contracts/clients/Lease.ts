import { CosmWasmClient, ExecuteResult } from '@cosmjs/cosmwasm';
import { Coin as StargateCoin } from '@cosmjs/proto-signing';
import { StdFee } from '@cosmjs/stargate';
import { NolusWallet } from '../../nolus';

import {
  changeClosePolicyMsg,
  closePositionLeaseMsg,
  leaseStateMsg,
  repayLeaseMsg,
} from '../messages';
import { Coin, LeaseStatus, Permille } from '../types';

export class Lease {
  constructor(
    private cosmWasmClient: CosmWasmClient,
    private contractAddress: string,
  ) {}

  async getLeaseStatus(dueProjectionSecs?: number): Promise<LeaseStatus> {
    return this.cosmWasmClient.queryContractSmart(
      this.contractAddress,
      leaseStateMsg(dueProjectionSecs),
    );
  }

  async repayLease(
    nolusWallet: NolusWallet,
    fee: StdFee | 'auto' | number,
    fundCoin?: StargateCoin[],
  ): Promise<ExecuteResult> {
    return nolusWallet.executeContract(
      this.contractAddress,
      repayLeaseMsg(),
      fee,
      undefined,
      fundCoin,
    );
  }

  async closePositionLease(
    nolusWallet: NolusWallet,
    fee: StdFee | 'auto' | number,
    amount?: Coin,
    fundCoin?: StargateCoin[],
  ): Promise<ExecuteResult> {
    return nolusWallet.executeContract(
      this.contractAddress,
      closePositionLeaseMsg(amount),
      fee,
      undefined,
      fundCoin,
    );
  }

  async changeClosePolicy(
    nolusWallet: NolusWallet,
    fee: StdFee | 'auto' | number,
    stopLoss?: Permille | null,
    takeProfit?: Permille | null,
    fundCoin?: StargateCoin[],
  ): Promise<ExecuteResult> {
    return nolusWallet.executeContract(
      this.contractAddress,
      changeClosePolicyMsg(stopLoss, takeProfit),
      fee,
      undefined,
      fundCoin,
    );
  }
}
