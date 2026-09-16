// Query and execute messages, built to the nolus-money-market enum shapes.

import { Coin, FeedPrices, LeaseConfig, Permille } from './types';

type Msg = Record<string, unknown>;

// ---------------------------------------------------------------- lease

/**
 * `lease::api::query::QueryMsg::State` — a struct variant whose `due_projection` field is
 * renamed `due_projection_secs` and defaults to 0.
 */
export const leaseStateMsg = (dueProjectionSecs?: number): Msg =>
  dueProjectionSecs === undefined
    ? { state: {} }
    : { state: { due_projection_secs: dueProjectionSecs } };

/** `lease::api::ExecuteMsg::Repay` — a tuple variant. */
export const repayLeaseMsg = (): Msg => ({ repay: [] });

/**
 * `lease::api::ExecuteMsg::ClosePosition(PositionClose)`. `FullClose` is an empty struct, so it
 * encodes as `{}`; `PartialClose.amount` is a `LeaseCoin` and needs its ticker.
 */
export const closePositionLeaseMsg = (amount?: Coin): Msg => ({
  close_position:
    amount === undefined ? { full_close: {} } : { partial_close: { amount } },
});

/**
 * `lease::api::ExecuteMsg::ChangeClosePolicy(ClosePolicyChange)`. Each leg is an
 * `Option<ChangeCmd>`: `null` means reset it, a number means set it, and omitting the key
 * leaves it untouched.
 */
export const changeClosePolicyMsg = (
  stopLoss?: Permille | null,
  takeProfit?: Permille | null,
): Msg => ({
  change_close_policy: {
    ...(stopLoss === null
      ? { stop_loss: 'reset' }
      : stopLoss !== undefined
        ? { stop_loss: { set: stopLoss } }
        : {}),
    ...(takeProfit === null
      ? { take_profit: 'reset' }
      : takeProfit !== undefined
        ? { take_profit: { set: takeProfit } }
        : {}),
  },
});

// ---------------------------------------------------------------- leaser

/** `leaser::msg::QueryMsg::Config` — a struct variant. */
export const leaserConfigMsg = (): Msg => ({ config: {} });

/** `leaser::msg::QueryMsg::Leases`. */
export const currentOpenLeasesByOwnerMsg = (ownerAddress: string): Msg => ({
  leases: { owner: ownerAddress },
});

/**
 * `leaser::msg::QueryMsg::Quote`. `max_ltd` is an `Option<Percent>`; omit the key rather than
 * sending null so the request matches the no-max-ltd form the contract's own test pins.
 */
export const leaseQuoteMsg = (
  downpaymentAmount: string,
  downpaymentCurrency: string,
  leaseAsset: string,
  maxLtd?: Permille,
): Msg => ({
  quote: {
    lease_asset: leaseAsset,
    downpayment: { ticker: downpaymentCurrency, amount: downpaymentAmount },
    ...(maxLtd === undefined ? {} : { max_ltd: maxLtd }),
  },
});

/** `leaser::msg::ExecuteMsg::OpenLease`. */
export const openLeaseMsg = (
  leaseCurrency: string,
  maxLtd?: Permille,
): Msg => ({
  open_lease: {
    currency: leaseCurrency,
    ...(maxLtd === undefined ? {} : { max_ltd: maxLtd }),
  },
});

/**
 * `leaser::msg::ExecuteMsg::ConfigLeases(LeaseConfigExternal)` — a newtype variant, so the
 * config is the payload directly. Permitted to the lease admin, which is why reconfiguring the
 * leaser no longer needs a governance proposal.
 */
export const configLeasesMsg = (config: LeaseConfig): Msg => ({
  config_leases: config,
});

/** `leaser::msg::SudoMsg::Config(LeaseConfigExternal)` — the same payload, reached by governance. */
export const leaserSudoConfigMsg = (config: LeaseConfig): Msg => ({
  config,
});

