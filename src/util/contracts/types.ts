/** `finance::coin::Amount` — a cosmwasm `Uint128`, always a string on the wire. */
export type Amount = string;

/** `finance::duration::Duration` — a bare `u64` of nanoseconds, so a JSON *number*. */
export type DurationNanos = number;

/**
 * `finance::instant::Instant` — a `u64` of nanoseconds serialised as a *string*, the same wire
 * shape as `cosmwasm_std::Timestamp`. Live values are ~1.79e18, two orders of magnitude past
 * `Number.MAX_SAFE_INTEGER`, so read these with `BigInt`, never `+`.
 */
export type InstantNanos = string;

/** `finance::percent::Percent100` — permille, so 1000 is 100%. */
export type Permille = number;

/** `finance::coin::CoinDTO<G>` — an amount carrying its currency ticker. */
export interface Coin {
  amount: Amount;
  ticker: string;
}

/** `finance::coin::Coin<C>` — a bare amount whose currency is fixed by position. */
export interface BareCoin {
  amount: Amount;
}

/**
 * `finance::price::base::BasePrice` / `PriceDTO`. `amount_quote` is always the quote side, i.e.
 * the LPN; reading its ticker instead of `amount`'s reports the wrong currency.
 */
export interface Price {
  amount: Coin;
  amount_quote: Coin;
}

/** `lpp::msg::PriceResponse` — a `Price<NLpn, Lpn>`, so neither side carries a ticker. */
export interface NLpnPrice {
  amount: BareCoin;
  amount_quote: BareCoin;
}

/**
 * Just the two amounts that make up a price ratio. Both `Price` and `NLpnPrice` satisfy it, so
 * a caller that only divides one side by the other takes this rather than forcing a ticker that
 * the LPP's NLpn price does not carry.
 */
export interface PriceRatio {
  amount: BareCoin;
  amount_quote: BareCoin;
}

// ---------------------------------------------------------------- oracle

/**
 * `oracle::api::CurrencyGroup`. Four variants, snake_case on the wire — `payment_only` is the
 * one `@nolus/nolusjs`'s `GROUPS` enum omits.
 */
export enum CurrencyGroup {
  Native = 'native',
  Lpn = 'lpn',
  Lease = 'lease',
  PaymentOnly = 'payment_only',
}

/** `oracle::api::Currency` — a flattened `DefinitionRef` plus the group. */
export interface CurrencyInfo {
  ticker: string;
  denom_path: string;
  bank_symbol: string;
  dex_denom_path: string;
  dex_symbol: string;
  decimal_digits: number;
  group: CurrencyGroup;
}

/** `marketprice::config::Config`. `feed_validity` is transient and stays off the wire. */
export interface OraclePriceConfig {
  min_feeders: Permille;
  sample_period_secs: number;
  samples_number: number;
  discount_factor: Permille;
}

/** `oracle::api::Config`. */
export interface OracleConfig {
  price_config: OraclePriceConfig;
}

/**
 * `oracle::api::PricesResponse`. The `Prices` query answers this object, *not* a ticker-keyed
 * map — reading it as a map yields the single key `'prices'`.
 */
export interface PricesResponse {
  prices: Price[];
}

/** `oracle::api::swap::SwapTarget` — serialised as the tuple `(pool_id, target)`. */
export type SwapTarget = [number, string];

/** `oracle::api::SwapLeg` — serialised as the tuple `(from, to)`. */
export type SwapLeg = [string, SwapTarget];

/**
 * `tree::HumanReadableTree<SwapTarget>` — a node carries its `(pool_id, ticker)` pair and, for
 * anything but a leaf, its children.
 */
export interface Tree {
  value: SwapTarget;
  children?: Tree[];
}

/** `oracle::api::SwapTreeResponse`. */
export interface SwapTree {
  tree: Tree;
}

/** `oracle::api::ExecuteMsg::FeedPrices`. */
export interface FeedPrices {
  prices: Price[];
}

// ---------------------------------------------------------------- leaser

/** `finance::liability::Liability`. Every field is permille except `recalc_time`. */
export interface Liability {
  initial: Permille;
  healthy: Permille;
  first_liq_warn: Permille;
  second_liq_warn: Permille;
  third_liq_warn: Permille;
  max: Permille;
  recalc_time: DurationNanos;
}

/** `lease::api::open::PositionSpecDTO`. */
export interface PositionSpec {
  liability: Liability;
  min_asset: Coin;
  min_transaction: Coin;
}

/** `lease::api::limits::MaxSlippages` — all four legs, not just `liquidation`. */
export interface MaxSlippages {
  open: Permille;
  repay: Permille;
  close: Permille;
  liquidation: Permille;
}

/**
 * `leaser::msg::LeaseConfig` — the modifiable part of the leaser configuration, and the whole
 * payload of both `SudoMsg::Config` and `ExecuteMsg::ConfigLeases`.
 */
export interface LeaseConfig {
  interest_rate_margin: Permille;
  position_spec: PositionSpec;
  due_period: DurationNanos;
  max_slippages: MaxSlippages;
}

/**
 * `leaser::state::config::Config`. The four lease parameters live under `lease_config`; they
 * were flat (`lease_position_spec`, `lease_due_period`, …) before 0.9.x.
 */
export interface LeaserConfigInfo {
  lease_code: number;
  lpp: string;
  profit: string;
  reserve: string;
  time_alarms: string;
  market_price_oracle: string;
  protocols_registry: string;
  lease_admin: string;
  ics20_channel_local: string;
  remote_lease_controller: string;
  expected_instance_ordinal: number;
  lease_config: LeaseConfig;
}

/** `leaser::msg::ConfigResponse`. */
export interface LeaserConfig {
  config: LeaserConfigInfo;
}

