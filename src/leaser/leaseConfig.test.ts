// import NODE_ENDPOINT, {
//   createWallet,
//   getWasmAdminWallet,
// } from '../util/clients';
// import { customFees } from '../util/utils';
// import { NolusClient, NolusWallet, NolusContracts } from '@nolus/nolusjs';
// import { sendInitExecuteFeeTokens } from '../util/transfer';
// import { LeaserConfig } from '@nolus/nolusjs/build/contracts';

// describe('Leaser contract tests - Config', () => {
//   let user1Wallet: NolusWallet;
//   let wallet: NolusWallet;
//   let leaseInstance: NolusContracts.Lease;

//   const leaserContractAddress = process.env.LEASER_ADDRESS as string;

//   let leaserConfigMsg: LeaserConfig = {
//     config: {
//       lease_interest_rate_margin: 50,
//       liability: {
//         max_percent: 90,
//         healthy_percent: 50,
//         init_percent: 45,
//         recalc_secs: 7200,
//       },
//       repayment: {
//         period_sec: 186000,
//         grace_period_sec: 23000,
//       },
//     },
//   };

//   beforeAll(async () => {
//     NolusClient.setInstance(NODE_ENDPOINT);
//     user1Wallet = await getWasmAdminWallet();
//     wallet = await createWallet();

//     const cosm = await NolusClient.getInstance().getCosmWasmClient();
//     leaseInstance = new NolusContracts.Lease(cosm);
//   });

//   afterEach(() => {
//     leaserConfigMsg = {
//       config: {
//         lease_interest_rate_margin: 50,
//         liability: {
//           max_percent: 90,
//           healthy_percent: 50,
//           init_percent: 45,
//           recalc_secs: 7200,
//         },
//         repayment: {
//           period_sec: 186000,
//           grace_period_sec: 23000,
//         },
//       },
//     };
//   });

//   test('an unauthorized user tries to change the configuration - should produce an error', async () => {
//     await sendInitExecuteFeeTokens(user1Wallet, wallet.address as string);

//     const result = () =>
//       leaseInstance.setLeaserConfig(
//         leaserContractAddress,
//         wallet,
//         leaserConfigMsg,
//         customFees.exec,
//       );

//     await expect(result).rejects.toThrow(/^.*Unauthorized.*/);
//   });

//   test('the business tries to set initial liability % > healthy liability % - should produce an error', async () => {
//     console.log(leaserConfigMsg.config.liability.init_percent);
//     console.log(leaserConfigMsg.config.liability.healthy_percent + 1);
//     leaserConfigMsg.config.liability.init_percent =
//       leaserConfigMsg.config.liability.healthy_percent + 1;
//     console.log(leaserConfigMsg.config);

//     // const result = () =>
//     await leaseInstance.setLeaserConfig(
//       leaserContractAddress,
//       user1Wallet,
//       leaserConfigMsg,
//       customFees.exec,
//     );

//     console.log(await leaseInstance.getLeaserConfig(leaserContractAddress));

//     // await expect(result).rejects.toThrow(
//     //   /^.*LeaseInitialLiability% must be less or equal to LeaseHealthyLiability%*/,
//     // );
//   });

//   test('the business tries to set initial liability % > max liability % - should produce an error', async () => {
//     leaserConfigMsg.config.liability.init_percent =
//       leaserConfigMsg.config.liability.max_percent + 1;

//     const result = () =>
//       leaseInstance.setLeaserConfig(
//         leaserContractAddress,
//         user1Wallet,
//         leaserConfigMsg,
//         customFees.exec,
//       );

//     await expect(result).rejects.toThrow(
//       /^.*'LeaseInitialLiability% must be less or equal to LeaseHealthyLiability%'*/,
//     );
//   });

//   test('the business tries to set healthy liability % > max liability % - should produce an error', async () => {
//     leaserConfigMsg.config.liability.healthy_percent =
//       leaserConfigMsg.config.liability.max_percent + 1;

//     const result = () =>
//       leaseInstance.setLeaserConfig(
//         leaserContractAddress,
//         user1Wallet,
//         leaserConfigMsg,
//         customFees.exec,
//       );

//     await expect(result).rejects.toThrow(
//       /^.*'LeaseHealthyLiability% must be less than LeaseMaxLiability%'*/,
//     );
//   });
// });
