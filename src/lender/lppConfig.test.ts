import { NolusClient, NolusWallet } from '../util/nolus';
import NODE_ENDPOINT, { createWallet, getUser1Wallet } from '../util/clients';
import { customFees } from '../util/utils';
import { sendSudoContractProposal } from '../util/proposals';
import { runOrSkip } from '../util/testingRules';
import { Lpp, LppConfig } from '../util/contracts';

const maybe = runOrSkip(process.env.TEST_LENDER as string);

maybe('LPP contract tests - Config', () => {
  let userWithBalanceWallet: NolusWallet;
  let wallet: NolusWallet;
  let lppInstance: Lpp;
  let configBefore: LppConfig;
  let borrowRateBefore: LppConfig['borrow_rate'];
  let borrowRateMsg: any;

  const lppContractAddress = process.env.LPP_ADDRESS as string;

  async function sendPropToSetMinUtilization(
    minUtilization: number,
    errorMsg: string,
  ): Promise<void> {
    await userWithBalanceWallet.transferAmount(
      wallet.address as string,
      customFees.configs.amount,
      customFees.transfer,
    );

    const minUtilizationMsg = {
      min_utilization: { min_utilization: minUtilization },
    };

    const broadcastTx = await sendSudoContractProposal(
      wallet,
      lppContractAddress,
      JSON.stringify(minUtilizationMsg),
    );

    expect(broadcastTx.rawLog).toContain(errorMsg);
  }

  async function sendPropToUpdateBorrowRate(errorMsg: string): Promise<void> {
    await userWithBalanceWallet.transferAmount(
      wallet.address as string,
      customFees.configs.amount,
      customFees.transfer,
    );

    const broadcastTx = await sendSudoContractProposal(
      wallet,
      lppContractAddress,
      JSON.stringify(borrowRateMsg),
    );

    expect(broadcastTx.rawLog).toContain(errorMsg);

    borrowRateMsg = {
      new_borrow_rate: {
        borrow_rate: JSON.parse(JSON.stringify(borrowRateBefore)),
      },
    };
  }

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    const cosm = await NolusClient.getInstance().getCosmWasmClient();

    lppInstance = new Lpp(cosm, lppContractAddress);

    userWithBalanceWallet = await getUser1Wallet();
    wallet = await createWallet();

    configBefore = await lppInstance.getLppConfig();

    borrowRateBefore = configBefore.borrow_rate;
    borrowRateMsg = {
      new_borrow_rate: {
        borrow_rate: JSON.parse(JSON.stringify(borrowRateBefore)),
      },
    };
  });

  afterEach(async () => {
    const configAfter = await lppInstance.getLppConfig();

    expect(configAfter).toStrictEqual(configBefore);
  });

  test('try to set min_utilization % > 100% - should produce an error', async () => {
    const minUtilization = 1001;

    await sendPropToSetMinUtilization(
      minUtilization,
      `Upper bound is: 1000, but got: 1001`,
    );
  });

  test('try to set base_interest_rate % > 100% - should produce an error', async () => {
    borrowRateMsg.new_borrow_rate.borrow_rate.base_interest_rate = 1001;

    await sendPropToUpdateBorrowRate(`Upper bound is: 1000, but got: 1001`);
  });

  test('try to set utilization_optimal % === 0% - should produce an error', async () => {
    borrowRateMsg.new_borrow_rate.borrow_rate.utilization_optimal = 0;

    await sendPropToUpdateBorrowRate(
      'Rates should not be greater than a hundred percent!',
    );
  });

  test('try to set utilization_optimal % === 100% - should produce an error', async () => {
    const utilizationOptimal = 1000;
    borrowRateMsg.new_borrow_rate.borrow_rate.utilization_optimal =
      utilizationOptimal;

    await sendPropToUpdateBorrowRate(
      'Rates should not be greater than a hundred percent!',
    );
  });

  test('try to set addon_optimal_interest_rate % > 100% - should produce an error', async () => {
    const addonOptimalIRate = 1001;
    borrowRateMsg.new_borrow_rate.borrow_rate.addon_optimal_interest_rate =
      addonOptimalIRate;

    await sendPropToUpdateBorrowRate(
      `Upper bound is: 1000, but got: ${addonOptimalIRate}`,
    );
  });
});
