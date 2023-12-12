import { Tendermint34Client } from '@cosmjs/tendermint-rpc';
import { QueryProposalResponse } from 'cosmjs-types/cosmos/gov/v1beta1/query';
import { SudoContractProposal } from 'cosmjs-types/cosmwasm/wasm/v1/proposal';
import { QueryClient, setupGovExtension, GovExtension } from '@cosmjs/stargate';
import { DeliverTxResponse } from '@cosmjs/cosmwasm-stargate';
import { toUtf8 } from '@cosmjs/encoding';
import { NolusWallet } from '@nolus/nolusjs';
import { customFees } from './utils';

const NODE_ENDPOINT = process.env.NODE_URL as string;
let queryClient: QueryClient & GovExtension;
export const distributionModule = '/cosmos.distribution.v1beta1';

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
  const msg = {
    typeUrl: '/cosmos.gov.v1beta1.MsgSubmitProposal',
    value: {
      content: {
        typeUrl: '/cosmwasm.wasm.v1.SudoContractProposal',
        value: SudoContractProposal.encode({
          description:
            'This proposal proposes to test whether this proposal passes',
          title: 'Test Proposal',
          contract: contract,
          msg: toUtf8(message),
        }).finish(),
      },
      proposer: wallet.address as string,
    },
  };

  const broadcastTx = await wallet.signAndBroadcast(
    wallet.address as string,
    [msg],
    customFees.configs,
  );

  return broadcastTx;
}
