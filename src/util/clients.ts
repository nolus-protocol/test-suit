import { makeCosmoshubPath } from '@cosmjs/amino';
import { DirectSecp256k1Wallet } from '@cosmjs/proto-signing';
import { fromHex } from '@cosmjs/encoding';
import { GeneratedType } from '@cosmjs/proto-signing/build/registry';
import {
  BECH32_PREFIX_ACC_ADDR,
  generateMnemonic,
  getPrivateKeyFromMnemonic,
  NolusClient,
  NolusWallet,
  nolusOfflineSigner,
} from './nolus';

const user1PrivKey = fromHex(process.env.USER_1_PRIV_KEY as string);
const user2PrivKey = fromHex(process.env.USER_2_PRIV_KEY as string);
const user3PrivKey = fromHex(process.env.USER_3_PRIV_KEY as string);

const NODE_ENDPOINT = process.env.NODE_URL as string;
export default NODE_ENDPOINT;

export async function getWallet(privateKey: Uint8Array): Promise<NolusWallet> {
  const offlineSigner = await DirectSecp256k1Wallet.fromKey(
    privateKey,
    BECH32_PREFIX_ACC_ADDR,
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

export async function getLeaseAdminWallet(): Promise<NolusWallet> {
  const privKey = process.env.LEASE_ADMIN_PRIV_KEY?.trim();

  if (privKey === undefined || privKey === '') {
    throw new Error(
      'LEASE_ADMIN_PRIV_KEY is not set. Gate lease-admin cases behind withLeaseAdmin / ' +
        'withLeaseAdminTest so they skip where the key is absent.',
    );
  }

  return await getWallet(fromHex(privKey));
}

export interface DisposableWallet {
  wallet: NolusWallet;
  // Held only so `src/cleanup.ts` can write it out for the handful of wallets it fails to empty.
  mnemonic: string;
}

const disposableWallets: DisposableWallet[] = [];

export async function createWallet(): Promise<NolusWallet> {
  const mnemonic = generateMnemonic();
  const accountNumbers = [0];
  const path = accountNumbers.map(makeCosmoshubPath)[0];
  const privateKey = await getPrivateKeyFromMnemonic(mnemonic, path);

  const wallet = await getWallet(privateKey);
  disposableWallets.push({ wallet, mnemonic });

  return wallet;
}

export function takeDisposableWallets(): DisposableWallet[] {
  return disposableWallets.splice(0, disposableWallets.length);
}

export async function txSearchByEvents(
  events: string,
  page: number | undefined,
  perPage: number | undefined,
) {
  const cometClient = await NolusClient.getInstance().getTendermintClient();

  return await cometClient.txSearch({
    query: events,
    prove: undefined,
    page: page,
    per_page: perPage,
  });
}

export function registerNewType(
  client: NolusWallet,
  type: string,
  msg: GeneratedType,
) {
  client.registry.register(type, msg);
}
