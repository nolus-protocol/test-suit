import NODE_ENDPOINT, { getUser1Wallet, createWallet } from '../util/clients';
import { customFees } from '../util/utils';
import { NolusClient, NolusWallet, NolusContracts } from '@nolus/nolusjs';
import { sendInitExecuteFeeTokens } from '../util/transfer';
import { LeaserConfig } from '@nolus/nolusjs/build/contracts';

describe('Leaser contract tests - Config', () => {
  let user1Wallet: NolusWallet;
  let wallet: NolusWallet;
  let leaseInstance: NolusContracts.Lease;

  const leaserContractAddress = process.env.LEASER_ADDRESS as string;

  let leaserConfigMsg: LeaserConfig = {
    config: {
      lease_interest_rate_margin: 50,
      liability: {
        max: 90,
        healthy: 50,
        initial: 45,
      },
      repayment: {
        period_sec: 186000,
        grace_period_sec: 23000,
      },
    },
  };

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    user1Wallet = await getUser1Wallet();
    wallet = await createWallet();
    leaseInstance = new NolusContracts.Lease();
  });

  afterEach(() => {
    leaserConfigMsg = {
      config: {
        lease_interest_rate_margin: 50,
        liability: {
          max: 90,
          healthy: 50,
          initial: 45,
        },
        repayment: {
          period_sec: 186000,
          grace_period_sec: 23000,
        },
      },
    };
  });

  test('an unauthorized user tries to change the configuration - should produce an error', async () => {
    await sendInitExecuteFeeTokens(user1Wallet, wallet.address as string);

    const result = () =>
      leaseInstance.setLeaserConfig(
        leaserContractAddress,
        wallet,
        leaserConfigMsg,
        customFees.exec,
      );

    await expect(result).rejects.toThrow(/^.*Unauthorized.*/);
  });

  test('the business tries to set initial liability % > healthy liability % - should produce an error', async () => {
    leaserConfigMsg.config.liability.initial =
      leaserConfigMsg.config.liability.healthy + 1;

    const result = () =>
      leaseInstance.setLeaserConfig(
        leaserContractAddress,
        user1Wallet,
        leaserConfigMsg,
        customFees.exec,
      );

    await expect(result).rejects.toThrow(
      /^.*LeaseInitialLiability% must be less or equal to LeaseHealthyLiability%*/,
    );
  });

  test('the business tries to set initial liability % > max liability % - should produce an error', async () => {
    leaserConfigMsg.config.liability.initial =
      leaserConfigMsg.config.liability.max + 1;

    const result = () =>
      leaseInstance.setLeaserConfig(
        leaserContractAddress,
        user1Wallet,
        leaserConfigMsg,
        customFees.exec,
      );

    await expect(result).rejects.toThrow(
      /^.*'LeaseInitialLiability% must be less or equal to LeaseHealthyLiability%'*/,
    );
  });

  test('the business tries to set healthy liability % > max liability % - should produce an error', async () => {
    leaserConfigMsg.config.liability.healthy =
      leaserConfigMsg.config.liability.max + 1;

    const result = () =>
      leaseInstance.setLeaserConfig(
        leaserContractAddress,
        user1Wallet,
        leaserConfigMsg,
        customFees.exec,
      );

    await expect(result).rejects.toThrow(
      /^.*'LeaseHealthyLiability% must be less than LeaseMaxLiability%'*/,
    );
  });
});
