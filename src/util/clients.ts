
import {DirectSecp256k1Wallet} from "@cosmjs/proto-signing";
import {fromHex} from "@cosmjs/encoding";

let user1PrivKey = fromHex(process.env.USER_1_PRIV_KEY as string);

export const NOLUS_PREFIX = "nolus";

export async function getWallet(privateKey: Uint8Array): Promise<DirectSecp256k1Wallet> {
    return await DirectSecp256k1Wallet.fromKey(privateKey, NOLUS_PREFIX);
}

export async function getUser1Wallet(): Promise<DirectSecp256k1Wallet> {
    return await getWallet(user1PrivKey);
}

