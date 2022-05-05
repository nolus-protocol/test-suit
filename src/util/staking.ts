import { Tendermint34Client } from '@cosmjs/tendermint-rpc';
import {
  QueryValidatorResponse,
  QueryDelegatorDelegationsResponse,
  QueryDelegationResponse,
  QueryParamsResponse,
  QueryUnbondingDelegationResponse,
} from 'cosmjs-types/cosmos/staking/v1beta1/query';
import {
  QueryClient,
  setupStakingExtension,
  StakingExtension,
} from '@cosmjs/stargate';

const NODE_ENDPOINT = process.env.DEV_NODE_URL as string;
let queryClient: QueryClient & StakingExtension;

async function loadClient() {
  const tendermintClient = await Tendermint34Client.connect(NODE_ENDPOINT);
  queryClient = QueryClient.withExtensions(
    tendermintClient,
    setupStakingExtension,
  );
}

export async function getValidatorInformation(
  valAddress: string,
): Promise<QueryValidatorResponse> {
  await loadClient();
  return await queryClient.staking.validator(valAddress);
}

export async function getDelegatorInformation(
  delegatorAddress: string,
): Promise<QueryDelegatorDelegationsResponse> {
  await loadClient();
  return await queryClient.staking.delegatorDelegations(delegatorAddress);
}

export async function getDelegatorValidatorPairInformation(
  delegatorAddress: string,
  valAddress: string,
): Promise<QueryDelegationResponse> {
  await loadClient();
  return await queryClient.staking.delegation(delegatorAddress, valAddress);
}

export async function getParamsInformation(): Promise<QueryParamsResponse> {
  await loadClient();
  return await queryClient.staking.params();
}

export async function getDelegatorValidatorUnboundingInformation(
  delegatorAddress: string,
  valAddress: string,
): Promise<QueryUnbondingDelegationResponse> {
  await loadClient();
  return await queryClient.staking.unbondingDelegation(
    delegatorAddress,
    valAddress,
  );
}
