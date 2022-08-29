import { Tendermint34Client } from '@cosmjs/tendermint-rpc';
import { QueryProposalResponse } from 'cosmjs-types/cosmos/gov/v1beta1/query';
import { QueryClient, setupGovExtension, GovExtension } from '@cosmjs/stargate';

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
