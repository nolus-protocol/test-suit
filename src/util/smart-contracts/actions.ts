import { NolusContracts, NolusWallet } from '@nolus/nolusjs';
import { getUser1Wallet, getWasmAdminWallet } from '../clients';
import { returnRestToMainAccount, sendInitExecuteFeeTokens } from '../transfer';
import { customFees, NATIVE_MINIMAL_DENOM } from '../utils';
import { removeAllFeeders } from './calculations';
import { ExecuteResult } from '@cosmjs/cosmwasm-stargate';

export async function pushPrice(
  oracleInstance: NolusContracts.Oracle,
  priceFeederWallet: NolusWallet,
  firstPairMemberCurrency: string,
  secondPairMemberCurrency: string,
  firstPairMemberValue: string,
  secondPairMemberValue: string,
): Promise<ExecuteResult> {
  const userWithBalanceWallet = await getUser1Wallet();
  const wasmAdminWallet = await getWasmAdminWallet();
  // remove all feeders
  await removeAllFeeders(oracleInstance, wasmAdminWallet);

  // add feeder
  await sendInitExecuteFeeTokens(
    userWithBalanceWallet,
    wasmAdminWallet.address as string,
  );

  await oracleInstance.addFeeder(
    wasmAdminWallet,
    priceFeederWallet.address as string,
    customFees.exec,
  );

  const isFeeder = await oracleInstance.isFeeder(
    priceFeederWallet.address as string,
  );
  expect(isFeeder).toBe(true);

  await sendInitExecuteFeeTokens(
    userWithBalanceWallet,
    wasmAdminWallet.address as string,
  );

  const feedPrices = {
    prices: [
      {
        amount: {
          amount: firstPairMemberValue,
          ticker: firstPairMemberCurrency,
        }, // any amount
        amount_quote: {
          amount: secondPairMemberValue,
          ticker: secondPairMemberCurrency,
        }, // any amount
      },
    ],
  };

  await userWithBalanceWallet.transferAmount(
    priceFeederWallet.address as string,
    customFees.feedPrice.amount,
    customFees.transfer,
    '',
  );

  const feedPriceTxReponse = await oracleInstance.feedPrices(
    priceFeederWallet,
    feedPrices,
    1.3,
  );

  await returnRestToMainAccount(userWithBalanceWallet, NATIVE_MINIMAL_DENOM);

  const priceResult = await oracleInstance.getPriceFor(firstPairMemberCurrency);
  expect(priceResult).toBeDefined();

  return feedPriceTxReponse;
}
