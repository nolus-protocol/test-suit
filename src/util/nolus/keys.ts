import {
  Bip39,
  EnglishMnemonic,
  Random,
  Slip10,
  Slip10Curve,
} from '@cosmjs/crypto';
import { HdPath } from '@cosmjs/crypto';

export function generateMnemonic(): string {
  return Bip39.encode(Random.getBytes(32)).toString();
}

export async function getPrivateKeyFromMnemonic(
  mnemonic: string,
  hdPath: HdPath,
): Promise<Uint8Array> {
  const seed = await Bip39.mnemonicToSeed(new EnglishMnemonic(mnemonic));

  return Slip10.derivePath(Slip10Curve.Secp256k1, seed, hdPath).privkey;
}
