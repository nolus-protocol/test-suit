import { AssetUtils } from '@nolus/nolusjs';
import { ExecuteResult } from '@cosmjs/cosmwasm-stargate';
import { Event, TxResponse } from '@cosmjs/tendermint-rpc';
import { undefinedHandler } from '../utils';
import { TextDecoder } from 'node:util';

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

export function getMarginPaidTimeFromRepayTx(response: TxResponse): bigint {
  return getAttributeValueFromWasmRepayEvent(response, 2);
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
