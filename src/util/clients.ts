import { makeCosmoshubPath } from '@cosmjs/amino';
import { DirectSecp256k1Wallet } from '@cosmjs/proto-signing';
import { fromHex } from '@cosmjs/encoding';
import { TxSearchResponse } from '@cosmjs/tendermint-rpc';
import {
  ChainConstants,
  KeyUtils,
  NolusClient,
  NolusWallet,
} from '@nolus/nolusjs';
import { nolusOfflineSigner } from '@nolus/nolusjs/build/wallet/NolusWalletFactory';

const user1PrivKey = fromHex(process.env.USER_1_PRIV_KEY as string);
const user2PrivKey = fromHex(process.env.USER_2_PRIV_KEY as string);
const user3PrivKey = fromHex(process.env.USER_3_PRIV_KEY as string);
const feederPrivKey = fromHex(process.env.FEEDER_PRIV_KEY as string);

const NODE_ENDPOINT = process.env.NODE_URL as string;
export default NODE_ENDPOINT;

export async function getWallet(privateKey: Uint8Array): Promise<NolusWallet> {
  const offlineSigner = await DirectSecp256k1Wallet.fromKey(
    privateKey,
    ChainConstants.BECH32_PREFIX_ACC_ADDR,
  );
  const nolusWallet = await nolusOfflineSigner(offlineSigner);
  nolusWallet.useAccount();
  return nolusWallet;
}

export function getValidator1Address(): string {
  return process.env.VALIDATOR_1_ADDRESS as string;
}

export function getValidator2Address(): string {
  return process.env.VALIDATOR_2_ADDRESS as string;
}

export async function getUser1Wallet(): Promise<NolusWallet> {
  return await getWallet(user1PrivKey);
}

export async function getUser2Wallet(): Promise<NolusWallet> {
  return await getWallet(user2PrivKey);
}

export async function getUser3Wallet(): Promise<NolusWallet> {
  return await getWallet(user3PrivKey);
}

export async function getFeederWallet(): Promise<NolusWallet> {
  return await getWallet(feederPrivKey);
}

export async function createWallet(): Promise<NolusWallet> {
  const mnemonic = KeyUtils.generateMnemonic();
  const accountNumbers = [0];
  const path = accountNumbers.map(makeCosmoshubPath)[0];
  const privateKey = await KeyUtils.getPrivateKeyFromMnemonic(mnemonic, path);

  return getWallet(privateKey);
}

export async function txSearchByEvents(
  events: string,
  page: number | undefined,
  perPage: number | undefined,
): Promise<TxSearchResponse> {
  const tmClient = await NolusClient.getInstance().getTendermintClient();

  return await tmClient?.txSearch({
    query: events,
    prove: undefined,
    page: page,
    per_page: perPage,
  });
}
