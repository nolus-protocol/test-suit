import { NolusContracts, NolusWallet } from '@nolus/nolusjs';
import {
  OraclePriceConfig,
  OracleConfig,
} from '@nolus/nolusjs/build/contracts/types/';
import { Oracle } from '@nolus/nolusjs/build/contracts';
import { getUser1Wallet, getContractsOwnerWallet } from '../../clients';
import {
  returnRestToMainAccount,
  sendInitExecuteFeeTokens,
} from '../../transfer';
import { customFees, NATIVE_MINIMAL_DENOM } from '../../utils';
import { ExecuteResult } from '@cosmjs/cosmwasm-stargate';

export async function removeAllFeeders(
  oracleInstance: NolusContracts.Oracle,
  contractsOwnerWallet: NolusWallet,
): Promise<void> {
  const allFeeders = await oracleInstance.getFeeders();

  for (let i = 0; i < allFeeders.length; i++) {
    console.log('Feeder removing...');
    await oracleInstance.removeFeeder(
      contractsOwnerWallet,
      allFeeders[i],
      customFees.exec,
    );
  }
}

export async function pushPrice(
  oracleInstance: NolusContracts.Oracle,
  priceFeederWallet: NolusWallet,
  firstPairMemberCurrency: string,
  secondPairMemberCurrency: string,
  firstPairMemberValue: string,
  secondPairMemberValue: string,
): Promise<ExecuteResult> {
  const userWithBalanceWallet = await getUser1Wallet();
  const contractsOwnerWallet = await getContractsOwnerWallet();

  // add feeder
  await sendInitExecuteFeeTokens(
    userWithBalanceWallet,
    contractsOwnerWallet.address as string,
  );

  await oracleInstance.addFeeder(
    contractsOwnerWallet,
    priceFeederWallet.address as string,
    customFees.exec,
  );

  const isFeeder = await oracleInstance.isFeeder(
    priceFeederWallet.address as string,
  );
  expect(isFeeder).toBe(true);

  await sendInitExecuteFeeTokens(
    userWithBalanceWallet,
    contractsOwnerWallet.address as string,
  );

  const feedPrices = {
    prices: [
      {
        amount: {
          amount: firstPairMemberValue,
          ticker: firstPairMemberCurrency,
        },
        amount_quote: {
          amount: secondPairMemberValue,
          ticker: secondPairMemberCurrency,
        },
      },
    ],
  };

  await userWithBalanceWallet.transferAmount(
    priceFeederWallet.address as string,
    customFees.feedPrice.amount,
    customFees.transfer,
    '',
  );

  const feedPriceTxReponse = await oracleInstance.feedPrices(
    priceFeederWallet,
    feedPrices,
    1.3,
  );

  await returnRestToMainAccount(userWithBalanceWallet, NATIVE_MINIMAL_DENOM);

  const priceResult = await oracleInstance.getPriceFor(firstPairMemberCurrency);
  expect(priceResult).toBeDefined();

  return feedPriceTxReponse;
}

export async function updateOracleConfig(
  oracleInstance: Oracle,
  orState: OracleConfig,
  minFeedersPermilles?: number,
  samplePeriod?: number,
  samplesNumber?: number,
  discountFactor?: number,
) {
  const contractsOwnerWallet = await getContractsOwnerWallet();

  const priceConfig_orState = orState.config.price_config;
  const priceConfig: OraclePriceConfig = {
    min_feeders:
      minFeedersPermilles !== undefined
        ? minFeedersPermilles
        : priceConfig_orState.min_feeders,
    discount_factor:
      discountFactor !== undefined
        ? discountFactor
        : priceConfig_orState.discount_factor,
    sample_period_secs:
      samplePeriod !== undefined
        ? samplePeriod
        : priceConfig_orState.sample_period_secs,
    samples_number:
      samplesNumber !== undefined
        ? samplesNumber
        : priceConfig_orState.samples_number,
  };

  await oracleInstance.updateConfig(
    contractsOwnerWallet,
    priceConfig,
    customFees.exec,
  );
}
