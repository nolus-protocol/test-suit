import { NolusClient, NolusWallet, NolusContracts } from '@nolus/nolusjs';
import { LeaserConfig } from '@nolus/nolusjs/build/contracts';
import { runOrSkip } from '../util/testingRules';
import NODE_ENDPOINT, { createWallet, getUser1Wallet } from '../util/clients';
import { customFees } from '../util/utils';
import { sendSudoContractProposal } from '../util/gov';

runOrSkip(process.env.TEST_BORROWER as string)(
  'Leaser contract tests - Config',
  () => {
    let userWithBalanceWallet: NolusWallet;
    let wallet: NolusWallet;
    let leaserInstance: NolusContracts.Leaser;
    let configBefore: NolusContracts.LeaserConfig;
    let leaserConfigMsg: LeaserConfig;

    const leaserContractAddress = process.env.LEASER_ADDRESS as string;

    async function trySendPropToSetConfig(message: string): Promise<void> {
      await userWithBalanceWallet.transferAmount(
        wallet.address as string,
        customFees.configs.amount,
        customFees.transfer,
      );

      const broadcastTx = await sendSudoContractProposal(
        wallet,
        leaserContractAddress,
        JSON.stringify(leaserConfigMsg),
      );

      expect(broadcastTx.rawLog).toContain(message);
    }

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);
      const cosm = await NolusClient.getInstance().getCosmWasmClient();

      leaserInstance = new NolusContracts.Leaser(cosm, leaserContractAddress);

      userWithBalanceWallet = await getUser1Wallet();
      wallet = await createWallet();

      configBefore = await leaserInstance.getLeaserConfig();
      leaserConfigMsg = JSON.parse(JSON.stringify(configBefore));
    });

    afterEach(async () => {
      leaserConfigMsg = JSON.parse(JSON.stringify(configBefore));
      const configAfter = await leaserInstance.getLeaserConfig();

      expect(configAfter).toStrictEqual(configBefore);
    });

    test('try to set initial liability % > healthy liability % - should produce an error', async () => {
      leaserConfigMsg.config.liability.initial =
        leaserConfigMsg.config.liability.healthy + 1;

      await trySendPropToSetConfig('Initial % should be <= healthy %');
    });

    test('try to set healthy liability % > max liability % - should produce an error', async () => {
      leaserConfigMsg.config.liability.healthy =
        leaserConfigMsg.config.liability.max + 1;

      await trySendPropToSetConfig('Healthy % should be < first liquidation %');
    });

    test('try to set first liq warn % <= healthy liability % - should produce an error', async () => {
      leaserConfigMsg.config.liability.first_liq_warn =
        leaserConfigMsg.config.liability.healthy - 1;

      await trySendPropToSetConfig('Healthy % should be < first liquidation %');

      leaserConfigMsg.config.liability.first_liq_warn =
        leaserConfigMsg.config.liability.healthy;

      await trySendPropToSetConfig('Healthy % should be < first liquidation %');
    });

    test('try to set second liq warn % <= first liq warn % - should produce an error', async () => {
      leaserConfigMsg.config.liability.second_liq_warn =
        leaserConfigMsg.config.liability.first_liq_warn - 1;

      await trySendPropToSetConfig(
        'First liquidation % should be < second liquidation %',
      );

      leaserConfigMsg.config.liability.second_liq_warn =
        leaserConfigMsg.config.liability.first_liq_warn;

      await trySendPropToSetConfig(
        'First liquidation % should be < second liquidation %',
      );
    });

    test('try to set third liq warn % <= second liq warn % - should produce an error', async () => {
      leaserConfigMsg.config.liability.third_liq_warn =
        leaserConfigMsg.config.liability.second_liq_warn - 1;

      await trySendPropToSetConfig(
        'Second liquidation % should be < third liquidation %',
      );

      leaserConfigMsg.config.liability.third_liq_warn =
        leaserConfigMsg.config.liability.second_liq_warn;

      await trySendPropToSetConfig(
        'Second liquidation % should be < third liquidation %',
      );
    });

    test('try to set third liq warn % >= max % - should produce an error', async () => {
      leaserConfigMsg.config.liability.third_liq_warn =
        leaserConfigMsg.config.liability.max + 1;

      await trySendPropToSetConfig('Third liquidation % should be < max %');

      leaserConfigMsg.config.liability.third_liq_warn =
        leaserConfigMsg.config.liability.max;

      await trySendPropToSetConfig('Third liquidation % should be < max %');
    });

    test('try to set grace period > interest period - should produce an error', async () => {
      leaserConfigMsg.config.lease_interest_payment.grace_period =
        leaserConfigMsg.config.lease_interest_payment.due_period + 1;

      await trySendPropToSetConfig(
        'The interest due period should be longer than grace period to avoid overlapping',
      );
    });

    test('try to set recalc period < 1hour - should produce an error', async () => {
      const oneHourToNanosec = 3600000000000;
      leaserConfigMsg.config.liability.recalc_time = oneHourToNanosec - 1;

      await trySendPropToSetConfig('Recalculation cadence should be >= 1h');
    });
  },
);
