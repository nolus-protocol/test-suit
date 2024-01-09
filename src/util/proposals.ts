import { Tendermint34Client } from '@cosmjs/tendermint-rpc';
import { QueryProposalResponse } from 'cosmjs-types/cosmos/gov/v1beta1/query';
import { Any } from 'cosmjs-types/google/protobuf/any';
import { QueryClient, setupGovExtension, GovExtension } from '@cosmjs/stargate';
import { DeliverTxResponse } from '@cosmjs/cosmwasm-stargate';
import { toUtf8 } from '@cosmjs/encoding';
import { NolusWallet } from '@nolus/nolusjs';
import { NATIVE_MINIMAL_DENOM, customFees, MIN_DEPOSIT_AMOUNT } from './utils';
import { MsgSudoContract } from './codec/cosmos/msgSudoContract/tx';
import { getUser1Wallet } from './clients';
import { MsgSubmitProposalCheck } from './codec/cosmos/msgSubmitProposalCheck/tx';

const NODE_ENDPOINT = process.env.NODE_URL as string;
let queryClient: QueryClient & GovExtension;

async function loadClient() {
  const tendermintClient = await Tendermint34Client.connect(NODE_ENDPOINT);
  queryClient = QueryClient.withExtensions(tendermintClient, setupGovExtension);
}

export async function getProposal(id: number): Promise<QueryProposalResponse> {
  await loadClient();

  return await queryClient.gov.proposal(id);
}

export async function sendSudoContractProposal(
  wallet: NolusWallet,
  contract: string,
  message: string,
): Promise<DeliverTxResponse> {
  const authority = process.env.GOV_MODULE_ADDRESS as string;
  const msgSudoContractUrl = '/cosmwasm.wasm.v1.MsgSudoContract';
  const msgSubmitProposalCheckUrl = '/cosmos.gov.v1.MsgSubmitProposalCheck';

  const userWithBalanceWallet = await getUser1Wallet();

  const deposit = { denom: NATIVE_MINIMAL_DENOM, amount: MIN_DEPOSIT_AMOUNT };

  await userWithBalanceWallet.transferAmount(
    wallet.address as string,
    [deposit],
    customFees.transfer,
  );

  // TO DO: Update when cosmjs-types: MsgSudoContract
  wallet.registry.register(msgSudoContractUrl, MsgSudoContract);

  wallet.registry.register(msgSubmitProposalCheckUrl, MsgSubmitProposalCheck);

  const sudoContractMsg = MsgSudoContract.fromPartial({
    authority: authority,
    contract: contract,
    msg: toUtf8(message),
  });

  const sudoProposal = {
    typeUrl: msgSubmitProposalCheckUrl,
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
      summary:
        'This proposal proposes to test whether this SudoContract proposal passes',
      title: 'Test Proposal',
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
