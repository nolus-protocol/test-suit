import { AssetUtils, NolusContracts } from '@nolus/nolusjs';
import { ExecuteResult } from '@cosmjs/cosmwasm-stargate';
import { undefinedHandler } from '../utils';

export function getLeaseGroupCurrencies(): string[] {
  return AssetUtils.getCurrenciesByGroup('Lease');
}

export function getLpnGroupCurrencies(): string[] {
  return AssetUtils.getCurrenciesByGroup('Lpn');
}

export function getPaymentGroupCurrencies(): string[] {
  return AssetUtils.getCurrenciesByGroup('Payment');
}

export function getLeaseAddressFromOpenLeaseResponse(
  response: ExecuteResult,
): string {
  return response.logs[0].events[8].attributes[3].value;
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

// export function getOnlyPaymentCurrencies(): string[] {
//   const paymentCurrencies = getPaymentGroupCurrencies();
//   const leaseCurrencies = getLeaseGroupCurrencies();
//   const lpnCurrencies = getLpnGroupCurrencies();
//   const paymentCurrenciesOnly = paymentCurrencies.filter(
//     (currency) =>
//       leaseCurrencies.indexOf(currency) < 0 &&
//       lpnCurrencies.indexOf(currency) < 0,
//   );
//   return paymentCurrenciesOnly;
// }

export function getCurrencyOtherThan(unlikeCurrencies: string[]): string {
  const supportedCurrencies = getPaymentGroupCurrencies();
  const currencyTicker = supportedCurrencies.find(
    (currency) => !unlikeCurrencies.includes(currency),
  );

  if (!currencyTicker) {
    undefinedHandler();
    return 'undefined';
  }
  console.log(currencyTicker);
  return currencyTicker;
}
