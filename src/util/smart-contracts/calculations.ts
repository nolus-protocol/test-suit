import { NolusClient } from '../nolus';
import { TONANOSEC, undefinedHandler } from '../utils';
import NODE_ENDPOINT from '../clients';
import { getLeaseObligations } from './getters';
import {
  CurrencyInfo,
  Lease,
  InterestRate,
  LppBalance,
  Oracle,
  PriceRatio,
  findBankSymbolByTicker,
} from '../contracts';

const NANOSEC_YEAR = 365 * 24 * 60 * 60 * TONANOSEC;

export async function calcLTV( // permille
  leaseInstance: Lease,
  oracleInstance: Oracle,
): Promise<number> {
  const leaseState = (await leaseInstance.getLeaseStatus()).opened;

  if (!leaseState) {
    throw new Error(
      'Cannot compute the LTV: the lease is not opened. Its state is ' +
        `${JSON.stringify(await leaseInstance.getLeaseStatus())}.`,
    );
  }

  const leaseAmount = leaseState.amount.amount;
  const leaseCurrency = leaseState.amount.ticker;

  if (!leaseCurrency) {
    throw new Error(
      'Cannot compute the LTV: the opened lease carries no asset ticker.',
    );
  }

  const priceObj = await oracleInstance.getBasePrice(leaseCurrency);
  const { exact: exactCurrencyPrice_LC } = currencyPriceObjToNumbers(
    priceObj,
    1,
  );

  const leaseAmountToLPN = +leaseAmount / exactCurrencyPrice_LC;

  const obligations = getLeaseObligations(leaseState, true);

  if (!obligations) {
    throw new Error(
      'Cannot compute the LTV: the opened lease reports no obligations.',
    );
  }

  const LTV = Math.trunc((obligations / leaseAmountToLPN) * 1000);

  return LTV;
}

export function calcBorrowedAmountLTV(
  downpayment: number,
  ltv: number,
): number {
  return (downpayment * ltv) / (1000 - ltv);
}

export function calcBorrowedAmountLTD(
  downpayment: number,
  ltd: number,
): number {
  return downpayment * (ltd / 1000);
}

export function calcQuoteAnnualInterestRate( // permille
  totalPrincipalDueByNow: bigint,
  totalInterestDueByNow: bigint,
  quoteBorrow: bigint,
  lppLiquidity: bigint,
  borrowRate: InterestRate,
): number {
  const MILLE = 1000n;
  const utilizationOptimal = BigInt(borrowRate.utilization_optimal);

  const totalLiabilityPastQuote =
    totalPrincipalDueByNow + quoteBorrow + totalInterestDueByNow;
  const balancePastQuote = lppLiquidity - quoteBorrow;

  const utilizationFactorMax =
    (utilizationOptimal * MILLE) / (MILLE - utilizationOptimal);

  let utilizationFactor: bigint;

  if (balancePastQuote === 0n) {
    utilizationFactor = utilizationFactorMax;
  } else {
    const factor = (totalLiabilityPastQuote * MILLE) / balancePastQuote;
    utilizationFactor =
      factor < utilizationFactorMax ? factor : utilizationFactorMax;
  }

  return Number(
    (BigInt(borrowRate.addon_optimal_interest_rate) * utilizationFactor) /
      utilizationOptimal +
      BigInt(borrowRate.base_interest_rate),
  );
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

export function LPNS_To_NLPNS(lpns: number, price: PriceRatio): bigint {
  const result = Math.trunc(
    lpns * (+price.amount.amount / +price.amount_quote.amount),
  );

  return BigInt(result);
}

export function NLPNS_To_LPNS(nlpns: number, price: PriceRatio): bigint {
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

// `NolusClient.setInstance` constructs a whole new client — and so a new connection — every time
// it is called, and never closes the one it replaces. This helper has 34 call sites and used to
// call it, plus re-query the currency list, on every single invocation; across a run that is
// hundreds of connections to the same host, which the endpoint in front of rila answers by
// refusing to connect at all. The list is chain configuration and does not move during a run, so
// it is fetched once. The promise is cached, not the value, so concurrent callers share one
// request; a failure clears the cache so the next caller retries instead of inheriting it.
let currenciesOnce: Promise<CurrencyInfo[]> | undefined;

// Every suite sets the instance in its own `beforeAll`, but this helper is reachable from places
// that do not, and `getInstance()` throws rather than defaulting. Setting it only when it is
// missing keeps those callers working without reconstructing the client of the ones that did.
function clientInstance(): NolusClient {
  try {
    return NolusClient.getInstance();
  } catch {
    NolusClient.setInstance(NODE_ENDPOINT);

    return NolusClient.getInstance();
  }
}

async function currencies(): Promise<CurrencyInfo[]> {
  if (currenciesOnce === undefined) {
    currenciesOnce = (async () => {
      const cosm = await clientInstance().getCosmWasmClient();
      const oracleInstance = new Oracle(
        cosm,
        process.env.ORACLE_ADDRESS as string,
      );

      return await oracleInstance.getCurrencies();
    })().catch((error) => {
      currenciesOnce = undefined;
      throw error;
    });
  }

  return await currenciesOnce;
}

export async function currencyTicker_To_IBC(ticker: string): Promise<string> {
  const result = findBankSymbolByTicker(await currencies(), ticker);
  const resultString: string = result ?? '';

  if (resultString == '') {
    console.log('!!! Bank symbol not found!');
  }

  return resultString;
}

export function currencyPriceObjToNumbers(
  currencyPriceObj: PriceRatio,
  tolerancePercent: number,
): { min: number; exact: number; max: number } {
  const exact =
    +currencyPriceObj.amount.amount / +currencyPriceObj.amount_quote.amount; // = 1LPN
  const tolerance = exact * (tolerancePercent / 100);

  return { min: exact - tolerance, exact, max: exact + tolerance };
}
