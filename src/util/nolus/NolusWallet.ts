import {
  ExecuteResult,
  JsonObject,
  SigningCosmWasmClient,
  SigningCosmWasmClientOptions,
} from '@cosmjs/cosmwasm';
import { Coin, DeliverTxResponse, StdFee } from '@cosmjs/stargate';
import { OfflineDirectSigner } from '@cosmjs/proto-signing';
import { CometClient, connectComet } from '@cosmjs/tendermint-rpc';
import { NolusClient } from './NolusClient';

export class NolusWallet extends SigningCosmWasmClient {
  address?: string;

  private readonly directSigner: OfflineDirectSigner;

  constructor(
    cometClient: CometClient,
    signer: OfflineDirectSigner,
    options: SigningCosmWasmClientOptions = {},
  ) {
    super(cometClient, signer, options);
    this.directSigner = signer;
  }

  async useAccount(): Promise<boolean> {
    const accounts = await this.directSigner.getAccounts();

    if (accounts.length === 0) {
      throw new Error('Missing account');
    }

    this.address = accounts[0].address;

    return true;
  }

  private senderAddress(): string {
    if (!this.address) {
      throw new Error('Sender address is missing — call `useAccount()` first.');
    }

    return this.address;
  }

  async transferAmount(
    receiverAddress: string,
    amount: Coin[],
    fee: StdFee | 'auto' | number,
    memo?: string,
  ): Promise<DeliverTxResponse> {
    return this.sendTokens(
      this.senderAddress(),
      receiverAddress,
      amount,
      fee,
      memo,
    );
  }

  async executeContract(
    contractAddress: string,
    msg: JsonObject,
    fee: StdFee | 'auto' | number,
    memo?: string,
    funds?: Coin[],
  ): Promise<ExecuteResult> {
    return this.execute(
      this.senderAddress(),
      contractAddress,
      msg,
      fee,
      memo,
      funds,
    );
  }
}

export async function nolusOfflineSigner(
  offlineDirectSigner: OfflineDirectSigner,
): Promise<NolusWallet> {
  const cometClient = await connectComet(NolusClient.getInstance().rpcEndpoint);

  return new NolusWallet(cometClient, offlineDirectSigner);
}
