import { TextDecoder } from 'node:util';
import { AssetUtils } from '@nolus/nolusjs';
import { ExecuteResult } from '@cosmjs/cosmwasm-stargate';
import { Event, TxResponse } from '@cosmjs/tendermint-rpc';
import { fromUtf8 } from '@cosmjs/encoding';
import { undefinedHandler } from '../utils';
import { GROUPS } from '@nolus/nolusjs/build/types/Networks';

const textDecoder = new TextDecoder();

function findWasmEventPosition(response: any, eType: string): number {
  const events = response.events;
  const index = events.findIndex((e: Event) => e.type === eType);

  return index;
}

function getAttributeValueFromWasmRepayEvent(
  response: TxResponse,
  attributeIndex: number,
): bigint {
  const wasmEventIndex = findWasmEventPosition(
    response.result,
    'wasm-ls-repay',
  );

  return BigInt(
    textDecoder.decode(
      response.result.events[wasmEventIndex].attributes[attributeIndex].value,
    ),
  );
}

export function getLeaseGroupCurrencies(): string[] | string {
  return AssetUtils.getCurrenciesByGroupTestnet(GROUPS.Lease);
}

export function getLpnGroupCurrencies(): string[] | string {
  return AssetUtils.getCurrenciesByGroupTestnet(GROUPS.Lpn);
}

export function getNativeGroupCurrencies(): string[] | string {
  return AssetUtils.getCurrenciesByGroupTestnet(GROUPS.Native);
}

export function getPaymentGroupCurrencies(): string[] {
  const nativeCurrency = getNativeGroupCurrencies();
  const lpnCurrencies = getLpnGroupCurrencies();
  const leaseCurrencies = getLeaseGroupCurrencies();

  const allCurencies: string[] = ([] as string[]).concat(
    Array.isArray(nativeCurrency) ? nativeCurrency : [nativeCurrency],
    Array.isArray(lpnCurrencies) ? lpnCurrencies : [lpnCurrencies],
    Array.isArray(leaseCurrencies) ? leaseCurrencies : [leaseCurrencies],
  );

  return allCurencies;
}

export function getLeaseAddressFromOpenLeaseResponse(
  response: ExecuteResult,
): string {
  const wasmEventIndex = findWasmEventPosition(response, 'wasm');

  return response.events[wasmEventIndex].attributes[1].value;
}

export function getMarginInterestPaidFromRepayTx(response: TxResponse): bigint {
  return getAttributeValueFromWasmRepayEvent(response, 10);
}

export function getLoanInterestPaidFromRepayTx(response: TxResponse): bigint {
  return getAttributeValueFromWasmRepayEvent(response, 11);
}

export function getPrincipalPaidFromRepayTx(response: TxResponse): bigint {
  return getAttributeValueFromWasmRepayEvent(response, 12);
}

export function getChangeFromRepayTx(response: TxResponse): bigint {
  return getAttributeValueFromWasmRepayEvent(response, 13);
}

export function getTotalPaidFromRepayTx(response: TxResponse): bigint {
  return getAttributeValueFromWasmRepayEvent(response, 6);
}

export function getMarginPaidTimeFromRawState(rawState: Uint8Array): bigint {
  return BigInt(
    JSON.parse(fromUtf8(rawState)).OpenedActive.lease.lease.loan.current_period
      .period.start,
  );
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

  return currencyTicker;
}
