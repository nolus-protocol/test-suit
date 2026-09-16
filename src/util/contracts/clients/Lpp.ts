import { CosmWasmClient, ExecuteResult } from '@cosmjs/cosmwasm-stargate';
import { Coin as StargateCoin } from '@cosmjs/proto-signing';
import { StdFee } from '@cosmjs/stargate';
import { NolusWallet } from '@nolus/nolusjs';

import {
  burnMsg,
  claimRewardsMsg,
  depositCapacityMsg,
  depositMsg,
  distributeRewardsMsg,
  lenderDepositMsg,
  lenderRewardsMsg,
  loanInformationMsg,
  lppBalanceMsg,
  lppConfigMsg,
  lppPriceMsg,
} from '../messages';
import {
  BareCoin,
  LoanInfo,
  LppBalance,
  LppConfig,
  NLpnPrice,
  Rewards,
} from '../types';

export class Lpp {
  constructor(
    private cosmWasmClient: CosmWasmClient,
    private contractAddress: string,
  ) {}

  async getLppConfig(): Promise<LppConfig> {
    return this.cosmWasmClient.queryContractSmart(
      this.contractAddress,
      lppConfigMsg(),
    );
  }

  async getLppBalance(): Promise<LppBalance> {
    return this.cosmWasmClient.queryContractSmart(
      this.contractAddress,
      lppBalanceMsg(),
    );
  }

  async getDepositCapacity(): Promise<BareCoin | null> {
    return this.cosmWasmClient.queryContractSmart(
      this.contractAddress,
      depositCapacityMsg(),
    );
  }

  async getPrice(): Promise<NLpnPrice> {
    return this.cosmWasmClient.queryContractSmart(
      this.contractAddress,
      lppPriceMsg(),
    );
  }

  async getLoanInformation(leaseAddress: string): Promise<LoanInfo | null> {
    return this.cosmWasmClient.queryContractSmart(
      this.contractAddress,
      loanInformationMsg(leaseAddress),
    );
  }

  async getLenderDeposit(lenderAddress: string): Promise<BareCoin> {
    return this.cosmWasmClient.queryContractSmart(
      this.contractAddress,
      lenderDepositMsg(lenderAddress),
    );
  }

  async getLenderRewards(lenderAddress: string): Promise<Rewards> {
    return this.cosmWasmClient.queryContractSmart(
      this.contractAddress,
      lenderRewardsMsg(lenderAddress),
    );
  }

  async deposit(
    nolusWallet: NolusWallet,
    fee: StdFee | 'auto' | number,
    fundCoin?: StargateCoin[],
  ): Promise<ExecuteResult> {
    return nolusWallet.executeContract(
      this.contractAddress,
      depositMsg(),
      fee,
      undefined,
      fundCoin,
    );
  }

  async distributeRewards(
    nolusWallet: NolusWallet,
    fee: StdFee | 'auto' | number,
    fundCoin?: StargateCoin[],
  ): Promise<ExecuteResult> {
    return nolusWallet.executeContract(
      this.contractAddress,
      distributeRewardsMsg(),
      fee,
      undefined,
      fundCoin,
    );
  }

  async burnDeposit(
    nolusWallet: NolusWallet,
    burnAmount: string,
    fee: StdFee | 'auto' | number,
    fundCoin?: StargateCoin[],
  ): Promise<ExecuteResult> {
    return nolusWallet.executeContract(
      this.contractAddress,
      burnMsg(burnAmount),
      fee,
      undefined,
      fundCoin,
    );
  }

  async claimRewards(
    nolusWallet: NolusWallet,
    recipientAddress: string | undefined,
    fee: StdFee | 'auto' | number,
    fundCoin?: StargateCoin[],
  ): Promise<ExecuteResult> {
    return nolusWallet.executeContract(
      this.contractAddress,
      claimRewardsMsg(recipientAddress),
      fee,
      undefined,
      fundCoin,
    );
  }
}
