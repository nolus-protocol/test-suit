import NODE_ENDPOINT, {
  createWallet,
  getUser1Wallet,
  getWasmAdminWallet,
} from '../util/clients';
import { customFees, NATIVE_MINIMAL_DENOM } from '../util/utils';
import { NolusClient, NolusWallet, NolusContracts } from '@nolus/nolusjs';
import { sendInitExecuteFeeTokens } from '../util/transfer';
import { LeaserConfig } from '@nolus/nolusjs/build/contracts';

describe('Leaser contract tests - Config', () => {
  let user1Wallet: NolusWallet;
  let wallet: NolusWallet;
  let leaserInstance: NolusContracts.Leaser;
  let configBefore: NolusContracts.LeaserConfig;

  const leaserContractAddress = process.env.LEASER_ADDRESS as string;

  let leaserConfigMsg: LeaserConfig = {
    config: {
      lease_interest_rate_margin: 50,
      liability: {
        max_percent: 90,
        healthy_percent: 50,
        init_percent: 45,
        recalc_secs: 7200,
      },
      repayment: {
        period_sec: 186000,
        grace_period_sec: 23000,
      },
    },
  };

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    user1Wallet = await getWasmAdminWallet();
    const userWithBalance = await getUser1Wallet();
    wallet = await createWallet();

    const cosm = await NolusClient.getInstance().getCosmWasmClient();
    leaserInstance = new NolusContracts.Leaser(cosm);

    configBefore = await leaserInstance.getLeaserConfig(leaserContractAddress);

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
    leaserConfigMsg = {
      config: {
        lease_interest_rate_margin: 50,
        liability: {
          max_percent: 90,
          healthy_percent: 50,
          init_percent: 45,
          recalc_secs: 7200,
        },
        repayment: {
          period_sec: 186000,
          grace_period_sec: 23000,
        },
      },
    };

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