// ---------------------------------------------------------------- lpp

/** `lpp::msg::QueryMsg::Config` — a tuple variant, so `[]` and not `{}`. */
export const lppConfigMsg = (): Msg => ({ config: [] });

/** `lpp::msg::QueryMsg::LppBalance` — a tuple variant. */
export const lppBalanceMsg = (): Msg => ({ lpp_balance: [] });

/**
 * `lpp::msg::QueryMsg::DepositCapacity` — a tuple variant. Answers `null` when the pool sets no
 * cap.
 */
export const depositCapacityMsg = (): Msg => ({ deposit_capacity: [] });

/** `lpp::msg::QueryMsg::Price` — a tuple variant. */
export const lppPriceMsg = (): Msg => ({ price: [] });

/** `lpp::msg::QueryMsg::Loan`. Answers `null` for an address with no loan. */
export const loanInformationMsg = (leaseAddress: string): Msg => ({
  loan: { lease_addr: leaseAddress },
});

/** `lpp::msg::QueryMsg::Balance` — the CW20 interface. Answers a bare `{amount}`. */
export const lenderDepositMsg = (lenderAddress: string): Msg => ({
  balance: { address: lenderAddress },
});

/**
 * `lpp::msg::QueryMsg::Rewards`. Errors with `The deposit does not exist` for a non-depositor
 * rather than answering a zero reward.
 */
export const lenderRewardsMsg = (lenderAddress: string): Msg => ({
  rewards: { address: lenderAddress },
});

/** `lpp::msg::ExecuteMsg::Deposit` — a tuple variant. */
export const depositMsg = (): Msg => ({ deposit: [] });

/** `lpp::msg::ExecuteMsg::DistributeRewards` — a tuple variant. */
export const distributeRewardsMsg = (): Msg => ({ distribute_rewards: [] });

/** `lpp::msg::ExecuteMsg::Burn`. `amount` is a `Coin<NLpn>`, so it carries no ticker. */
export const burnMsg = (burnAmount: string): Msg => ({
  burn: { amount: { amount: burnAmount } },
});

/** `lpp::msg::ExecuteMsg::ClaimRewards`. */
export const claimRewardsMsg = (recipientAddress?: string): Msg => ({
  claim_rewards: { other_recipient: recipientAddress },
});

// ---------------------------------------------------------------- oracle

/** `oracle::api::QueryMsg::Config` — a struct variant. */
export const oracleConfigMsg = (): Msg => ({ config: {} });

/** `oracle::api::QueryMsg::BaseCurrency`. */
export const baseCurrencyMsg = (): Msg => ({ base_currency: {} });

/** `oracle::api::QueryMsg::BasePrice`. Errors with `No price` for an unfed currency. */
export const basePriceMsg = (ticker: string): Msg => ({
  base_price: { currency: ticker },
});

/** `oracle::api::QueryMsg::Prices`. */
export const pricesMsg = (): Msg => ({ prices: {} });

/** `oracle::api::QueryMsg::SupportedCurrencyPairs`. */
export const currencyPairsMsg = (): Msg => ({ supported_currency_pairs: {} });

/** `oracle::api::QueryMsg::Currencies`. */
export const currenciesMsg = (): Msg => ({ currencies: {} });

/** `oracle::api::QueryMsg::Feeders`. */
export const feedersMsg = (): Msg => ({ feeders: {} });

/** `oracle::api::ExecuteMsg::FeedPrices`. */
export const feedPricesMsg = (feedPrices: FeedPrices): Msg => ({
  feed_prices: feedPrices,
});

// ---------------------------------------------------------------- admin

/** `admin_contract::msg::QueryMsg::Protocols`. */
export const protocolsMsg = (): Msg => ({ protocols: {} });

/** `admin_contract::msg::QueryMsg::Protocol` — a newtype variant, so the name is the payload. */
export const protocolMsg = (protocolName: string): Msg => ({
  protocol: protocolName,
});
