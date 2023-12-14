import { TextDecoder } from 'node:util';
import { ExecuteResult } from '@cosmjs/cosmwasm-stargate';
import { Attribute, Event, TxResponse } from '@cosmjs/tendermint-rpc';
import { fromUtf8 } from '@cosmjs/encoding';
import { GROUPS, Protocols } from '@nolus/nolusjs/build/types/Networks';
import { AssetUtils } from '@nolus/nolusjs';
import { undefinedHandler } from '../utils';

const textDecoder = new TextDecoder();

export function findWasmEventPositions(response: any, eType: string): number[] {
  const events = response.events;
  const indexes: number[] = [];

  events.forEach((element: Event, index: number) => {
    if (element.type === eType) {
      indexes.push(index);
    }
  });

  return indexes;
}

export function findAttributePositions(event: any, aType: string): number[] {
  const attributes = event.attributes;
  const indexes: number[] = [];

  attributes.forEach((attribute: Attribute, index: number) => {
    if (textDecoder.decode(attribute.key) === aType) {
      indexes.push(index);
    }
  });

  return indexes;
}

function getAttributeValueFromWasmRepayEvent(
  response: TxResponse,
  attributeName: string,
): bigint {
  const wasmEventIndex = findWasmEventPositions(
    response.result,
    'wasm-ls-repay',
  );

  const wasmEvent = response.result.events[wasmEventIndex[0]];
  const attributeIndex = findAttributePositions(wasmEvent, attributeName);

  return BigInt(
    textDecoder.decode(wasmEvent.attributes[attributeIndex[0]].value),
  );
}

export function getLeaseGroupCurrencies(): string[] | string {
  return AssetUtils.getCurrenciesByGroupDevnet(GROUPS.Lease, Protocols.osmosis);
}

export function getLpnGroupCurrencies(): string[] | string {
  return AssetUtils.getCurrenciesByGroupDevnet(GROUPS.Lpn, Protocols.osmosis);
}

export function getNativeGroupCurrencies(): string[] | string {
  return AssetUtils.getCurrenciesByGroupDevnet(
    GROUPS.Native,
    Protocols.osmosis,
  );
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
  const wasmEventIndex = findWasmEventPositions(response, 'wasm');

  return response.events[wasmEventIndex[0]].attributes[1].value;
}

export function getMarginInterestPaidFromRepayTx(response: TxResponse): bigint {
  return getAttributeValueFromWasmRepayEvent(response, 'curr-margin-interest');
}

export function getLoanInterestPaidFromRepayTx(response: TxResponse): bigint {
  return getAttributeValueFromWasmRepayEvent(response, 'curr-loan-interest');
}

export function getPrincipalPaidFromRepayTx(response: TxResponse): bigint {
  return getAttributeValueFromWasmRepayEvent(response, 'principal');
}

export function getChangeFromRepayTx(response: TxResponse): bigint {
  return getAttributeValueFromWasmRepayEvent(response, 'change');
}

export function getTotalPaidFromRepayTx(response: TxResponse): bigint {
  return getAttributeValueFromWasmRepayEvent(response, 'payment-amount');
}

export function getMarginPaidTimeFromRawState(rawState: Uint8Array): bigint {
  return BigInt(
    JSON.parse(fromUtf8(rawState)).OpenedActive.lease.lease.loan.current_period
      .period.start,
  );
}

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
