import * as fs from 'fs';
import { toUtf8 } from '@cosmjs/encoding';
import { isDeliverTxFailure } from '@cosmjs/stargate';
import {
  MsgCancelUpgrade,
  MsgSoftwareUpgrade,
} from 'cosmjs-types/cosmos/upgrade/v1beta1/tx';
import { MsgUpdateClient } from 'cosmjs-types/ibc/core/client/v1/tx';
import { Any } from 'cosmjs-types/google/protobuf/any';
import { MsgUpdateParams } from 'cosmjs-types/cosmos/staking/v1beta1/tx';
import { MsgCommunityPoolSpend } from 'cosmjs-types/cosmos/distribution/v1beta1/tx';
import {
  MsgClearAdmin,
  MsgInstantiateContract,
  MsgStoreCode,
  MsgUpdateAdmin,
} from 'cosmjs-types/cosmwasm/wasm/v1/tx';
import { NolusWallet, NolusClient } from '@nolus/nolusjs';
import {
  customFees,
  GAS_LIMIT,
  GASPRICE,
  MIN_DEPOSIT_AMOUNT,
  NATIVE_MINIMAL_DENOM,
  undefinedHandler,
  VALIDATOR_PART,
} from '../util/utils';
import { getProposal } from '../util/proposals';
import { runOrSkip } from '../util/testingRules';
import NODE_ENDPOINT, { getUser1Wallet } from '../util/clients';

