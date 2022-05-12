import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { DeliverTxResponse } from '@cosmjs/stargate';
import { DEFAULT_FEE } from './utils';

export async function sendInitFeeTokens(
  client: SigningCosmWasmClient,
  senderAdr: string,
  receiverAdr: string,
): Promise<DeliverTxResponse> {
  // send some tokens
  return await client.sendTokens(
    senderAdr,
    receiverAdr,
    DEFAULT_FEE.amount,
    DEFAULT_FEE,
  );
}