/** `leaser::msg::QuoteResponse`. */
export interface LeaseApply {
  total: Coin;
  borrow: Coin;
  annual_interest_rate: Permille;
  annual_interest_rate_margin: Permille;
}

// ---------------------------------------------------------------- lease state

/**
 * `platform::remote::Account` — a `struct Account(String)` newtype, so the remote-chain address
 * arrives as a bare string.
 */
export type RemoteAccount = string;

/** `lease::api::query::opening::OngoingTrx`. `remote_lease` replaced the old ICA account fields. */
export type OpeningTrx =
  | 'open_lease'
  | { transfer_out: { remote_lease: RemoteAccount } }
  | { buy_asset: { remote_lease: RemoteAccount } };

/** `lease::api::query::opened::RepayTrx`. */
export type RepayTrx =
  | 'transfer_out'
  | 'swap'
  | 'transfer_in_init'
  | 'transfer_in_finish';

/** `lease::api::query::opened::PositionCloseTrx`. */
export type PositionCloseTrx =
  | 'swap'
  | 'transfer_in_init'
  | 'transfer_in_finish';

/** `lease::api::query::opened::Cause`. */
export type LiquidationCause = 'overdue' | 'liability';

/** `lease::api::query::opened::OngoingTrx`. */
export type OpenedOngoingTrx =
  | { repayment: { payment: Coin; in_progress: RepayTrx } }
  | {
      liquidation: {
        liquidation: Coin;
        cause: LiquidationCause;
        in_progress: PositionCloseTrx;
      };
    }
  | { close: { close: Coin; in_progress: PositionCloseTrx } };

/** `lease::api::query::opened::Status`. */
export type OpenedStatus =
  | { in_progress: OpenedOngoingTrx }
  | 'slippage_protection_activated'
  | 'idle';

/** `lease::api::query::opened::ClosePolicy`. */
export interface ClosePolicy {
  take_profit: Permille | null;
  stop_loss: Permille | null;
}

/** `lease::api::query::paid::ClosingTrx`. */
export type PaidClosingTrx = 'transfer_in_init' | 'transfer_in_finish';

/** `StateResponse::Opening`. */
export interface OpeningLeaseInfo {
  currency: string;
  downpayment: Coin;
  loan: Coin;
  loan_interest_rate: Permille;
  in_progress: OpeningTrx;
}

/**
 * `StateResponse::Opened`. `due_projection_ns` echoes the `due_projection_secs` the query asked
 * for, in nanoseconds, and is `0` for an unprojected query.
 */
export interface OpenedLeaseInfo {
  amount: Coin;
  loan_interest_rate: Permille;
  margin_interest_rate: Permille;
  principal_due: Coin;
  overdue_margin: Coin;
  overdue_interest: Coin;
  overdue_collect_in: DurationNanos;
  due_margin: Coin;
  due_interest: Coin;
  due_projection_ns: DurationNanos;
  close_policy: ClosePolicy;
  validity: InstantNanos;
  status: OpenedStatus;
}

/** `StateResponse::Paid`. */
export interface PaidLeaseInfo {
  amount: Coin;
  in_progress: PaidClosingTrx;
}

/** `StateResponse::OpenFailed`. */
export interface OpenFailedLeaseInfo {
  reason: string;
}

/**
 * `lease::api::query::StateResponse`. Exactly one key is present. `closing`, `closed` and
 * `liquidated` are unit variants, so they answer `[]` rather than an object.
 */
export interface LeaseStatus {
  opening?: OpeningLeaseInfo;
  opened?: OpenedLeaseInfo;
  paid?: PaidLeaseInfo;
  closing?: [];
  closed?: [];
  liquidated?: [];
  open_failed?: OpenFailedLeaseInfo;
}

// ---------------------------------------------------------------- lpp

/** `lpp::borrow::InterestRate`. */
export interface InterestRate {
  base_interest_rate: Permille;
  utilization_optimal: Permille;
  addon_optimal_interest_rate: Permille;
}

/** `lpp::config::Config`. */
export interface LppConfig {
  lease_code: number;
  borrow_rate: InterestRate;
  min_utilization: Permille;
}

/** `lpp::msg::LppBalanceResponse`. */
export interface LppBalance {
  balance: Coin;
  total_principal_due: Coin;
  total_interest_due: Coin;
  balance_nlpn: BareCoin;
}

/** `lpp::loan::Loan`. `interest_paid` is an `Instant`, so a string — see `InstantNanos`. */
export interface LoanInfo {
  principal_due: BareCoin;
  annual_interest_rate: Permille;
  interest_paid: InstantNanos;
}

/** `lpp::msg::RewardsResponse` — the reward is in NLS, so it carries no ticker. */
export interface Rewards {
  rewards: BareCoin;
}

// ---------------------------------------------------------------- admin

/** `admin_contract::contracts::protocol::Network` — PascalCase on the wire. */
export type Network = 'Neutron' | 'Osmosis' | 'Solana';

/** `admin_contract::contracts::protocol::Dex` — PascalCase, and `Astroport` carries a payload. */
export type Dex =
  | 'Metis'
  | 'Osmosis'
  | { Astroport: { router_address: string } };

/**
 * `admin_contract::contracts::protocol::Contracts`. `remote_lease` is the one optional slot and
 * leaves the wire entirely when unset.
 */
export interface ProtocolContracts {
  leaser: string;
  lpp: string;
  oracle: string;
  profit: string;
  remote_lease?: string;
  reserve: string;
}

/** `admin_contract::msg::ProtocolQueryResponse`. */
export interface Protocol {
  network: Network;
  dex: Dex;
  contracts: ProtocolContracts;
}
