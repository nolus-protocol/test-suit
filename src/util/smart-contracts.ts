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
  principalDue: number,
  annualInterestRatePercentage: number,
  outstandingBySec: number, //now (in nanosec)
  interestPaidByNanoSec: number, //until when (date) the interest is paid (in nanosec)
): number {
  return Math.floor(
    principalDue *
      (annualInterestRatePercentage / 100) *
      ((outstandingBySec - interestPaidByNanoSec) / NANOSEC_YEAR),
  );
}
