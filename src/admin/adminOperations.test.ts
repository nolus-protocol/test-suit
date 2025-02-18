import { CosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';
import { runOrSkip } from '../util/testingRules';
import { sendSudoContractProposal } from '../util/proposals';
import NODE_ENDPOINT, { getUser1Wallet } from '../util/clients';
import { customFees } from '../util/utils';

runOrSkip(process.env.TEST_ADMIN as string)('Admin contract tests', () => {
  let userWithBalanceWallet: NolusWallet;
  let cosm: CosmWasmClient;
  let adminInstance: NolusContracts.Admin;
  let protocols: string[];
  let existingProtocol: NolusContracts.Protocol;
  const adminContractAddress = process.env.ADMIN_CONTRACT_ADDRESS as string;

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    cosm = await NolusClient.getInstance().getCosmWasmClient();
    adminInstance = new NolusContracts.Admin(cosm, adminContractAddress);
    userWithBalanceWallet = await getUser1Wallet();

    protocols = await adminInstance.getProtocols();
    existingProtocol = await adminInstance.getProtocol(protocols[0]);
  });

  test('an unregistered account tries to instantiate a contract - should produce an error', async () => {
    const instantiateContractMsg = {
      instantiate: {
        code_id: '1',
        expected_address: process.env.TREASURY_ADDRESS as string,
        protocol: 'protocol',
        label: 'test',
        message: '{}',
      },
    };

    const broadcastTx = () =>
      userWithBalanceWallet.executeContract(
        adminContractAddress,
        instantiateContractMsg,
        customFees.exec,
      );

    await expect(broadcastTx).rejects.toThrow(/^.*Unauthorized access.*/);
  });

  test('an unregistered account tries to register a protocol - should produce an error', async () => {
    const registerPtotocolMsg = {
      register_protocol: {
        name: 'test',
        protocol: existingProtocol,
      },
    };

    const broadcastTx = () =>
      userWithBalanceWallet.executeContract(
        adminContractAddress,
        registerPtotocolMsg,
        customFees.exec,
      );

    await expect(broadcastTx).rejects.toThrow(/^.*Unauthorized access.*/);
  });

  test('user tries to propose registration of an already existing protocol - should produce an error', async () => {
    const registerPtotocolMsg = {
      register_protocol: {
        name: protocols[0],
        protocol: existingProtocol,
      },
    };

    const broadcastTx = await sendSudoContractProposal(
      userWithBalanceWallet,
      adminContractAddress,
      JSON.stringify(registerPtotocolMsg),
    );

    expect(broadcastTx.rawLog).toContain(
      'Protocol set of contracts already exists for this protocol name',
    );
  });

  test('user tries to propose the registration of a DEX admin address that is not valid', async () => {
    const changeDexAdminMsg = {
      change_dex_admin: {
        new_dex_admin: 'osss1qxx93k3hdxmej43jjdvpl23rm5mhexcfhkf6zj',
      },
    };

    const broadcastTx = await sendSudoContractProposal(
      userWithBalanceWallet,
      adminContractAddress,
      JSON.stringify(changeDexAdminMsg),
    );

    expect(broadcastTx.rawLog).toContain('addr_validate errored');
  });

  test('the protocol deregistration msg can only be used internally', async () => {
    const deregisterPtotocolMsg = {
      deregister_protocol: {
        leaser: { code_id: '1', migrate_message: '{}' },
        lpp: { code_id: '1', migrate_message: '{}' },
        oracle: { code_id: '1', migrate_message: '{}' },
        profit: { code_id: '1', migrate_message: '{}' },
        reserve: { code_id: '1', migrate_message: '{}' },
      },
    };

    const broadcastTx = () =>
      userWithBalanceWallet.executeContract(
        adminContractAddress,
        deregisterPtotocolMsg,
        customFees.configs,
      );

    await expect(broadcastTx).rejects.toThrow(
      /^.*Protocol deregistration message not sent by a registered protocol leaser.*/,
    );
  });
});
