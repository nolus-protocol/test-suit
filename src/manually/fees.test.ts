import {
  assertIsDeliverTxSuccess,
  Coin,
  DeliverTxResponse,
} from '@cosmjs/stargate';
import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';
import NODE_ENDPOINT, {
  getFeederWallet,
  getUser1Wallet,
  getUser2Wallet,
} from '../util/clients';
import {
  GASPRICE,
  NATIVE_MINIMAL_DENOM,
  NATIVE_TICKER,
  VALIDATOR_PART,
} from '../util/utils';
import { currencyTicker_To_IBC } from '../util/smart-contracts/calculations';

// These tests require the network to be specifically configured
// That`s why, they only work locally and in isolation, and only if this requirement is met!
// Suitable values are :
// - non-working feeder (but registered feeder address)
// - non-working dispatcher
// - oracle swap tree (Osmosis example): {"swap_tree":{"tree":{"value":[0,"USDC"],"children":[{"value":[7,"NLS"]},{"value":[5,"OSMO"]},{"value":[12,"ATOM"]}]}}}
// - supported fee denoms (Osmosis example) - tax module params: {"params":{"fee_rate":40,"contract_address":"<oracle_address>","base_denom":"unls","fee_params":[{"oracle_address":"<oracle_address>","profit_address":"<profit_address>","accepted_denoms":[{"denom":"<USDC_ibc_denom>","ticker":"USDC"},{"denom":"<OSMO_ibc_denom>","ticker":"OSMO"}]}]}}
// Before testing, validate the registeredFeeCurrencyTicker and unregisteredFeeCurrencyTicker

