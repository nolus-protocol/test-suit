import { assertIsDeliverTxSuccess } from '@cosmjs/stargate';
import { NolusClient, NolusWallet, NolusContracts } from '@nolus/nolusjs';
import { fromHex } from '@cosmjs/encoding';
import { runOrSkip, runTestIfLocal } from '../util/testingRules';
import NODE_ENDPOINT, {
  createWallet,
  getUser1Wallet,
  getWallet,
} from '../util/clients';
import { customFees } from '../util/utils';
import { sendSudoContractProposal } from '../util/proposals';
import { getLeaseGroupCurrencies } from '../util/smart-contracts/getters';

runOrSkip(process.env.TEST_LENDER as string)(
  'LPP contract tests - Config',
  () => {
    let userWithBalanceWallet: NolusWallet;
    let wallet: NolusWallet;
    let lppInstance: NolusContracts.Lpp;
    let configBefore: NolusContracts.LppConfig;
    let borrowRateBefore: NolusContracts.LppConfig['borrow_rate'];
    let borrowRateMsg: any;

    const lppContractAddress = process.env.LPP_ADDRESS as string;

    async function sendPropToSetMinUtilization(
      minUtilization: number,
      errorMsg?: string,
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

      if (errorMsg) {
        expect(broadcastTx.rawLog).toContain(errorMsg);
      } else {
        assertIsDeliverTxSuccess(broadcastTx);
      }
    }

    async function sendPropToUpdateBorrowRate(
      errorMsg?: string,
    ): Promise<void> {
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

      if (errorMsg) {
        expect(broadcastTx.rawLog).toContain(errorMsg);
      } else {
        assertIsDeliverTxSuccess(broadcastTx);
      }

      borrowRateMsg = {
        new_borrow_rate: {
          borrow_rate: JSON.parse(JSON.stringify(borrowRateBefore)),
        },
      };
    }

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);
      const cosm = await NolusClient.getInstance().getCosmWasmClient();

      lppInstance = new NolusContracts.Lpp(cosm, lppContractAddress);

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

    test('try to set min_utilization % === 0%', async () => {
      await sendPropToSetMinUtilization(0);
    });

    test('try to set min_utilization % === 100%', async () => {
      await sendPropToSetMinUtilization(1000);
    });

    test('try to set min_utilization % > 100% - should produce an error', async () => {
      const minUtilization = 1001;

      await sendPropToSetMinUtilization(
        1001,
        `Upper bound is: 1000, but got: ${minUtilization}!`,
      );
    });

    test('try to set base_interest_rate % === 0%', async () => {
      borrowRateMsg.new_borrow_rate.borrow_rate.base_interest_rate = 0;

      await sendPropToUpdateBorrowRate();
    });

    test('try to set base_interest_rate % > 100% - should produce an error', async () => {
      borrowRateMsg.new_borrow_rate.borrow_rate.base_interest_rate = 1001;

      await sendPropToUpdateBorrowRate(
        'Rates should not be greater than a hundred percent!',
      );
    });

    test('try to set utilization_optimal % === 0% - should produce an error', async () => {
      borrowRateMsg.new_borrow_rate.borrow_rate.utilization_optimal = 0;

      await sendPropToUpdateBorrowRate(
        'Rates should not be greater than a hundred percent!',
      );
    });

    test('try to set utilization_optimal % === 100% - should produce an error', async () => {
      borrowRateMsg.new_borrow_rate.borrow_rate.utilization_optimal = 1000;

      await sendPropToUpdateBorrowRate(
        'Rates should not be greater than a hundred percent!',
      );
    });

    test('try to set addon_optimal_interest_rate % === 0%', async () => {
      borrowRateMsg.new_borrow_rate.borrow_rate.addon_optimal_interest_rate = 0;

      await sendPropToUpdateBorrowRate();
    });

    test('try to set addon_optimal_interest_rate % > 100% - should produce an error', async () => {
      borrowRateMsg.new_borrow_rate.borrow_rate.addon_optimal_interest_rate = 1001;

      await sendPropToUpdateBorrowRate(
        'Rates should not be greater than a hundred percent!',
      );
    });

    runTestIfLocal(
      'instantiate lpp with an lpn currency other than the one in the protocol - should produce an error',
      async () => {
        const adminContractAddress = process.env
          .ADMIN_CONTRACT_ADDRESS as string;
        const oracleContractAddress = process.env.ORACLE_ADDRESS as string;

        const dexAdmin = fromHex(process.env.DEX_ADMIN_PRIV_KEY as string);
        const dexAdminWallet = await getWallet(dexAdmin);

        const lppCodeId = process.env.LPP_CODE_ID as string;

        const cosm = await NolusClient.getInstance().getCosmWasmClient();
        const oracleInstance = new NolusContracts.Oracle(
          cosm,
          oracleContractAddress,
        );
        const leaseCurrency = (
          await getLeaseGroupCurrencies(oracleInstance)
        )[0];

        const instantiateLppContractMsg = {
          lpn_ticker: leaseCurrency,
          lease_code_admin: 'leaser-address',
          lease_code_id: '1',
          borrow_rate: {
            base_interest_rate: 100,
            utilization_optimal: 750,
            addon_optimal_interest_rate: 20,
          },
          min_utilization: 10,
        };

        const instantiateContractMsg = {
          instantiate: {
            code_id: lppCodeId,
            label: 'test-lpp-inst',
            message: JSON.stringify(instantiateLppContractMsg),
            protocol: 'TEST_PROTOCOL',
            expected_address: 'expected-address',
          },
        };

        const broadcastTx = () =>
          dexAdminWallet.executeContract(
            adminContractAddress,
            instantiateContractMsg,
            customFees.exec,
          );

        await expect(broadcastTx).rejects.toThrow(
          `Found a symbol '${leaseCurrency}' pretending to be ticker of a currency pertaining to the lpns group`,
        );
      },
    );
  },
);
