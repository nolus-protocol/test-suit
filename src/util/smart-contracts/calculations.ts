import { NolusContracts, AssetUtils } from '@nolus/nolusjs';
import { Price } from '@nolus/nolusjs/build/contracts/types/Price';
import { TONANOSEC } from '../utils';

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
): number {
  const totalLiabilityPast =
    totalInterestDueByNow + quoteBorrow + totalPrincipalDueByNow;

  return (
    (totalLiabilityPast / (totalLiabilityPast + (lppLiquidity - quoteBorrow))) *
    100
  );
}

export function calcQuoteAnnualInterestRate( // permille
  utilization: number,
  utilizationOptimalPercent: number,
  baseInterestRatePercent: number,
  addonOptimalInterestRatePercent: number,
): number {
  if (utilization < 1) return baseInterestRatePercent;

  const result =
    baseInterestRatePercent +
    (utilization / utilizationOptimalPercent) * addonOptimalInterestRatePercent;

  return Math.trunc(result);
}

export function calcInterestRate(
  principalDue: bigint,
  interestRate: bigint,
  interestPaidByNanoSec: bigint, //until when (date) the interest is paid (nanosec)
  outstandingByNanoSec: bigint, //now (nanosec)
): bigint {
  if (outstandingByNanoSec === interestPaidByNanoSec) return BigInt(0);
  if (outstandingByNanoSec < interestPaidByNanoSec) return BigInt(-1);

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

export function currencyTicker_To_IBC(ticker: string): string {
  return AssetUtils.makeIBCMinimalDenom(ticker);
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
