import { NolusContracts, AssetUtils, NolusClient } from '@nolus/nolusjs';
import { LppBalance } from '@nolus/nolusjs/build/contracts';
import { Price } from '@nolus/nolusjs/build/contracts/types/Price';
import { TONANOSEC } from '../utils';
import NODE_ENDPOINT from '../clients';

const NANOSEC_YEAR = 365 * 24 * 60 * 60 * TONANOSEC;

export function calcBorrowLTV(downpayment: number, ltv: number): number {
  return (downpayment * ltv) / (1000 - ltv);
}

export function calcBorrowLTD(downpayment: number, ltd: number): number {
  return downpayment * (ltd / 1000);
}

export function calcUtilization( // %
  totalPrincipalDueByNow: number,
  quoteBorrow: number,
  totalInterestDueByNow: number,
  lppLiquidity: number,
  utilizationOptimalPercent: number,
): number {
  const totalLiabilityPast =
    totalInterestDueByNow + quoteBorrow + totalPrincipalDueByNow;

  const balance = lppLiquidity - quoteBorrow;
  const utilizationCoeffMaxPercent =
    (utilizationOptimalPercent / (100 - utilizationOptimalPercent)) * 100;

  let utilizationCoeffPercent;

  if (balance === 0) {
    utilizationCoeffPercent = utilizationCoeffMaxPercent;
  } else {
    utilizationCoeffPercent = Math.min(
      (totalLiabilityPast / balance) * 100,
      utilizationCoeffMaxPercent,
    );
  }
  return utilizationCoeffPercent;
}

export function calcQuoteAnnualInterestRate( // permille
  utilizationCoefPercent: number,
  utilizationOptimalPercent: number,
  baseInterestRatePercent: number,
  addonOptimalInterestRatePercent: number,
): number {
  const config = addonOptimalInterestRatePercent / utilizationOptimalPercent;
  const quoteAnnualInterestRate =
    baseInterestRatePercent + config * utilizationCoefPercent;

  return Math.round(quoteAnnualInterestRate * 10);
}

export function calcInterestRate(
  principalDue: bigint,
  interestRate: bigint,
  interestPaidByNanoSec: bigint, //until when (date) the interest is paid (nanosec)
  outstandingByNanoSec: bigint, //now (nanosec)
): bigint {
  if (
    outstandingByNanoSec === interestPaidByNanoSec ||
    outstandingByNanoSec < interestPaidByNanoSec
  )
    return BigInt(0);

  const interestPerYear = (principalDue * interestRate) / BigInt(1000);

  const duration = outstandingByNanoSec - interestPaidByNanoSec;

  return (interestPerYear * duration) / BigInt(NANOSEC_YEAR);
}

export function LTVtoLTD(ltv: number): number {
  return Math.trunc((1000 * ltv) / (1000 - ltv));
}

export function LPNS_To_NLPNS(lpns: number, price: Price): bigint {
  const result = Math.trunc(
    lpns * (+price.amount.amount / +price.amount_quote.amount),
  );

  return BigInt(result);
}

export function NLPNS_To_LPNS(nlpns: number, price: Price): bigint {
  const result = Math.trunc(
    nlpns / (+price.amount.amount / +price.amount_quote.amount),
  );

  return BigInt(result);
}

export function calcDepositCapacity(
  minUtilization: number,
  lppBalance: LppBalance,
): number {
  const totalDue =
    +lppBalance.total_principal_due.amount +
    +lppBalance.total_interest_due.amount;
  const balance = +lppBalance.balance.amount;

  return (totalDue * 100) / (minUtilization / 10) - balance - totalDue;
}

export async function currencyTicker_To_IBC(ticker: string): Promise<string> {
  NolusClient.setInstance(NODE_ENDPOINT);
  const cosm = await NolusClient.getInstance().getCosmWasmClient();

  const oracleInstance = new NolusContracts.Oracle(
    cosm,
    process.env.ORACLE_ADDRESS as string,
  );
  const currencies = await oracleInstance.getCurrencies();

  const result = AssetUtils.findBankSymbolByTicker(currencies, ticker);
  const resultString: string = result ?? '';

  if (resultString == '') {
    console.log('!!! Bank symbol not found!');
  }

  return resultString;
}

export function currencyPriceObjToNumbers(
  currencyPriceObj: NolusContracts.Price,
  tolerancePercent: number,
) {
  const exactCurrencyPrice =
    +currencyPriceObj.amount.amount / +currencyPriceObj.amount_quote.amount; // = 1LPN
  const tolerance = exactCurrencyPrice * (tolerancePercent / 100);
  const minToleranceCurrencyPrice = exactCurrencyPrice - tolerance;
  const maxToleranceCurrencyPrice = exactCurrencyPrice + tolerance;

  return [
    minToleranceCurrencyPrice,
    exactCurrencyPrice,
    maxToleranceCurrencyPrice,
  ];
}
