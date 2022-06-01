import Long from 'long';
import { isDeliverTxFailure } from '@cosmjs/stargate';
import { StdFee } from '@cosmjs/amino';
import { toUtf8 } from '@cosmjs/encoding';
import { AccountData, DirectSecp256k1Wallet } from '@cosmjs/proto-signing';
import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { TextProposal } from 'cosmjs-types/cosmos/gov/v1beta1/gov';
import { ParameterChangeProposal } from 'cosmjs-types/cosmos/params/v1beta1/params';
import { CommunityPoolSpendProposal } from 'cosmjs-types/cosmos/distribution/v1beta1/distribution';
import {
  SoftwareUpgradeProposal,
  CancelSoftwareUpgradeProposal,
} from 'cosmjs-types/cosmos/upgrade/v1beta1/upgrade';
import { ClientState } from 'cosmjs-types/ibc/lightclients/tendermint/v1/tendermint';
import {
  StoreCodeProposal,
  InstantiateContractProposal,
  MigrateContractProposal,
  UpdateAdminProposal,
  ClearAdminProposal,
  PinCodesProposal,
  UnpinCodesProposal,
} from 'cosmjs-types/cosmwasm/wasm/v1/proposal';
import { getUser1Client, getUser1Wallet } from '../util/clients';
import { UpgradeProposal, ClientUpdateProposal } from '../util/proposals';
import { ChainConstants } from '@nolus/nolusjs/build/constants';

