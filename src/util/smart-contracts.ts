import { ExecuteResult } from '@cosmjs/cosmwasm-stargate';
import { Price } from '@nolus/nolusjs/build/contracts/types/Price';

const NANOSEC_YEAR = 365 * 24 * 60 * 60 * 1000000000;

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
  utilizationOptimal: number,
  baseInterestRate: number,
  addonOptimalInterestRate: number,
): number {
  const result =
    (baseInterestRate +
      (utilization / utilizationOptimal) * addonOptimalInterestRate) *
    10;

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

export function getTotalPaidFromRepayResponse(response: ExecuteResult): bigint {
  return BigInt(response.logs[0].events[6].attributes[6].value);
}

export function getMarginPaidTimeFromRepayResponse(
  response: ExecuteResult,
): bigint {
  return BigInt(response.logs[0].events[6].attributes[2].value);
}
