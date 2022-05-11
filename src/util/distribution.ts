import { Tendermint34Client } from '@cosmjs/tendermint-rpc';
import {
  QueryDelegationRewardsResponse,
  QueryDelegatorWithdrawAddressResponse,
  QueryDelegationTotalRewardsResponse,
} from 'cosmjs-types/cosmos/distribution/v1beta1/query';
import {
  QueryClient,
  setupDistributionExtension,
  DistributionExtension,
} from '@cosmjs/stargate';

const NODE_ENDPOINT = process.env.NODE_URL as string;
let queryClient: QueryClient & DistributionExtension;
export const distributionModule = '/cosmos.distribution.v1beta1';

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

export async function getTotalDelegatorRewards(
  delegatorAddress: string,
): Promise<QueryDelegationTotalRewardsResponse> {
  await loadClient();
  return await queryClient.distribution.delegationTotalRewards(
    delegatorAddress,
  );
}
