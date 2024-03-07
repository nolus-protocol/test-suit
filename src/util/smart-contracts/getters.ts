import { ExecuteResult } from '@cosmjs/cosmwasm-stargate';
import { Attribute, Event, TxResponse } from '@cosmjs/tendermint-rpc';
import { fromUtf8 } from '@cosmjs/encoding';
import { GROUPS } from '@nolus/nolusjs/build/types/Networks';
import { AssetUtils } from '@nolus/nolusjs';
import { undefinedHandler } from '../utils';

export function getProtocol() {
  return process.env.PROTOCOL as string;
}

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
    if (attribute.key.toString() === aType) {
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

  return BigInt(wasmEvent.attributes[attributeIndex[0]].value.toString());
}

export function getLeaseGroupCurrencies(): string[] | string {
  return AssetUtils.getCurrenciesByGroupDevnet(GROUPS.Lease, getProtocol());
}

export function getLpnGroupCurrencies(): string[] | string {
  return AssetUtils.getCurrenciesByGroupDevnet(GROUPS.Lpn, getProtocol());
}

export function getNativeGroupCurrencies(): string[] | string {
  return AssetUtils.getCurrenciesByGroupDevnet(GROUPS.Native, getProtocol());
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
  return getAttributeValueFromWasmRepayEvent(response, 'due-margin-interest');
}

export function getLoanInterestPaidFromRepayTx(response: TxResponse): bigint {
  return getAttributeValueFromWasmRepayEvent(response, 'due-loan-interest');
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
  if (unlikeCurrencies.includes('USDC')) {
    unlikeCurrencies.push('USDC_AXELAR');
  }

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