describe.skip('Fee tests', () => {
  let user1Wallet: NolusWallet;
  let user2Wallet: NolusWallet;
  let feederWallet: NolusWallet;
  let oracleInstance: NolusContracts.Oracle;
  let fee: any;
  let transferAmount: Coin;
  let lpnCurrencyToIbc: string;
  let registeredFeeCurrencyTicker: string;
  let unregisteredFeeCurrencyTicker: string;
  const lpnTicker = process.env.LPP_BASE_CURRENCY as string;

  async function feedPrice(
    amountTicker: string,
    amountAmount: string,
    amountQuoteAmount: string,
  ) {
    const prices = {
      prices: [
        {
          amount: { amount: amountAmount, ticker: amountTicker },
          amount_quote: { amount: amountQuoteAmount, ticker: lpnTicker },
        },
      ],
    };

    await oracleInstance.feedPrices(feederWallet, prices, 2.0);
  }

  async function tryBankTransfer(errorMsg: RegExp) {
    const broadcastTx = () =>
      user1Wallet.transferAmount(
        user2Wallet.address as string,
        [transferAmount],
        fee,
      );

    await expect(broadcastTx).rejects.toThrow(errorMsg);
  }

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    const cosm = await NolusClient.getInstance().getCosmWasmClient();

    user1Wallet = await getUser1Wallet();
    user2Wallet = await getUser2Wallet();
    feederWallet = await getFeederWallet();

    lpnCurrencyToIbc = await currencyTicker_To_IBC(lpnTicker);
    expect(lpnCurrencyToIbc).not.toBe('');

    registeredFeeCurrencyTicker = 'OSMO'; // !!! registered currency ticker
    unregisteredFeeCurrencyTicker = 'ATOM'; // !!! unregistered currency ticker

    oracleInstance = new NolusContracts.Oracle(
      cosm,
      process.env.ORACLE_ADDRESS as string,
    );

    transferAmount = {
      denom: NATIVE_MINIMAL_DENOM,
      amount: '800',
    };

    fee = {
      gas: '200000',
      amount: [
        {
          amount: Math.floor((200000 * GASPRICE) / VALIDATOR_PART).toString(),
          denom: '',
        },
      ],
    };
  });

  test('user tries to pay the fee in a currency for which there is no price - should produce an error', async () => {
    fee.amount[0].denom = await currencyTicker_To_IBC(
      registeredFeeCurrencyTicker,
    );

    console.log(fee.amount[0].denom, registeredFeeCurrencyTicker);

    await tryBankTransfer(/^.*no prices found from the oracle.*/);
  });

  test('user tries to pay the fee in a currency which is not registered as supported - should produce an error', async () => {
    await feedPrice(NATIVE_TICKER, '1', '1');
    await feedPrice(unregisteredFeeCurrencyTicker, '1', '1');

    fee.amount[0].denom = await currencyTicker_To_IBC(
      unregisteredFeeCurrencyTicker,
    );

    await tryBankTransfer(/^.*no fee param found.*/);
  });

  test('user should be able to pay the fee in any of the supported currencies when there are prices - should work as expected', async () => {
    const amount = '5';
    const amountQuote = '2';
    const price = +amount / +amountQuote;

    await feedPrice(NATIVE_TICKER, amount, amountQuote);

    const profitAddress = process.env.PROFIT_ADDRESS as string;
    const profitBalanceBefore = await user1Wallet.getBalance(
      profitAddress,
      lpnCurrencyToIbc,
    );

    const balanceTransferDenomBefore = await user1Wallet.getBalance(
      user1Wallet.address as string,
      transferAmount.denom,
    );

    const balanceFeeDenomBefore = await user1Wallet.getBalance(
      user1Wallet.address as string,
      lpnCurrencyToIbc,
    );

    const nativeFeeAmount = 1000;
    const feeAmount = Math.trunc(nativeFeeAmount / price);
    fee.amount[0].denom = lpnCurrencyToIbc;
    fee.amount[0].amount = feeAmount.toString();

    const broadcastTx: DeliverTxResponse = await user1Wallet.transferAmount(
      user2Wallet.address as string,
      [transferAmount],
      fee,
    );

    assertIsDeliverTxSuccess(broadcastTx);

    const profitBalanceAfter = await user1Wallet.getBalance(
      profitAddress,
      lpnCurrencyToIbc,
    );

    const profitPercent = 1 - VALIDATOR_PART;
    expect(BigInt(profitBalanceAfter.amount)).toBe(
      BigInt(profitBalanceBefore.amount) + BigInt(feeAmount * profitPercent),
    );

    const balanceTransferDenomAfter = await user1Wallet.getBalance(
      user1Wallet.address as string,
      transferAmount.denom,
    );

    const balanceFeeDenomAfter = await user1Wallet.getBalance(
      user1Wallet.address as string,
      lpnCurrencyToIbc,
    );

    expect(BigInt(balanceFeeDenomAfter.amount)).toBe(
      BigInt(balanceFeeDenomBefore.amount) - BigInt(fee.amount[0].amount),
    );

    expect(BigInt(balanceTransferDenomAfter.amount)).toBe(
      BigInt(balanceTransferDenomBefore.amount) - BigInt(transferAmount.amount),
    );
  });

  test('user tries to pay the fee with amount = "0" - should produce an error', async () => {
    await feedPrice(NATIVE_TICKER, '1', '1');

    fee.amount[0].denom = lpnCurrencyToIbc;
    fee.amount[0].amount = '0';

    await tryBankTransfer(/^.*insufficient fee.*/);
  });

  test('user tries to pay the fee with more amount than he has - should produce an error', async () => {
    await feedPrice(NATIVE_TICKER, '1', '1');

    fee.amount[0].denom = lpnCurrencyToIbc;

    const senderBalanceFeeDenomBefore = await user1Wallet.getBalance(
      user1Wallet.address as string,
      lpnCurrencyToIbc,
    );

    fee.amount[0].amount = (
      +senderBalanceFeeDenomBefore.amount + 100
    ).toString();

    await tryBankTransfer(/^.*insufficient funds.*/);
  });
});
