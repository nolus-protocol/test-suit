import { NolusContracts, NolusWallet, AssetUtils } from '@nolus/nolusjs';
import { Price } from '@nolus/nolusjs/build/contracts/types/Price';
import { customFees, NANOSEC } from '../utils';
import * as FEEDERS from '../../../feeders.json';

const NANOSEC_YEAR = 365 * 24 * 60 * 60 * NANOSEC;

export function calcBorrow(downpayment: number, initPercent: number): number {
  return (downpayment * initPercent) / (1000 - initPercent);
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
  const result =
    (baseInterestRatePercent +
      (utilization / utilizationOptimalPercent) *
        addonOptimalInterestRatePercent) *
    10; // permille

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

export async function registerAllFeedersBack(
  oracleInstance: NolusContracts.Oracle,
  wasmAdminWallet: NolusWallet,
): Promise<void> {
  const allFeeders = FEEDERS.data;
  for (let i = 0; i < allFeeders.length; i++) {
    await oracleInstance.addFeeder(
      wasmAdminWallet,
      allFeeders[i],
      customFees.exec,
    );
  }
}
