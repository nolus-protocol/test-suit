import NODE_ENDPOINT, {
  createWallet,
  getUser1Wallet,
  getContractsOwnerWallet,
} from '../util/clients';
import { customFees, NATIVE_MINIMAL_DENOM } from '../util/utils';
import { NolusClient, NolusWallet, NolusContracts } from '@nolus/nolusjs';
import { sendInitExecuteFeeTokens } from '../util/transfer';
import { LeaserConfig } from '@nolus/nolusjs/build/contracts';
import { runOrSkip } from '../util/testingRules';

runOrSkip(process.env.TEST_BORROWER as string)(
  'Leaser contract tests - Config',
  () => {
    let contractsOwnerWallet: NolusWallet;
    let wallet: NolusWallet;
    let leaserInstance: NolusContracts.Leaser;
    let configBefore: NolusContracts.LeaserConfig;

    const leaserContractAddress = process.env.LEASER_ADDRESS as string;

    let leaserConfigMsg: LeaserConfig;

    async function trySetConfig(
      expectedMsg: string,
      wallet: NolusWallet,
    ): Promise<void> {
      const result = () =>
        leaserInstance.setLeaserConfig(
          wallet,
          leaserConfigMsg,
          customFees.exec,
        );

      await expect(result).rejects.toThrow(`${expectedMsg}`);
    }

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);
      const cosm = await NolusClient.getInstance().getCosmWasmClient();

      leaserInstance = new NolusContracts.Leaser(cosm, leaserContractAddress);

      contractsOwnerWallet = await getContractsOwnerWallet();
      wallet = await createWallet();

      configBefore = await leaserInstance.getLeaserConfig();
      leaserConfigMsg = JSON.parse(JSON.stringify(configBefore));

      // feed the contract owner
      const userWithBalance = await getUser1Wallet();

      const adminBalanceAmount = '10000000';
      const adminBalance = {
        amount: adminBalanceAmount,
        denom: NATIVE_MINIMAL_DENOM,
      };
      await userWithBalance.transferAmount(
        contractsOwnerWallet.address as string,
        [adminBalance],
        customFees.transfer,
      );
    });

    afterEach(async () => {
      leaserConfigMsg = JSON.parse(JSON.stringify(configBefore));

      const configAfter = await leaserInstance.getLeaserConfig();

      expect(configAfter).toStrictEqual(configBefore);
    });

    test('an unauthorized user tries to change the configuration - should produce an error', async () => {
      await sendInitExecuteFeeTokens(
        contractsOwnerWallet,
        wallet.address as string,
      );

      await trySetConfig('Unauthorized', wallet);
    });

    test('the wasm_admin tries to set initial liability % > healthy liability % - should produce an error', async () => {
      leaserConfigMsg.config.liability.initial =
        leaserConfigMsg.config.liability.healthy + 1;

      await trySetConfig(
        'Initial % should be <= healthy %',
        contractsOwnerWallet,
      );
    });

    test('the wasm_admin tries to set initial liability % > max liability % - should produce an error', async () => {
      leaserConfigMsg.config.liability.initial =
        leaserConfigMsg.config.liability.max + 1;

      await trySetConfig(
        'Initial % should be <= healthy %',
        contractsOwnerWallet,
      );
    });

    test('the wasm_admin tries to set healthy liability % > max liability % - should produce an error', async () => {
      leaserConfigMsg.config.liability.healthy =
        leaserConfigMsg.config.liability.max + 1;

      await trySetConfig(
        'Healthy % should be < first liquidation %',
        contractsOwnerWallet,
      );
    });

    test('the wasm_admin tries to set first liq warn % <= healthy liability % - should produce an error', async () => {
      leaserConfigMsg.config.liability.first_liq_warn =
        leaserConfigMsg.config.liability.healthy - 1;

      await trySetConfig(
        'Healthy % should be < first liquidation %',
        contractsOwnerWallet,
      );

      leaserConfigMsg.config.liability.first_liq_warn =
        leaserConfigMsg.config.liability.healthy;

      await trySetConfig(
        'Healthy % should be < first liquidation %',
        contractsOwnerWallet,
      );
    });

    test('the wasm_admin tries to set second liq warn % <= first liq warn % - should produce an error', async () => {
      leaserConfigMsg.config.liability.second_liq_warn =
        leaserConfigMsg.config.liability.first_liq_warn - 1;

      await trySetConfig(
        'First liquidation % should be < second liquidation %',
        contractsOwnerWallet,
      );

      leaserConfigMsg.config.liability.second_liq_warn =
        leaserConfigMsg.config.liability.first_liq_warn;

      await trySetConfig(
        'First liquidation % should be < second liquidation %',
        contractsOwnerWallet,
      );
    });

    test('the wasm_admin tries to set third liq warn % <= second liq warn % - should produce an error', async () => {
      leaserConfigMsg.config.liability.third_liq_warn =
        leaserConfigMsg.config.liability.second_liq_warn - 1;

      await trySetConfig(
        'Second liquidation % should be < third liquidation %',
        contractsOwnerWallet,
      );

      leaserConfigMsg.config.liability.third_liq_warn =
        leaserConfigMsg.config.liability.second_liq_warn;

      await trySetConfig(
        'Second liquidation % should be < third liquidation %',
        contractsOwnerWallet,
      );
    });

    test('the wasm_admin tries to set third liq warn % >= max % - should produce an error', async () => {
      leaserConfigMsg.config.liability.third_liq_warn =
        leaserConfigMsg.config.liability.max + 1;

      await trySetConfig(
        'Third liquidation % should be < max %',
        contractsOwnerWallet,
      );

      leaserConfigMsg.config.liability.third_liq_warn =
        leaserConfigMsg.config.liability.max;

      await trySetConfig(
        'Third liquidation % should be < max %',
        contractsOwnerWallet,
      );
    });

    test('the wasm_admin tries to set grace period > interest period - should produce an error', async () => {
      leaserConfigMsg.config.lease_interest_payment.grace_period =
        leaserConfigMsg.config.lease_interest_payment.due_period + 1;

      await trySetConfig(
        'Period length should be greater than grace period',
        contractsOwnerWallet,
      );
    });

    test('the wasm_admin tries to set recalc period < 1hour - should produce an error', async () => {
      const oneHourToNanosec = 3600000000000;
      leaserConfigMsg.config.liability.recalc_time = oneHourToNanosec - 1;

      await trySetConfig(
        'Recalculate cadence in seconds should be >= 1h',
        contractsOwnerWallet,
      );
    });
  },
);