runOrSkip(process.env.TEST_GOV as string)('Proposal submission tests', () => {
  let wallet: NolusWallet;
  let fee = customFees.exec;
  let msg: any;
  const authority = process.env.GOV_MODULE_ADDRESS as string;

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    wallet = await getUser1Wallet();

    msg = {
      typeUrl: '/cosmos.gov.v1.MsgSubmitProposal',
      value: {
        messages: [],
        metadata: '',
        proposer: wallet.address as string,
        initialDeposit: [MIN_DEPOSIT_AMOUNT],
        summary: 'This proposal proposes to test whether this proposal passes',
        title: 'Test Proposal',
      },
    };

    fee = customFees.configs;
  });

  afterEach(async () => {
    const result = await wallet.signAndBroadcast(
      wallet.address as string,
      [msg],
      fee,
    );

    expect(isDeliverTxFailure(result)).toBeFalsy();
    const events = result.events;

    if (!events) {
      undefinedHandler();
      return;
    }

    // TO DO - find event 'submit_proposal'
    const proposalId = +events[13].attributes[0].value;
    const proposalInfo = await getProposal(proposalId);
    expect(proposalInfo.proposal).toBeDefined();

    fee = customFees.configs;
  });

  test('validator should be able to submit a CommunityPoolSpend proposal', async () => {
    const commPoolSpendMsg = MsgCommunityPoolSpend.fromPartial({
      authority: authority,
      recipient: wallet.address as string,
      amount: [{ denom: NATIVE_MINIMAL_DENOM, amount: '1000000' }],
    });

    msg.value.messages[0] = Any.fromPartial({
      typeUrl: '/cosmos.distribution.v1beta1.MsgCommunityPoolSpend',
      value: Uint8Array.from(
        MsgCommunityPoolSpend.encode(commPoolSpendMsg).finish(),
      ),
    });
  });

  test('validator should be able to submit a ParameterChange proposal', async () => {
    const paramChangeMsg = MsgUpdateParams.fromPartial({
      authority: authority,
      params: {
        unbondingTime: { seconds: BigInt(3333), nanos: 3333 },
        maxValidators: 44,
        maxEntries: 4,
        historicalEntries: 444444,
        bondDenom: 'unls',
        minCommissionRate: '4',
      },
    });

    msg.value.messages[0] = Any.fromPartial({
      typeUrl: '/cosmos.staking.v1beta1.MsgUpdateParams',
      value: Uint8Array.from(MsgUpdateParams.encode(paramChangeMsg).finish()),
    });
  });

  xtest('validator should be able to submit a SoftwareUpgrade proposal', async () => {
    const softwareUpgradeMsg = MsgSoftwareUpgrade.fromPartial({
      authority: authority,
      plan: {
        name: 'Upgrade 1',
        info: '',
      },
    });

    msg.value.messages[0] = Any.fromPartial({
      typeUrl: '/cosmos.upgrade.v1beta1.MsgSoftwareUpgrade',
      value: Uint8Array.from(
        MsgSoftwareUpgrade.encode(softwareUpgradeMsg).finish(),
      ),
    });
  });

  test('validator should be able to submit a CancelSoftwareUpgrade proposal', async () => {
    const cancelSoftwareUpgradeMsg = MsgCancelUpgrade.fromPartial({
      authority: authority,
    });

    msg.value.messages[0] = Any.fromPartial({
      typeUrl: '/cosmos.upgrade.v1beta1.MsgCancelUpgrade',
      value: Uint8Array.from(
        MsgCancelUpgrade.encode(cancelSoftwareUpgradeMsg).finish(),
      ),
    });
  });

  xtest('validator should be able to submit a ClientUpdate proposal', async () => {
    const clientUpdateMsg = MsgUpdateClient.fromPartial({
      clientId: 'tendermint-1',
      // clientMessage: 'TO DO',
      signer: wallet.address as string,
    });

    msg.value.messages[0] = Any.fromPartial({
      typeUrl: '/ibc.core.client.v1.MsgUpdateClient',
      value: Uint8Array.from(MsgUpdateClient.encode(clientUpdateMsg).finish()),
    });
  });

  test('validator should be able to submit a StoreCode proposal', async () => {
    const wasmBinary: Buffer = fs.readFileSync('./cw20_base.wasm');

    const storeCodeMsg = MsgStoreCode.fromPartial({
      wasmByteCode: wasmBinary,
      sender: authority,
    });

    msg.value.messages[0] = Any.fromPartial({
      typeUrl: '/cosmwasm.wasm.v1.MsgStoreCode',
      value: Uint8Array.from(MsgStoreCode.encode(storeCodeMsg).finish()),
    });

    const gas = GAS_LIMIT;
    fee = {
      gas: gas,
      amount: [
        {
          amount: Math.floor((+gas * GASPRICE) / VALIDATOR_PART).toString(),
          denom: NATIVE_MINIMAL_DENOM,
        },
      ],
    };
  });

  test('validator should be able to submit a InstantiateContract proposal', async () => {
    const treasuryInitMsg = {
      rewards_dispatcher: process.env.LEASER_ADDRESS as string,
    };

    const initContractMsg = MsgInstantiateContract.fromPartial({
      admin: wallet.address as string,
      codeId: BigInt(1),
      label: 'contract-label',
      msg: toUtf8(JSON.stringify(treasuryInitMsg)),
      funds: [{ denom: NATIVE_MINIMAL_DENOM, amount: '12' }],
      sender: authority,
    });

    msg.value.messages[0] = Any.fromPartial({
      typeUrl: '/cosmwasm.wasm.v1.MsgInstantiateContract',
      value: Uint8Array.from(
        MsgInstantiateContract.encode(initContractMsg).finish(),
      ),
    });
  });

  test('validator should be able to submit a UpdateAdmin proposal', async () => {
    const updateAdminMsg = MsgUpdateAdmin.fromPartial({
      newAdmin: wallet.address as string,
      contract: process.env.LEASER_ADDRESS as string,
      sender: authority,
    });

    msg.value.messages[0] = Any.fromPartial({
      typeUrl: '/cosmwasm.wasm.v1.MsgUpdateAdmin',
      value: Uint8Array.from(MsgUpdateAdmin.encode(updateAdminMsg).finish()),
    });
  });

  test('validator should be able to submit a ClearAdmin proposal', async () => {
    const clearAdminMsg = MsgClearAdmin.fromPartial({
      contract: process.env.LEASER_ADDRESS as string,
      sender: authority,
    });

    msg.value.messages[0] = Any.fromPartial({
      typeUrl: '/cosmwasm.wasm.v1.MsgClearAdmin',
      value: Uint8Array.from(MsgClearAdmin.encode(clearAdminMsg).finish()),
    });
  });

  // TO DO when MsgPinCodes
  // test('validator should be able to submit a PinCodes proposal', async () => {
  //   const pinCodesMsg = MsgPinCodes.fromPartial({
  //     authority: authority,
  //     code_ids: [1],
  //   });

  //   msg.value.messages[0] = MsgPinCodes.fromPartial({
  //     typeUrl: '/cosmwasm.wasm.v1.MsgPinCodes',
  //     value: Uint8Array.from(MsgPinCodes.encode(pinCodesMsg).finish()),
  //   });
  // });

  // TO DO when MsgUnpinCodes
  // test('validator should be able to submit a UnpinCodes proposal', async () => {
  //   const unpinCodesMsg = MsgUnpinCodes.fromPartial({
  //     authority: authority,
  //     code_ids: [1],
  //   });

  //   msg.value.messages[0] = MsgUnpinCodes.fromPartial({
  //     typeUrl: '/cosmwasm.wasm.v1.UnpinCodesProposal',
  //     value: Uint8Array.from(MsgUnpinCodes.encode(pinCodesMsg).finish()),
  //   });
  // });
});
