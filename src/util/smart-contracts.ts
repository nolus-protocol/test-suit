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

// export function calcInterestRate(
//   principalDue: number,
//   interestRatePercentage: number,
//   outstandingByNanoSec: number, //now (in nanosec)
//   interestPaidByNanoSec: number, //until when (date) the interest is paid (in nanosec)
// ): number {
//   if (outstandingByNanoSec === interestPaidByNanoSec) return 0;

//   return Math.floor(
//     principalDue *
//       (interestRatePercentage / 100) *
//       ((Math.max(outstandingByNanoSec, interestPaidByNanoSec) -
//         interestPaidByNanoSec) /
//         NANOSEC_YEAR),
//   );
// }

export function calcInterestRate(
  principalDue: number,
  interestRatePercentage: number,
  outstandingByNanoSec: number, //now (in nanosec)
  interestPaidByNanoSec: number, //until when (date) the interest is paid (in nanosec)
): number {
  if (outstandingByNanoSec === interestPaidByNanoSec) return 0;

  return Math.floor(
    (Math.floor((principalDue * (interestRatePercentage * 10)) / 1000) *
      (Math.max(outstandingByNanoSec, interestPaidByNanoSec) -
        interestPaidByNanoSec)) /
      NANOSEC_YEAR,
  );
}
