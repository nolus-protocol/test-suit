import NODE_ENDPOINT, {
  createWallet,
  getUser1Wallet,
  getWasmAdminWallet,
} from '../util/clients';
import { customFees, NATIVE_MINIMAL_DENOM } from '../util/utils';
import { NolusClient, NolusWallet, NolusContracts } from '@nolus/nolusjs';
import { sendInitExecuteFeeTokens } from '../util/transfer';
import { LeaserConfig } from '@nolus/nolusjs/build/contracts';

//TO DO: error msgs - https://gitlab-nomo.credissimo.net/nomo/smart-contracts/-/issues/12
describe('Leaser contract tests - Config', () => {
  let user1Wallet: NolusWallet;
  let wallet: NolusWallet;
  let leaserInstance: NolusContracts.Leaser;
  let configBefore: NolusContracts.LeaserConfig;

  const leaserContractAddress = process.env.LEASER_ADDRESS as string;

  let leaserConfigMsg: LeaserConfig;

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    user1Wallet = await getWasmAdminWallet();
    const userWithBalance = await getUser1Wallet();
    wallet = await createWallet();

    const cosm = await NolusClient.getInstance().getCosmWasmClient();
    leaserInstance = new NolusContracts.Leaser(cosm);

    configBefore = await leaserInstance.getLeaserConfig(leaserContractAddress);
    leaserConfigMsg = JSON.parse(JSON.stringify(configBefore));

    const adminBalance = {
      amount: '10000000',
      denom: NATIVE_MINIMAL_DENOM,
    };

    await userWithBalance.transferAmount(
      user1Wallet.address as string,
      [adminBalance],
      customFees.transfer,
    );
  });

  afterEach(async () => {
    leaserConfigMsg = JSON.parse(JSON.stringify(configBefore));

    const configAfter = await leaserInstance.getLeaserConfig(
      leaserContractAddress,
    );

    expect(configAfter).toStrictEqual(configBefore);
  });

  test('an unauthorized user tries to change the configuration - should produce an error', async () => {
    await sendInitExecuteFeeTokens(user1Wallet, wallet.address as string);

    const result = () =>
      leaserInstance.setLeaserConfig(
        leaserContractAddress,
        wallet,
        leaserConfigMsg,
        customFees.exec,
      );

    await expect(result).rejects.toThrow(/^.*Unauthorized.*/);
  });

  test('the business tries to set initial liability % > healthy liability % - should produce an error', async () => {
    leaserConfigMsg.config.liability.init_percent =
      leaserConfigMsg.config.liability.healthy_percent + 1;

    const result = () =>
      leaserInstance.setLeaserConfig(
        leaserContractAddress,
        user1Wallet,
        leaserConfigMsg,
        customFees.exec,
      );

    await expect(result).rejects.toThrow(
      /^.*LeaseHealthyLiability% must be less than LeaseMaxLiability% and LeaseInitialLiability% must be less or equal to LeaseHealthyLiability%.*/,
    );
  });

  test('the business tries to set initial liability % > max liability % - should produce an error', async () => {
    leaserConfigMsg.config.liability.init_percent =
      leaserConfigMsg.config.liability.max_percent + 1;

    const result = () =>
      leaserInstance.setLeaserConfig(
        leaserContractAddress,
        user1Wallet,
        leaserConfigMsg,
        customFees.exec,
      );

    await expect(result).rejects.toThrow(
      /^.*LeaseHealthyLiability% must be less than LeaseMaxLiability% and LeaseInitialLiability% must be less or equal to LeaseHealthyLiability%.*/,
    );
  });

  test('the business tries to set healthy liability % > max liability % - should produce an error', async () => {
    leaserConfigMsg.config.liability.healthy_percent =
      leaserConfigMsg.config.liability.max_percent + 1;

    const result = () =>
      leaserInstance.setLeaserConfig(
        leaserContractAddress,
        user1Wallet,
        leaserConfigMsg,
        customFees.exec,
      );

    await expect(result).rejects.toThrow(
      /^.*LeaseHealthyLiability% must be less than LeaseMaxLiability% and LeaseInitialLiability% must be less or equal to LeaseHealthyLiability%.*/,
    );
  });

  test('the business tries to set first liq warn % <= healthy liability % - should produce an error', async () => {
    leaserConfigMsg.config.liability.first_liq_warn =
      leaserConfigMsg.config.liability.healthy_percent - 1;

    const result = () =>
      leaserInstance.setLeaserConfig(
        leaserContractAddress,
        user1Wallet,
        leaserConfigMsg,
        customFees.exec,
      );

    await expect(result).rejects.toThrow(
      /^.*LeaseHealthyLiability% must be less than LeaseMaxLiability% and LeaseInitialLiability% must be less or equal to LeaseHealthyLiability%.*/,
    );

    leaserConfigMsg.config.liability.first_liq_warn =
      leaserConfigMsg.config.liability.healthy_percent;

    const result2 = () =>
      leaserInstance.setLeaserConfig(
        leaserContractAddress,
        user1Wallet,
        leaserConfigMsg,
        customFees.exec,
      );

    await expect(result2).rejects.toThrow(
      /^.*LeaseHealthyLiability% must be less than LeaseMaxLiability% and LeaseInitialLiability% must be less or equal to LeaseHealthyLiability%.*/,
    );
  });

  test('the business tries to set second liq warn % <= first liq warn % - should produce an error', async () => {
    leaserConfigMsg.config.liability.second_liq_warn =
      leaserConfigMsg.config.liability.first_liq_warn - 1;

    const result = () =>
      leaserInstance.setLeaserConfig(
        leaserContractAddress,
        user1Wallet,
        leaserConfigMsg,
        customFees.exec,
      );

    await expect(result).rejects.toThrow(
      /^.*LeaseHealthyLiability% must be less than LeaseMaxLiability% and LeaseInitialLiability% must be less or equal to LeaseHealthyLiability%.*/,
    );

    leaserConfigMsg.config.liability.second_liq_warn =
      leaserConfigMsg.config.liability.first_liq_warn;

    const result2 = () =>
      leaserInstance.setLeaserConfig(
        leaserContractAddress,
        user1Wallet,
        leaserConfigMsg,
        customFees.exec,
      );

    await expect(result2).rejects.toThrow(
      /^.*LeaseHealthyLiability% must be less than LeaseMaxLiability% and LeaseInitialLiability% must be less or equal to LeaseHealthyLiability%.*/,
    );
  });

  test('the business tries to set third liq warn % <= second liq warn % - should produce an error', async () => {
    leaserConfigMsg.config.liability.third_liq_warn =
      leaserConfigMsg.config.liability.second_liq_warn - 1;

    const result = () =>
      leaserInstance.setLeaserConfig(
        leaserContractAddress,
        user1Wallet,
        leaserConfigMsg,
        customFees.exec,
      );

    await expect(result).rejects.toThrow(
      /^.*LeaseHealthyLiability% must be less than LeaseMaxLiability% and LeaseInitialLiability% must be less or equal to LeaseHealthyLiability%.*/,
    );
    leaserConfigMsg.config.liability.third_liq_warn =
      leaserConfigMsg.config.liability.second_liq_warn;

    const result2 = () =>
      leaserInstance.setLeaserConfig(
        leaserContractAddress,
        user1Wallet,
        leaserConfigMsg,
        customFees.exec,
      );

    await expect(result2).rejects.toThrow(
      /^.*LeaseHealthyLiability% must be less than LeaseMaxLiability% and LeaseInitialLiability% must be less or equal to LeaseHealthyLiability%.*/,
    );
  });

  test('the business tries to set third liq warn % >= max % - should produce an error', async () => {
    leaserConfigMsg.config.liability.third_liq_warn =
      leaserConfigMsg.config.liability.max_percent + 1;

    const result = () =>
      leaserInstance.setLeaserConfig(
        leaserContractAddress,
        user1Wallet,
        leaserConfigMsg,
        customFees.exec,
      );

    await expect(result).rejects.toThrow(
      /^.*LeaseHealthyLiability% must be less than LeaseMaxLiability% and LeaseInitialLiability% must be less or equal to LeaseHealthyLiability%.*/,
    );

    leaserConfigMsg.config.liability.third_liq_warn =
      leaserConfigMsg.config.liability.max_percent;

    const result2 = () =>
      leaserInstance.setLeaserConfig(
        leaserContractAddress,
        user1Wallet,
        leaserConfigMsg,
        customFees.exec,
      );

    await expect(result2).rejects.toThrow(
      /^.*LeaseHealthyLiability% must be less than LeaseMaxLiability% and LeaseInitialLiability% must be less or equal to LeaseHealthyLiability%.*/,
    );
  });

  test('the business tries to set grace period > interest period - should produce an error', async () => {
    leaserConfigMsg.config.repayment.grace_period_sec =
      leaserConfigMsg.config.repayment.period_sec + 1;

    const result = () =>
      leaserInstance.setLeaserConfig(
        leaserContractAddress,
        user1Wallet,
        leaserConfigMsg,
        customFees.exec,
      );

    await expect(result).rejects.toThrow(
      /^.*Period length should be greater than grace period.*/,
    );
  });
});
