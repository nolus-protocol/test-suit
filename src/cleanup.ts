// Registered as jest `setupFilesAfterEnv`, so this `afterAll` runs once per test file, after that
// file's own hooks.

import { closeSync, fchmodSync, mkdirSync, openSync, writeSync } from 'fs';
import { join, relative } from 'path';

import { NolusClient } from './util/nolus';

import { DisposableWallet, takeDisposableWallets } from './util/clients';
import { allBalances, returnAllFundsToMainAccount } from './util/transfer';
import { Leaser } from './util/contracts';

interface UnsweptWallet {
  address: string;
  mnemonic: string;
  balances: string;
  error: string;
}

interface RetainedWallet {
  address: string;
  mnemonic: string;
  leases: string[];
  reason: string;
}

function existingClient(): NolusClient | undefined {
  try {
    return NolusClient.getInstance();
  } catch {
    return undefined;
  }
}

async function leasesOwnedBy(
  wallets: DisposableWallet[],
): Promise<RetainedWallet[]> {
  const leaserAddress = process.env.LEASER_ADDRESS?.trim();
  const retained: RetainedWallet[] = [];
  const client = existingClient();

  if (
    leaserAddress === undefined ||
    leaserAddress === '' ||
    client === undefined
  ) {
    return retained;
  }

  const cosm = await client.getCosmWasmClient();
  const leaser = new Leaser(cosm, leaserAddress);

  for (const { wallet, mnemonic } of wallets) {
    const address = wallet.address as string;

    try {
      const leases = await leaser.getCurrentOpenLeasesByOwner(address);

      if (leases.length > 0) {
        retained.push({
          address,
          mnemonic,
          leases,
          reason: `owns ${leases.length} lease(s) that may still pay out to it`,
        });
      }
    } catch (error) {
      retained.push({
        address,
        mnemonic,
        leases: [],
        reason:
          `the lease query failed, so it is unknown whether this wallet owns a lease: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  return retained;
}

function recordWallets(
  prefix: string,
  wallets: UnsweptWallet[] | RetainedWallet[],
  testPath: string,
): string {
  const runId = process.env.RUN_ID || `manual-${Date.now()}`;

  if (!/^[A-Za-z0-9._-]+$/.test(runId) || runId === '.' || runId === '..') {
    throw new Error(
      `RUN_ID='${runId}' is used as a directory name; use only letters, digits, . _ or - ` +
        `(and not '.' or '..').`,
    );
  }

  const directory = join(process.cwd(), '.runs', runId);

  mkdirSync(directory, { recursive: true, mode: 0o700 });

  const suite = relative(process.cwd(), testPath).replace(
    /[^A-Za-z0-9._-]/g,
    '-',
  );
  const file = join(directory, `${prefix}-${suite}.json`);
  const record = {
    recordedAt: new Date().toISOString(),
    testPath,
    wallets,
  };

  const fd = openSync(file, 'w', 0o600);

  try {
    fchmodSync(fd, 0o600);
    writeSync(fd, `${JSON.stringify(record, null, 2)}\n`);
  } finally {
    closeSync(fd);
  }

  return file;
}

function reportRetained(retained: RetainedWallet[], testPath: string): void {
  if (retained.length === 0) {
    return;
  }

  const detail = retained.map((w) => `${w.address}: ${w.reason}`).join('\n  ');

  if (process.env.GITHUB_ACTIONS === 'true') {
    console.log(
      `${retained.length} throwaway wallet(s) still own leases. Mnemonics are deliberately NOT ` +
        `recorded under CI — the run artefacts are uploaded and would publish them — so whatever ` +
        `these leases pay out is lost:\n  ${detail}`,
    );

    return;
  }

  const file = recordWallets('retained-wallets', retained, testPath);

  console.log(
    `${retained.length} throwaway wallet(s) still own leases; their mnemonics were kept in ` +
      `${file} so the eventual payout is recoverable. Delete it once the leases have settled and ` +
      `the funds are back. It is git-ignored; do not commit or share it.\n  ${detail}`,
  );
}

afterAll(async () => {
  const wallets = takeDisposableWallets();

  if (wallets.length === 0) {
    return;
  }

  console.log(`Returning funds from ${wallets.length} throwaway wallet(s)...`);
  const unswept: UnsweptWallet[] = [];

  for (const { wallet, mnemonic } of wallets) {
    try {
      await returnAllFundsToMainAccount(wallet);
    } catch (error) {
      const address = wallet.address as string;
      let balances: string;

      try {
        balances = (await allBalances(address))
          .map((coin) => `${coin.amount}${coin.denom}`)
          .join(', ');
      } catch {
        balances = 'unknown — the balance query failed too';
      }

      if (balances === '') {
        console.warn(
          `Could not sweep ${address}, but the chain reports it empty, so nothing was lost: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );

        continue;
      }

      unswept.push({
        address,
        mnemonic,
        balances,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const testPath = expect.getState().testPath ?? 'unknown';

  try {
    const swept = wallets.filter(
      ({ wallet }) =>
        !unswept.some((failed) => failed.address === wallet.address),
    );

    reportRetained(await leasesOwnedBy(swept), testPath);
  } catch (error) {
    console.log(
      `Could not establish whether any throwaway wallet still owns a lease ` +
        `(${error instanceof Error ? error.message : String(error)}). If one does, its payout ` +
        `is not recoverable.`,
    );
  }

  if (unswept.length === 0) {
    return;
  }

  const detail = unswept
    .map((w) => `${w.address} [${w.balances}]: ${w.error}`)
    .join('\n  ');

  if (process.env.GITHUB_ACTIONS === 'true') {
    throw new Error(
      `Failed to return funds from ${unswept.length} of ${wallets.length} throwaway wallet(s). ` +
        `Mnemonics are deliberately NOT recorded under CI — the run artefacts are uploaded and ` +
        `would publish them. These balances are lost:\n  ${detail}`,
    );
  }

  let file: string;

  try {
    file = recordWallets('unswept-wallets', unswept, testPath);
  } catch (error) {
    throw new Error(
      `Failed to return funds from ${unswept.length} of ${wallets.length} throwaway wallet(s), ` +
        `AND the mnemonics could not be written: ` +
        `${error instanceof Error ? error.message : String(error)}. ` +
        `These balances are unrecoverable:\n  ${detail}`,
    );
  }

  throw new Error(
    `Failed to return funds from ${unswept.length} of ${wallets.length} throwaway wallet(s).\n` +
      `Their mnemonics were written to ${file} — import them to recover the balances, delete the ` +
      `file, and do not reuse the wallets. It is git-ignored; do not commit or share it.\n  ` +
      detail,
  );
});
