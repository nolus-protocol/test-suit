import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { env } from 'node:process';
import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';

const SPL_TOKEN_PROGRAMS = [
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
];
const RPC_METHOD = 'getMultipleAccounts';
const RPC_COMMITMENT = 'finalized';
const RPC_ENCODING = 'base64';
const PROGRAM_SEED = 'pr';
const CHANNEL_SEED = 'ch';
const ESCROW_SEED = 'es';
const PDA_MARKER = 'ProgramDerivedAddress';
const PUBKEY_BYTES = 32;
const MAX_BUMP = 255;
const MIN_BUMP = 0;
const U16_BYTES = 2;
const MAX_CHANNEL_ORDINAL = 0xffff;
// The solray program is itself the PDA tree's first id, at ordinal 0.
const PROGRAM_ORDINAL = 0;

function requiredEnv(name: string): string {
  const value = env[name]?.trim();

  if (value === undefined || value === '') {
    throw new Error(
      `${name} is not set, so solray registration cannot be checked. Re-run 'yarn prepare-env'.`,
    );
  }

  return value;
}

function u16be(value: number): Buffer {
  const bytes = Buffer.alloc(U16_BYTES);
  bytes.writeUInt16BE(value);

  return bytes;
}

function channelOrdinal(): number {
  const raw = requiredEnv('SOLANA_CHANNEL_ORDINAL');
  const ordinal = Number(raw);

  if (!/^\d+$/.test(raw) || ordinal > MAX_CHANNEL_ORDINAL) {
    throw new Error(`SOLANA_CHANNEL_ORDINAL '${raw}' is not a u16.`);
  }

  return ordinal;
}

function decodePubkey(label: string, address: string): Uint8Array {
  let bytes: Uint8Array;

  try {
    bytes = bs58.decode(address);
  } catch (error: unknown) {
    throw new Error(
      `${label} '${address}' is not base58: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (bytes.length !== PUBKEY_BYTES) {
    throw new Error(`${label} '${address}' is not a 32-byte Solana address.`);
  }

  return bytes;
}

// A point on the curve cannot be a PDA.
function isOnCurve(candidate: Uint8Array): boolean {
  try {
    ed25519.ExtendedPoint.fromHex(candidate);
    return true;
  } catch {
    return false;
  }
}

function escrowAddress({
  programId,
  channel,
  mint,
}: {
  programId: Uint8Array;
  channel: number;
  mint: Uint8Array;
}): string {
  for (let bump = MAX_BUMP; bump >= MIN_BUMP; bump--) {
    const candidate = createHash('sha256')
      .update(PROGRAM_SEED)
      .update(u16be(PROGRAM_ORDINAL))
      .update(CHANNEL_SEED)
      .update(u16be(channel))
      .update(ESCROW_SEED)
      .update(mint)
      .update(Uint8Array.of(bump))
      .update(programId)
      .update(PDA_MARKER)
      .digest();

    if (!isOnCurve(candidate)) {
      return bs58.encode(candidate);
    }
  }

  throw new Error(`No escrow address exists for mint ${bs58.encode(mint)}.`);
}

function malformed(detail: string): Error {
  return new Error(`SOLANA_RPC_URL answered a malformed response: ${detail}.`);
}

function accountOwners(body: unknown, expected: number): (string | null)[] {
  if (typeof body !== 'object' || body === null) {
    throw malformed('not a JSON object');
  }

  if ('error' in body) {
    throw new Error(
      `SOLANA_RPC_URL answered ${RPC_METHOD} with an error: ${JSON.stringify(body.error)}`,
    );
  }

  const value =
    'result' in body &&
    typeof body.result === 'object' &&
    body.result !== null &&
    'value' in body.result
      ? body.result.value
      : undefined;

  if (!Array.isArray(value) || value.length !== expected) {
    throw malformed(`expected ${expected} accounts in result.value`);
  }

  return value.map((account: unknown) => {
    if (account === null) {
      return null;
    }

    if (
      typeof account === 'object' &&
      'owner' in account &&
      typeof account.owner === 'string'
    ) {
      return account.owner;
    }

    throw malformed('an account without a string owner');
  });
}

/**
 * The subset of `mints` registered on the solray instance named by `SOLRAY_PROGRAM_ID`: those whose
 * escrow on channel `SOLANA_CHANNEL_ORDINAL` exists and is an SPL token or Token-2022 account.
 * Throws on missing settings, an RPC failure or a malformed answer — never guesses either way.
 */
export async function registeredMints(mints: string[]): Promise<Set<string>> {
  const rpcUrl = requiredEnv('SOLANA_RPC_URL');
  const programId = decodePubkey(
    'SOLRAY_PROGRAM_ID',
    requiredEnv('SOLRAY_PROGRAM_ID'),
  );
  const channel = channelOrdinal();

  const escrows = mints.map((mint) =>
    escrowAddress({ programId, channel, mint: decodePubkey('mint', mint) }),
  );

  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: RPC_METHOD,
      params: [escrows, { commitment: RPC_COMMITMENT, encoding: RPC_ENCODING }],
    }),
  });

  if (!response.ok) {
    throw new Error(
      `SOLANA_RPC_URL answered ${RPC_METHOD} with HTTP ${response.status} ${response.statusText}.`,
    );
  }

  const owners = accountOwners(await response.json(), escrows.length);

  return new Set(
    mints.filter((_, index) => {
      const owner = owners[index];

      return owner !== null && SPL_TOKEN_PROGRAMS.includes(owner);
    }),
  );
}
