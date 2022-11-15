import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';
import { createWallet, getUser1Wallet, getWasmAdminWallet } from '../clients';
import { returnRestToMainAccount, sendInitExecuteFeeTokens } from '../transfer';
import { customFees, NATIVE_MINIMAL_DENOM, sleep } from '../utils';
import { currencyTicker_To_IBC } from './calculations';
import { ExecuteResult } from '@cosmjs/cosmwasm-stargate';
import { getLeaseAddressFromOpenLeaseResponse } from './getters';

export async function provideLeasePrices(
  oracleInstance: NolusContracts.Oracle,
  leaseOrPaymentCurrency: string,
  lppCurrency: string,
): Promise<number> {
  // push price for leaseCurrency
  const feeder = await createWallet();
  const firstPriceMemberValue = '6000';
  const secondPriceMemberValue = '3000';
  await pushPrice(
    oracleInstance,
    feeder,
    leaseOrPaymentCurrency,
    lppCurrency,
    firstPriceMemberValue,
    secondPriceMemberValue,
  );
  const leaseCurrencyPrice = +firstPriceMemberValue / +secondPriceMemberValue;

  return leaseCurrencyPrice;
}
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
        },
        amount_quote: {
          amount: secondPairMemberValue,
          ticker: secondPairMemberCurrency,
        },
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

export async function provideEnoughLiquidity(
  leaserInstance: NolusContracts.Leaser,
  lppInstance: NolusContracts.Lpp,
  downpayment: string,
  downpaymentCurrency: string,
  leaseCurrency: string,
) {
  const depositAmountLPP = '100000';
  const userWithBalanceWallet = await getUser1Wallet();
  const lppCurrencyToIBC = currencyTicker_To_IBC(
    (await lppInstance.getLppConfig()).lpn_ticker,
  );
  let quote;
  do {
    try {
      quote = await leaserInstance.leaseQuote(
        downpayment,
        downpaymentCurrency,
        leaseCurrency,
      );
    } catch (err) {
      await lppInstance.deposit(userWithBalanceWallet, customFees.exec, [
        { denom: lppCurrencyToIBC, amount: depositAmountLPP },
      ]);
    }
  } while (!quote);
}

export async function removeAllFeeders(
  oracleInstance: NolusContracts.Oracle,
  wasmAdminWallet: NolusWallet,
): Promise<void> {
  const allFeeders = await oracleInstance.getFeeders();

  for (let i = 0; i < allFeeders.length; i++) {
    console.log('Feeder removing...');
    await oracleInstance.removeFeeder(
      wasmAdminWallet,
      allFeeders[i],
      customFees.exec,
    );
  }
}

export async function checkLeaseBalance(
  leaseAddress: string,
  currenciesTickers: string[],
): Promise<boolean> {
  const cosm = await NolusClient.getInstance().getCosmWasmClient();

  currenciesTickers.forEach((ticker) => async () => {
    const tickerToIbc = currencyTicker_To_IBC(ticker);
    const leaseBalance = await cosm.getBalance(leaseAddress, tickerToIbc);
    if (leaseBalance.amount) return true;
  });
  return false;
}

export async function waitLeaseOpeningProcess(
  leaseInstance: NolusContracts.Lease,
): Promise<Error | undefined> {
  const allStates = [
    'connecting',
    'account creating',
    'transfer-1',
    'transfer-2',
    'opened',
  ];
  let indexLastState = 0;
  let newState;

  do {
    await sleep(5);
    newState = JSON.stringify(await leaseInstance.getLeaseStatus());
    const indexNewState = allStates.indexOf(Object.keys(newState)[0]);
    if (indexLastState > indexNewState) {
      return new Error('Error');
    }
    indexLastState = indexNewState;
  } while (indexLastState != allStates.length - 1);

  return undefined;
}
