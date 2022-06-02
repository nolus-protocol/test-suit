import { DeliverTxResponse } from '@cosmjs/stargate';
import { NolusWallet } from '@nolus/nolusjs';
import { DEFAULT_FEE } from './utils';

export async function sendInitFeeTokens(
  client: NolusWallet,
  receiverAdr: string,
): Promise<DeliverTxResponse> {
  return await client.transferAmount(
    receiverAdr,
    DEFAULT_FEE.amount,
    DEFAULT_FEE,
    '',
  );
}
