const NANOSEC_YEAR = 365 * 24 * 60 * 60 * 1000000000;

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
  return Math.floor(
    (baseInterestRate +
      ((utilization - utilizationOptimal) / 100) * addonOptimalInterestRate) *
      10,
  );
}

export function calcInterestRate(
  principalDue: bigint,
  interestRate: bigint,
  outstandingByNanoSec: bigint, //now (nanosec)
  interestPaidByNanoSec: bigint, //until when (date) the interest is paid (nanosec)
): bigint {
  if (outstandingByNanoSec === interestPaidByNanoSec) return BigInt(0);
  if (outstandingByNanoSec < interestPaidByNanoSec) return BigInt(-1);

  const interestPerYear = (principalDue * interestRate) / BigInt(1000);
  const duration = outstandingByNanoSec - interestPaidByNanoSec;

  return (BigInt(interestPerYear) * BigInt(duration)) / BigInt(NANOSEC_YEAR);
}
