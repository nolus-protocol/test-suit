import { CurrencyGroup, CurrencyInfo } from './types';

export function findTickersByGroup(
  currencies: CurrencyInfo[],
  group: CurrencyGroup,
): string[] {
  return currencies
    .filter((currency) => currency.group === group)
    .map((currency) => currency.ticker);
}

export function findBankSymbolByTicker(
  currencies: CurrencyInfo[],
  ticker: string,
): string | undefined {
  return currencies.find((currency) => currency.ticker === ticker)?.bank_symbol;
}
