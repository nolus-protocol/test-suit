import Long from 'long';
import * as fs from 'fs';
import { isDeliverTxFailure } from '@cosmjs/stargate';
import { toUtf8 } from '@cosmjs/encoding';
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
import NODE_ENDPOINT, { getUser1Wallet } from '../util/clients';
import { UpgradeProposal, ClientUpdateProposal } from '../util/proposals';
import { NolusWallet, NolusClient } from '@nolus/nolusjs';
import {
  customFees,
  gasPrice,
  NATIVE_MINIMAL_DENOM,
  undefinedHandler,
  validatorPart,
} from '../util/utils';
import { getProposal } from '../util/gov';

describe('Proposal submission tests', () => {
  let wallet: NolusWallet;
  let msg: any;
  let fee = customFees.exec;
  let moduleName: string;

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    wallet = await getUser1Wallet();

    moduleName = 'gov';
    msg = {
      typeUrl: '/cosmos.gov.v1beta1.MsgSubmitProposal',
      value: {
        content: {},
        proposer: wallet.address as string,
        initialDeposit: [{ denom: NATIVE_MINIMAL_DENOM, amount: '12' }],
      },
    };
  });

  afterEach(async () => {
    const result = await wallet.signAndBroadcast(
      wallet.address as string,
      [msg],
      fee,
    );
    expect(isDeliverTxFailure(result)).toBeFalsy();
    const log = result.rawLog;
    // console.log(result);

    if (!log) {
      undefinedHandler();
      return;
    }

    const proposalId = JSON.parse(log)[0].events[4].attributes[0].value;

    // check if proposal is added
    const proposalInfo = await getProposal(proposalId);
    expect(proposalInfo.proposal).toBeDefined();
  });

  test('validator should be able to submit a Text proposal', async () => {
    msg.value.content = {
      typeUrl: '/cosmos.gov.v1beta1.TextProposal',
      value: TextProposal.encode({
        description:
          'This proposal proposes to test whether this proposal passes',
        title: 'Test Proposal',
      }).finish(),
    };
    moduleName = 'gov';

    fee = customFees.configs;
  });

  test('validator should be able to submit a CommunityPoolSpend proposal', async () => {
    msg.value.content = {
      typeUrl: '/cosmos.distribution.v1beta1.CommunityPoolSpendProposal',
      value: CommunityPoolSpendProposal.encode({
        description:
          'This proposal proposes to test whether this proposal passes',
        title: 'Test Proposal',
        recipient: wallet.address as string,
        amount: [{ denom: NATIVE_MINIMAL_DENOM, amount: '1000000' }],
      }).finish(),
    };
    moduleName = 'distribution';

    fee = customFees.configs;
  });

  test('validator should be able to submit a ParameterChange proposal', async () => {
    msg.value.content = {
      typeUrl: '/cosmos.params.v1beta1.ParameterChangeProposal',
      value: ParameterChangeProposal.encode({
        description:
          'This proposal proposes to test whether this proposal passes',
        title: 'Test Proposal',
        changes: [
          {
            subspace: 'wasm',
            key: 'uploadAccess',
            value: '{ "permission": "Nobody" }',
          },
        ],
      }).finish(),
    };
    moduleName = 'params';

    fee = customFees.configs;
  });

  test('validator should be able to submit a SoftwareUpgrade proposal', async () => {
    msg.value.content = {
      typeUrl: '/cosmos.upgrade.v1beta1.SoftwareUpgradeProposal',
      value: SoftwareUpgradeProposal.encode({
        description:
          'This proposal proposes to test whether this proposal passes',
        title: 'Test Proposal',
        plan: {
          name: 'Upgrade 1',
          height: Long.fromInt(+(await wallet.getBlock()).header.height + 1000), // any block after the current one
          info: '',
        },
      }).finish(),
    };
    moduleName = 'upgrade';

    fee = customFees.configs;
  });

  test('validator should be able to submit a CancelSoftwareUpgrade proposal', async () => {
    msg.value.content = {
      typeUrl: '/cosmos.upgrade.v1beta1.CancelSoftwareUpgradeProposal',
      value: CancelSoftwareUpgradeProposal.encode({
        description:
          'This proposal proposes to test whether this proposal passes',
        title: 'Test Proposal',
      }).finish(),
    };
    moduleName = 'upgrade';

    fee = customFees.configs;
  });

  test('validator should be able to submit an IBC Upgrade proposal', async () => {
    msg.value.content = {
      typeUrl: '/ibc.core.client.v1.UpgradeProposal',
      value: UpgradeProposal.encode({
        description:
          'This proposal proposes to test whether this proposal passes',
        title: 'Test Proposal',
        plan: {
          name: 'Upgrade 1',
          height: Long.fromInt(+(await wallet.getBlock()).header.height + 1000), // any block after the current one
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
    moduleName = 'client';

    fee = customFees.configs;
  });

  // TO DO
  xtest('validator should be able to submit a ClientUpgrade proposal', async () => {
    msg.value.content = {
      typeUrl: '/ibc.core.client.v1.ClientUpdateProposal',
      value: ClientUpdateProposal.encode({
        description:
          'This proposal proposes to test whether this proposal passes',
        title: 'Test Proposal',
        subjectClientId: 'tendermint-1',
        substituteClientId: 'tendermint-07',
      }).finish(),
    };
    moduleName = 'client';

    fee = customFees.configs;
  });

  test('validator should be able to submit a StoreCode proposal', async () => {
    const wasmBinary: Buffer = fs.readFileSync(
      './wasm-contracts/cw20_base.wasm',
    );

    msg.value.content = {
      typeUrl: '/cosmwasm.wasm.v1.StoreCodeProposal',
      value: StoreCodeProposal.encode({
        description:
          'This proposal proposes to test whether this proposal passes',
        title: 'Test Proposal',
        runAs: wallet.address as string,
        wasmByteCode: wasmBinary,
      }).finish(),
    };
    moduleName = 'wasm';

    const gas = '20000000000';
    fee = {
      gas: gas,
      amount: [
        {
          amount: Math.floor((+gas * gasPrice) / validatorPart).toString(),
          denom: NATIVE_MINIMAL_DENOM,
        },
      ],
    };
  });

  test('validator should be able to submit a InstantiateContract proposal', async () => {
    msg.value.content = {
      typeUrl: '/cosmwasm.wasm.v1.InstantiateContractProposal',
      value: InstantiateContractProposal.encode({
        description:
          'This proposal proposes to test whether this proposal passes',
        title: 'Test Proposal',
        runAs: wallet.address as string,
        admin: wallet.address as string,
        codeId: Long.fromInt(1),
        label: 'contractlabel',
        msg: toUtf8('{}'),
        funds: [{ denom: NATIVE_MINIMAL_DENOM, amount: '12' }],
      }).finish(),
    };
    moduleName = 'wasm';
  });

  //TO DO
  // Remark: RunAs was removed around wasmd 0.23 making this test fail as cosmjs still hasn't updated it's MigrateConctractProposal definition
  xtest('validator should be able to submit a MigrateContract proposal', async () => {
    msg.value.content = {
      typeUrl: '/cosmwasm.wasm.v1.MigrateContractProposal',
      value: MigrateContractProposal.encode({
        title: 'Test Proposal',
        description:
          'This proposal proposes to test whether this proposal passes',
        runAs: wallet.address as string,
        contract: wallet.address as string,
        codeId: Long.fromInt(1),
        msg: toUtf8('{}'),
      }).finish(),
    };
    moduleName = 'wasm';

    fee = customFees.configs;
  });

  test('validator should be able to submit a UpdateAdmin proposal', async () => {
    msg.value.content = {
      typeUrl: '/cosmwasm.wasm.v1.UpdateAdminProposal',
      value: UpdateAdminProposal.encode({
        description:
          'This proposal proposes to test whether this proposal passes',
        title: 'Test Proposal',
        newAdmin: wallet.address as string,
        contract: process.env.LEASER_ADDRESS as string,
      }).finish(),
    };
    moduleName = 'wasm';

    fee = customFees.configs;
  });

  test('validator should be able to submit a ClearAdmin proposal', async () => {
    msg.value.content = {
      typeUrl: '/cosmwasm.wasm.v1.ClearAdminProposal',
      value: ClearAdminProposal.encode({
        description:
          'This proposal proposes to test whether this proposal passes',
        title: 'Test Proposal',
        contract: process.env.LEASER_ADDRESS as string,
      }).finish(),
    };
    moduleName = 'wasm';

    fee = customFees.configs;
  });

  test('validator should be able to submit a PinCodes proposal', async () => {
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

    fee = customFees.configs;
  });

  test('validator should be able to submit a UnpinCodes proposal', async () => {
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

    fee = customFees.configs;
  });
});