describe('Proposal submission tests', () => {
  let client: SigningCosmWasmClient;
  let wallet: DirectSecp256k1Wallet;
  let firstAccount: AccountData;
  let msg: any;
  let fee: StdFee;
  let moduleName: string;
  let NATIVE_TOKEN_DENOM: string;

  beforeAll(async () => {
    NATIVE_TOKEN_DENOM = ChainConstants.COIN_MINIMAL_DENOM;
    client = await getUser1Client();
    wallet = await getUser1Wallet();
    [firstAccount] = await wallet.getAccounts();

    fee = {
      amount: [{ denom: NATIVE_TOKEN_DENOM, amount: '12' }],
      gas: '100000',
    };

    moduleName = 'gov';
    msg = {
      typeUrl: '/cosmos.gov.v1beta1.MsgSubmitProposal',
      value: {
        content: {},
        proposer: firstAccount.address,
        initialDeposit: [{ denom: NATIVE_TOKEN_DENOM, amount: '12' }],
      },
    };
  });

  afterEach(async () => {
    const result = await client.signAndBroadcast(
      firstAccount.address,
      [msg],
      fee,
    );
    expect(isDeliverTxFailure(result)).toBeTruthy();
    expect(result.rawLog).toEqual(
      `failed to execute message; message index: 0: ${moduleName}: no handler exists for proposal type`,
    );
  });

  test('validator should not be able to submit a Text proposal', async () => {
    msg.value.content = {
      typeUrl: '/cosmos.gov.v1beta1.TextProposal',
      value: TextProposal.encode({
        description:
          'This proposal proposes to test whether this proposal passes',
        title: 'Test Proposal',
      }).finish(),
    };
    moduleName = 'gov';
  });

  test('validator should not be able to submit a CommunityPoolSpend proposal', async () => {
    msg.value.content = {
      typeUrl: '/cosmos.distribution.v1beta1.CommunityPoolSpendProposal',
      value: CommunityPoolSpendProposal.encode({
        description:
          'This proposal proposes to test whether this proposal passes',
        title: 'Test Proposal',
        recipient: firstAccount.address,
        amount: [{ denom: NATIVE_TOKEN_DENOM, amount: '1000000' }],
      }).finish(),
    };
    moduleName = 'distribution';
  });

  test('validator should not be able to submit a ParameterChange proposal', async () => {
    msg.value.content = {
      typeUrl: '/cosmos.params.v1beta1.ParameterChangeProposal',
      value: ParameterChangeProposal.encode({
        description:
          'This proposal proposes to test whether this proposal passes',
        title: 'Test Proposal',
        changes: [
          {
            subspace: 'subspace',
            key: 'key',
            value: 'value',
          },
        ],
      }).finish(),
    };
    moduleName = 'params';
  });

  test('validator should not be able to submit a SoftwareUpgrade proposal', async () => {
    msg.value.content = {
      typeUrl: '/cosmos.upgrade.v1beta1.SoftwareUpgradeProposal',
      value: SoftwareUpgradeProposal.encode({
        description:
          'This proposal proposes to test whether this proposal passes',
        title: 'Test Proposal',
        plan: {
          name: 'Upgrade 1',
          height: Long.fromInt(10000),
          info: '',
        },
      }).finish(),
    };
    moduleName = 'upgrade';
  });

  test('validator should not be able to submit a CancelSoftwareUpgrade proposal', async () => {
    msg.value.content = {
      typeUrl: '/cosmos.upgrade.v1beta1.CancelSoftwareUpgradeProposal',
      value: CancelSoftwareUpgradeProposal.encode({
        description:
          'This proposal proposes to test whether this proposal passes',
        title: 'Test Proposal',
      }).finish(),
    };
    moduleName = 'upgrade';
  });

  test('validator should not be able to submit an IBC Upgrade proposal', async () => {
    msg.value.content = {
      typeUrl: '/ibc.core.client.v1.UpgradeProposal',
      value: UpgradeProposal.encode({
        description:
          'This proposal proposes to test whether this proposal passes',
        title: 'Test Proposal',
        plan: {
          name: 'Upgrade 1',
          height: Long.fromInt(10000),
          info: '',
        },
        upgradedClientState: {
          typeUrl: '/ibc.lightclients.tendermint.v1.ClientState',
          value: ClientState.encode({
            chainId: 'nolus-private',
            proofSpecs: [{ minDepth: 0, maxDepth: 0 }],
            upgradePath: ['upgrade', 'upgradedIBCState'],
            allowUpdateAfterExpiry: true,
            allowUpdateAfterMisbehaviour: true,
          }).finish(),
        },
      }).finish(),
    };
    fee = {
      amount: [{ denom: NATIVE_TOKEN_DENOM, amount: '12' }],
      gas: '200000',
    };
    moduleName = 'client';
  });

  test('validator should not be able to submit a ClientUpgrade proposal', async () => {
    msg.value.content = {
      typeUrl: '/ibc.core.client.v1.ClientUpdateProposal',
      value: ClientUpdateProposal.encode({
        description:
          'This proposal proposes to test whether this proposal passes',
        title: 'Test Proposal',
        subjectClientId: 'tendermint-07',
        substituteClientId: 'tendermint-08',
      }).finish(),
    };
    moduleName = 'client';
  });

  test('validator should not be able to submit a StoreCode proposal', async () => {
    msg.value.content = {
      typeUrl: '/cosmwasm.wasm.v1.StoreCodeProposal',
      value: StoreCodeProposal.encode({
        description:
          'This proposal proposes to test whether this proposal passes',
        title: 'Test Proposal',
        runAs: firstAccount.address,
        wasmByteCode: new Uint8Array(2),
      }).finish(),
    };
    moduleName = 'wasm';
  });

  test('validator should not be able to submit a InstantiateContract proposal', async () => {
    msg.value.content = {
      typeUrl: '/cosmwasm.wasm.v1.InstantiateContractProposal',
      value: InstantiateContractProposal.encode({
        description:
          'This proposal proposes to test whether this proposal passes',
        title: 'Test Proposal',
        runAs: firstAccount.address,
        admin: firstAccount.address,
        codeId: Long.fromInt(1),
        label: 'contractlabel',
        msg: toUtf8('{}'),
        funds: [{ denom: NATIVE_TOKEN_DENOM, amount: '12' }],
      }).finish(),
    };
    moduleName = 'wasm';
  });

  // Remark: RunAs was removed around wasmd 0.23 making this test fail as cosmjs still hasn't updated it's MigrateConctractProposal definition
  xtest('validator should not be able to submit a MigrateContract proposal', async () => {
    msg.value.content = {
      typeUrl: '/cosmwasm.wasm.v1.MigrateContractProposal',
      value: MigrateContractProposal.encode({
        title: 'Test Proposal',
        description:
          'This proposal proposes to test whether this proposal passes',
        runAs: firstAccount.address,
        contract: firstAccount.address,
        codeId: Long.fromInt(1),
        msg: toUtf8('{}'),
      }).finish(),
    };
    moduleName = 'wasm';
  });

  test('validator should not be able to submit a UpdateAdmin proposal', async () => {
    msg.value.content = {
      typeUrl: '/cosmwasm.wasm.v1.UpdateAdminProposal',
      value: UpdateAdminProposal.encode({
        description:
          'This proposal proposes to test whether this proposal passes',
        title: 'Test Proposal',
        newAdmin: firstAccount.address,
        contract: firstAccount.address,
      }).finish(),
    };
    moduleName = 'wasm';
  });

  test('validator should not be able to submit a ClearAdmin proposal', async () => {
    msg.value.content = {
      typeUrl: '/cosmwasm.wasm.v1.ClearAdminProposal',
      value: ClearAdminProposal.encode({
        description:
          'This proposal proposes to test whether this proposal passes',
        title: 'Test Proposal',
        contract: firstAccount.address,
      }).finish(),
    };
    moduleName = 'wasm';
  });

  test('validator should not be able to submit a PinCodes proposal', async () => {
    msg.value.content = {
      typeUrl: '/cosmwasm.wasm.v1.PinCodesProposal',
      value: PinCodesProposal.encode({
        description:
          'This proposal proposes to test whether this proposal passes',
        title: 'Test Proposal',
        codeIds: [Long.fromInt(1)],
      }).finish(),
    };
    moduleName = 'wasm';
  });

  test('validator should not be able to submit a UnpinCodes proposal', async () => {
    msg.value.content = {
      typeUrl: '/cosmwasm.wasm.v1.UnpinCodesProposal',
      value: UnpinCodesProposal.encode({
        description:
          'This proposal proposes to test whether this proposal passes',
        title: 'Test Proposal',
        codeIds: [Long.fromInt(1)],
      }).finish(),
    };
    moduleName = 'wasm';
  });
});
