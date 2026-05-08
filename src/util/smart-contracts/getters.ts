import { ExecuteResult } from '@cosmjs/cosmwasm-stargate';
import { fromUtf8 } from '@cosmjs/encoding';
import { GROUPS } from '@nolus/nolusjs/build/types/Networks';
import { AssetUtils, NolusContracts } from '@nolus/nolusjs';
import { LeaseStatus } from '@nolus/nolusjs/build/contracts';
import { undefinedHandler } from '../utils';

// `@cosmjs/tendermint-rpc` types are version-specific in CosmJS 0.38+.
// We only need a tiny subset for parsing events in test helpers.
type RpcAttribute = { key: Uint8Array | string; value: Uint8Array | string };
type RpcEvent = { type: string; attributes: readonly RpcAttribute[] };
type RpcTxResponse = { result: { events: readonly RpcEvent[] } };

export function getProtocol() {
  return process.env.PROTOCOL as string;
}

export function findWasmEventPositions(response: any, eType: string): number[] {
  const events = response.events;
  const indexes: number[] = [];

  events.forEach((element: RpcEvent, index: number) => {
    if (element.type === eType) {
      indexes.push(index);
    }
  });

  return indexes;
}

export function findAttributePositions(event: any, aType: string): number[] {
  const attributes = event.attributes;
  const indexes: number[] = [];

  attributes.forEach((attribute: RpcAttribute, index: number) => {
    if (attribute.key.toString() === aType) {
      indexes.push(index);
    }
  });

  return indexes;
}

function getAttributeValueFromWasmRepayEvent(
  response: RpcTxResponse,
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

async function getOracleCurrencies(
  oracleInstance: NolusContracts.Oracle,
): Promise<NolusContracts.CurrencyInfo[]> {
  return await oracleInstance.getCurrencies();
}

export async function getLeaseGroupCurrencies(
  oracleInstance: NolusContracts.Oracle,
): Promise<string[]> {
  const currencies = await getOracleCurrencies(oracleInstance);
  return AssetUtils.findTickersByGroup(currencies, GROUPS.Lease);
}

export async function getLpnGroupCurrencies(
  oracleInstance: NolusContracts.Oracle,
): Promise<string[]> {
  const currencies = await getOracleCurrencies(oracleInstance);
  return AssetUtils.findTickersByGroup(currencies, GROUPS.Lpn);
}

export async function getNativeGroupCurrencies(
  oracleInstance: NolusContracts.Oracle,
): Promise<string[]> {
  const currencies = await getOracleCurrencies(oracleInstance);
  return AssetUtils.findTickersByGroup(currencies, GROUPS.Native);
}

export async function getPaymentGroupCurrencies(
  oracleInstance: NolusContracts.Oracle,
): Promise<string[]> {
  const nativeCurrency = await getNativeGroupCurrencies(oracleInstance);
  const lpnCurrencies = await getLpnGroupCurrencies(oracleInstance);
  const leaseCurrencies = await getLeaseGroupCurrencies(oracleInstance);

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

export function getMarginInterestPaidFromRepayTx(
  response: RpcTxResponse,
): bigint {
  return getAttributeValueFromWasmRepayEvent(response, 'due-margin-interest');
}

export function getLoanInterestPaidFromRepayTx(
  response: RpcTxResponse,
): bigint {
  return getAttributeValueFromWasmRepayEvent(response, 'due-loan-interest');
}

export function getPrincipalPaidFromRepayTx(response: RpcTxResponse): bigint {
  return getAttributeValueFromWasmRepayEvent(response, 'principal');
}

export function getChangeFromRepayTx(response: RpcTxResponse): bigint {
  return getAttributeValueFromWasmRepayEvent(response, 'change');
}

export function getTotalPaidFromRepayTx(response: RpcTxResponse): bigint {
  return getAttributeValueFromWasmRepayEvent(response, 'payment-amount');
}

export function getMarginPaidTimeFromRawState(rawState: Uint8Array): bigint {
  return BigInt(
    JSON.parse(fromUtf8(rawState)).OpenedActive.lease.lease.loan.margin_paid_by,
  );
}

export async function getCurrencyOtherThan(
  unlikeCurrencies: string[],
  oracleInstance: NolusContracts.Oracle,
): Promise<string> {
  const supportedCurrencies = await getPaymentGroupCurrencies(oracleInstance);
  const currencyTicker = supportedCurrencies.find(
    (currency) => !unlikeCurrencies.includes(currency),
  );

  if (!currencyTicker) {
    undefinedHandler();
    return 'undefined';
  }

  return currencyTicker;
}

export function getLeaseObligations(
  leaseState: LeaseStatus['opened'],
  includePrincipal: boolean,
): number | undefined {
  if (!leaseState) {
    undefinedHandler();
    return;
  }

  const interest =
    +leaseState.due_interest.amount +
    +leaseState.due_margin.amount +
    +leaseState.overdue_interest.amount +
    +leaseState.overdue_margin.amount;

  return includePrincipal
    ? interest + +leaseState.principal_due.amount
    : interest;
}
