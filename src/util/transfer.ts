import {
  DeliverTxResponse,
  QueryClient,
  assertIsDeliverTxSuccess,
  setupBankExtension,
} from '@cosmjs/stargate';
import { Coin } from '@cosmjs/proto-signing';
import { connectComet } from '@cosmjs/tendermint-rpc';
import { NolusWallet } from '@nolus/nolusjs';
import { getUser1Wallet } from './clients';
import { GASPRICE, NATIVE_MINIMAL_DENOM, customFees } from './utils';

export async function sendInitTransferFeeTokens(
  client: NolusWallet,
  receiverAdr: string,
): Promise<DeliverTxResponse> {
  return await client.transferAmount(
    receiverAdr,
    customFees.transfer.amount,
    customFees.transfer,
  );
}

async function sendSweepFeeTokens(
  client: NolusWallet,
  receiverAdr: string,
): Promise<DeliverTxResponse> {
  return await client.transferAmount(
    receiverAdr,
    customFees.sweep.amount,
    customFees.transfer,
  );
}

export async function sendInitExecuteFeeTokens(
  client: NolusWallet,
  receiverAdr: string,
): Promise<DeliverTxResponse> {
  return await client.transferAmount(
    receiverAdr,
    customFees.exec.amount,
    customFees.transfer,
  );
}

export async function returnRestToMainAccount(
  sender: NolusWallet,
  denom: string,
): Promise<void> {
  const mainAccount = await getUser1Wallet();
  const senderBalance = await sender.getBalance(
    sender.address as string,
    denom,
  );

  await sendInitTransferFeeTokens(mainAccount, sender.address as string);

  const amount = {
    amount: senderBalance.amount.toString(),
    denom: denom,
  };

  if (+amount.amount > 0) {
    await sender.transferAmount(
      mainAccount.address as string,
      [amount],
      customFees.transfer,
    );
  }
}

export async function returnAllFundsToMainAccount(
  wallet: NolusWallet,
): Promise<void> {
  const mainAccount = await getUser1Wallet();
  const address = wallet.address as string;

  if (address === (mainAccount.address as string)) {
    return;
  }

  const sweepFee = BigInt(customFees.sweep.amount[0].amount);
  const balances = await allBalances(address);

  const others: Coin[] = balances.filter(
    (coin) => coin.denom !== NATIVE_MINIMAL_DENOM && BigInt(coin.amount) > 0n,
  );

  let native = BigInt(
    balances.find((coin) => coin.denom === NATIVE_MINIMAL_DENOM)?.amount ?? '0',
  );

  if (others.length === 0 && native <= sweepFee) {
    return;
  }

  if (native < sweepFee) {
    assertIsDeliverTxSuccess(await sendSweepFeeTokens(mainAccount, address));
    native = BigInt(
      (await wallet.getBalance(address, NATIVE_MINIMAL_DENOM)).amount,
    );
  }

  const nativeLeft = native - sweepFee;
  const sweep =
    nativeLeft > 0n
      ? [
          ...others,
          { denom: NATIVE_MINIMAL_DENOM, amount: nativeLeft.toString() },
        ]
      : others;

  if (sweep.length === 0) {
    return;
  }

  sweep.sort((a, b) => (a.denom < b.denom ? -1 : a.denom > b.denom ? 1 : 0));

  assertIsDeliverTxSuccess(
    await wallet.transferAmount(
      mainAccount.address as string,
      sweep,
      customFees.sweep,
    ),
  );
}

export async function allBalances(address: string): Promise<readonly Coin[]> {
  const cometClient = await connectComet(process.env.NODE_URL as string);

  try {
    return await QueryClient.withExtensions(
      cometClient,
      setupBankExtension,
    ).bank.allBalances(address);
  } finally {
    cometClient.disconnect();
  }
}

export function calcFeeProfit(fee: any): number {
  const percision = 100000;
  const gasPriceInteger = GASPRICE * percision;

  const profit = Math.trunc(
    +fee.amount[0].amount - (+fee.gas * gasPriceInteger) / percision,
  );

  return profit;
}
