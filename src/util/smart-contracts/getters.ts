import { AssetUtils } from '@nolus/nolusjs';
import { ExecuteResult } from '@cosmjs/cosmwasm-stargate';

export function getCurrenciesByGroup(group: string): string[] {
  return AssetUtils.getCurrenciesByGroup(group);
}

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

export function getOnlyPaymentCurrencies(): string[] {
  const paymentCurrencies = getPaymentGroupCurrencies();
  const leaseCurrencies = getLeaseGroupCurrencies();
  const lpnCurrencies = getLpnGroupCurrencies();
  const paymentCurrenciesOnly = paymentCurrencies.filter(
    (currency) =>
      leaseCurrencies.indexOf(currency) < 0 &&
      lpnCurrencies.indexOf(currency) < 0,
  );
  return paymentCurrenciesOnly;
}

// export async function getCurrencyOtherThan(
//   oracleInstance: NolusContracts.Oracle,
//   lppCurrency: string,
// ): Promise<string> {
//   const supportedPairs = await oracleInstance.getCurrencyPairs();
//   const pairWithLPN = supportedPairs.find(
//     (pair) => pair.to.target === lppCurrency,
//   );

//   if (!pairWithLPN) {
//     undefinedHandler();
//     return 'undefined';
//   }
//   console.log(pairWithLPN);
//   return pairWithLPN.from;
// }
