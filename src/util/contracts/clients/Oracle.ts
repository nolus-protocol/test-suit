import { CosmWasmClient, ExecuteResult } from '@cosmjs/cosmwasm-stargate';
import { Coin as StargateCoin } from '@cosmjs/proto-signing';
import { StdFee } from '@cosmjs/stargate';
import { NolusWallet } from '@nolus/nolusjs';

import {
  basePriceMsg,
  baseCurrencyMsg,
  currenciesMsg,
  currencyPairsMsg,
  feedPricesMsg,
  feedersMsg,
  oracleConfigMsg,
  pricesMsg,
} from '../messages';
import {
  CurrencyInfo,
  FeedPrices,
  OracleConfig,
  Price,
  PricesResponse,
  SwapLeg,
} from '../types';

export class Oracle {
  constructor(
    private cosmWasmClient: CosmWasmClient,
    private contractAddress: string,
  ) {}

  async getConfig(): Promise<OracleConfig> {
    return this.cosmWasmClient.queryContractSmart(
      this.contractAddress,
      oracleConfigMsg(),
    );
  }

  async getBaseCurrency(): Promise<string> {
    return this.cosmWasmClient.queryContractSmart(
      this.contractAddress,
      baseCurrencyMsg(),
    );
  }

  async getPrices(): Promise<PricesResponse> {
    return this.cosmWasmClient.queryContractSmart(
      this.contractAddress,
      pricesMsg(),
    );
  }

  async getBasePrice(currency: string): Promise<Price> {
    return this.cosmWasmClient.queryContractSmart(
      this.contractAddress,
      basePriceMsg(currency),
    );
  }

  async getCurrencyPairs(): Promise<SwapLeg[]> {
    return this.cosmWasmClient.queryContractSmart(
      this.contractAddress,
      currencyPairsMsg(),
    );
  }

  async getCurrencies(): Promise<CurrencyInfo[]> {
    return this.cosmWasmClient.queryContractSmart(
      this.contractAddress,
      currenciesMsg(),
    );
  }

  async getFeeders(): Promise<string[]> {
    return this.cosmWasmClient.queryContractSmart(
      this.contractAddress,
      feedersMsg(),
    );
  }

  async feedPrices(
    nolusWallet: NolusWallet,
    feedPrices: FeedPrices,
    fee: StdFee | 'auto' | number,
    fundCoin?: StargateCoin[],
  ): Promise<ExecuteResult> {
    return nolusWallet.executeContract(
      this.contractAddress,
      feedPricesMsg(feedPrices),
      fee,
      undefined,
      fundCoin,
    );
  }
}
