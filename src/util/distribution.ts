import { Tendermint34Client } from '@cosmjs/tendermint-rpc';
import {
  QueryDelegationRewardsResponse,
  QueryDelegatorWithdrawAddressResponse,
} from 'cosmjs-types/cosmos/distribution/v1beta1/query';
import {
  QueryClient,
  setupDistributionExtension,
  DistributionExtension,
} from '@cosmjs/stargate';

const NODE_ENDPOINT = process.env.NODE_URL as string;
let queryClient: QueryClient & DistributionExtension;

async function loadClient() {
  const tendermintClient = await Tendermint34Client.connect(NODE_ENDPOINT);
  queryClient = QueryClient.withExtensions(
    tendermintClient,
    setupDistributionExtension,
  );
}

export async function getDelegatorWithdrawAddress(
  delegatorAddress: string,
): Promise<QueryDelegatorWithdrawAddressResponse> {
  await loadClient();
  return await queryClient.distribution.delegatorWithdrawAddress(
    delegatorAddress,
  );
}

export async function getDelegatorRewardsFromValidator(
  delegatorAddress: string,
  valAddress: string,
): Promise<QueryDelegationRewardsResponse> {
  await loadClient();
  return await queryClient.distribution.delegationRewards(
    delegatorAddress,
    valAddress,
  );
}
