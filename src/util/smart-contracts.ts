import { ExecuteResult } from '@cosmjs/cosmwasm-stargate';
import { NolusContracts, NolusWallet } from '@nolus/nolusjs';
import { Price } from '@nolus/nolusjs/build/contracts/types/Price';
import { customFees, NANOSEC } from './utils';

const NANOSEC_YEAR = 365 * 24 * 60 * 60 * NANOSEC;

export function calcBorrow(downpayment: bigint, initPercent: bigint): bigint {
  return (downpayment * initPercent) / (BigInt(1000) - initPercent);
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

export function getLeaseAddressFromOpenLeaseResponse(
  response: ExecuteResult,
): string {
  return response.logs[0].events[7].attributes[3].value;
}

export function getMarginInterestPaidFromRepayResponse(
  response: ExecuteResult,
): bigint {
  return BigInt(response.logs[0].events[6].attributes[10].value);
}

export function getLoanInterestPaidFromRepayResponse(
  response: ExecuteResult,
): bigint {
  return BigInt(response.logs[0].events[6].attributes[11].value);
}

export function getPrincipalPaidFromRepayResponse(
  response: ExecuteResult,
): bigint {
  return BigInt(response.logs[0].events[6].attributes[12].value);
}

export function getChangeFromRepayResponse(response: ExecuteResult): bigint {
  return BigInt(response.logs[0].events[6].attributes[13].value);
}

export function getTotalPaidFromRepayResponse(response: ExecuteResult): bigint {
  return BigInt(response.logs[0].events[6].attributes[6].value);
}

export function getMarginPaidTimeFromRepayResponse(
  response: ExecuteResult,
): bigint {
  return BigInt(response.logs[0].events[6].attributes[2].value);
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
