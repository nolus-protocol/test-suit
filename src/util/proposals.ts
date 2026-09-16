import { Any } from 'cosmjs-types/google/protobuf/any';
import { DeliverTxResponse } from '@cosmjs/cosmwasm-stargate';
import { toUtf8 } from '@cosmjs/encoding';
import { NolusWallet } from '@nolus/nolusjs';
import { NATIVE_MINIMAL_DENOM, customFees, MIN_DEPOSIT_AMOUNT } from './utils';
import { MsgSudoContract } from './codec/cosmos/msgSudoContract/tx';
import { getUser1Wallet } from './clients';
import { MsgSubmitPropWValidation } from './codec/cosmos/msgSubmitPropWValidation/tx';


const PROPOSAL_MARKER = 'TEST TEST_SUIT proposal';

export async function sendSudoContractProposal(
  wallet: NolusWallet,
  contract: string,
  message: string,
): Promise<DeliverTxResponse> {
  const authority = process.env.GOV_MODULE_ADDRESS as string;
  const msgSudoContractUrl = '/cosmwasm.wasm.v1.MsgSudoContract';
  const msgSubmitPropWValidationUrl = '/cosmos.gov.v1.MsgSubmitPropWValidation';

  const userWithBalanceWallet = await getUser1Wallet();

  const deposit = { denom: NATIVE_MINIMAL_DENOM, amount: MIN_DEPOSIT_AMOUNT };

  await userWithBalanceWallet.transferAmount(
    wallet.address as string,
    [deposit],
    customFees.transfer,
  );

  // TO DO: Update when cosmjs-types: MsgSudoContract
  wallet.registry.register(msgSudoContractUrl, MsgSudoContract);

  wallet.registry.register(
    msgSubmitPropWValidationUrl,
    MsgSubmitPropWValidation,
  );

  const sudoContractMsg = MsgSudoContract.fromPartial({
    authority: authority,
    contract: contract,
    msg: toUtf8(message),
  });

  const sudoProposal = {
    typeUrl: msgSubmitPropWValidationUrl,
    value: {
      messages: [
        Any.fromPartial({
          typeUrl: msgSudoContractUrl,
          value: Uint8Array.from(
            MsgSudoContract.encode(sudoContractMsg).finish(),
          ),
        }),
      ],
      metadata: '',
      proposer: wallet.address as string,
      summary: PROPOSAL_MARKER,
      title: PROPOSAL_MARKER,
      initialDeposit: [deposit],
    },
  };

  const broadcastTx = await wallet.signAndBroadcast(
    wallet.address as string,
    [sudoProposal],
    customFees.configs,
  );

  return broadcastTx;
}
