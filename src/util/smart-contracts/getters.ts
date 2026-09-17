import { ExecuteResult } from '@cosmjs/cosmwasm';
import { comet38 } from '@cosmjs/tendermint-rpc';
import { fromUtf8 } from '@cosmjs/encoding';
import {
  CurrencyGroup,
  CurrencyInfo,
  LeaseStatus,
  Oracle,
  findTickersByGroup,
} from '../contracts';
import { undefinedHandler } from '../utils';

export function getProtocol() {
  return process.env.PROTOCOL as string;
}

export function findWasmEventPositions(response: any, eType: string): number[] {
  const events = response.events;
  const indexes: number[] = [];

  events.forEach((element: comet38.Event, index: number) => {
    if (element.type === eType) {
      indexes.push(index);
    }
  });

  return indexes;
}

export function findAttributePositions(event: any, aType: string): number[] {
  const attributes = event.attributes;
  const indexes: number[] = [];

  attributes.forEach((attribute: comet38.Attribute, index: number) => {
    if (attribute.key.toString() === aType) {
      indexes.push(index);
    }
  });

  return indexes;
}

function getAttributeValueFromWasmRepayEvent(
  response: comet38.TxResponse,
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
  oracleInstance: Oracle,
): Promise<CurrencyInfo[]> {
  return await oracleInstance.getCurrencies();
}

export async function getLeaseGroupCurrencies(
  oracleInstance: Oracle,
): Promise<string[]> {
  const currencies = await getOracleCurrencies(oracleInstance);
  return findTickersByGroup(currencies, CurrencyGroup.Lease);
}

export async function getLpnGroupCurrencies(
  oracleInstance: Oracle,
): Promise<string[]> {
  const currencies = await getOracleCurrencies(oracleInstance);
  return findTickersByGroup(currencies, CurrencyGroup.Lpn);
}

export async function getNativeGroupCurrencies(
  oracleInstance: Oracle,
): Promise<string[]> {
  const currencies = await getOracleCurrencies(oracleInstance);
  return findTickersByGroup(currencies, CurrencyGroup.Native);
}

export async function getPaymentGroupCurrencies(
  oracleInstance: Oracle,
): Promise<string[]> {
  const currencies = await getOracleCurrencies(oracleInstance);

  return [
    CurrencyGroup.Native,
    CurrencyGroup.Lpn,
    CurrencyGroup.Lease,
    CurrencyGroup.PaymentOnly,
  ].flatMap((group) => findTickersByGroup(currencies, group));
}

export function getLeaseAddressFromOpenLeaseResponse(
  response: ExecuteResult,
): string {
  const wasmEventIndex = findWasmEventPositions(response, 'wasm');

  return response.events[wasmEventIndex[0]].attributes[1].value;
}

export function getMarginInterestPaidFromRepayTx(
  response: comet38.TxResponse,
): bigint {
  return getAttributeValueFromWasmRepayEvent(response, 'due-margin-interest');
}

export function getLoanInterestPaidFromRepayTx(
  response: comet38.TxResponse,
): bigint {
  return getAttributeValueFromWasmRepayEvent(response, 'due-loan-interest');
}

export function getPrincipalPaidFromRepayTx(
  response: comet38.TxResponse,
): bigint {
  return getAttributeValueFromWasmRepayEvent(response, 'principal');
}

export function getChangeFromRepayTx(response: comet38.TxResponse): bigint {
  return getAttributeValueFromWasmRepayEvent(response, 'change');
}

export function getTotalPaidFromRepayTx(response: comet38.TxResponse): bigint {
  return getAttributeValueFromWasmRepayEvent(response, 'payment-amount');
}

export function getMarginPaidTimeFromRawState(rawState: Uint8Array): bigint {
  return BigInt(
    JSON.parse(fromUtf8(rawState)).OpenedActive.lease.lease.loan.margin_paid_by,
  );
}

export async function getCurrencyOtherThan(
  unlikeCurrencies: string[],
  oracleInstance: Oracle,
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
): number {
  if (!leaseState) {
    throw new Error(
      'Cannot read the lease obligations: the lease is not opened.',
    );
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
