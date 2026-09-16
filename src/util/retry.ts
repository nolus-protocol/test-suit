// The public rila endpoint drops requests intermittently under a run's access pattern: a lease
// opens, the suite polls its state every few seconds for minutes, and somewhere in there `fetch`
// rejects with `TypeError: fetch failed` and an empty `AggregateError` cause — every address of
// the host refused or timed out. Nothing in cosmjs retries, so one blip fails the case that is
// polling, every case after it, and the sweep, leaving leases half-open and wallets funded.
//
// Only a rejection is retried, never an HTTP status: a 4xx/5xx means the node answered and cosmjs
// has to see it. A rejection means no response was received at all, so re-sending cannot apply a
// transaction twice — the bytes are already signed, so the duplicate carries the same hash and the
// chain rejects the second copy.
//
// One accepted risk, in the narrow case where the first broadcast reached the node and only its
// response was lost: the retry then gets "tx already exists in cache" and cosmjs throws, so a
// transaction that *did* apply is reported as failed. The state is real and the sequence number
// self-heals — cosmjs re-queries it per signature — so the cost is one spuriously failed case,
// not a cascade. That is a better trade than letting every blip fail the case outright.

import { setDefaultResultOrder } from 'dns';
import { setDefaultAutoSelectFamilyAttemptTimeout } from 'net';
import { NolusClient } from '@nolus/nolusjs';

// The blips above are mostly self-inflicted, and this is the cure rather than the dressing. The
// endpoint resolves to two IPv4 and two IPv6 Cloudflare addresses; a machine with no IPv6 route
// gets `ENETUNREACH` on half of them. Node then races the rest under `autoSelectFamily`, whose
// per-attempt budget is 250ms by default — so a working address that connects in 30ms is still
// abandoned whenever the process is busy, and the whole request fails with every address
// "unreachable or timed out". Putting IPv4 first drops the unroutable family from the front, and
// a budget in seconds stops a healthy address being given up on.
const CONNECT_ATTEMPT_TIMEOUT_MS = 5000;

// Sized to ride out a minute or so of the endpoint refusing connections, which is what an
// observed outage looks like: each attempt already absorbs undici's own connect timeout before
// the backoff starts, so seven attempts span comfortably more than the gaps seen in practice.
const ATTEMPTS = 7;
const FIRST_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 5000;

type Fetch = typeof globalThis.fetch;

// Narrow deliberately: `fetch` also throws a `TypeError` for a malformed URL or an illegal
// header, and retrying one of those seven times only delays a programming error by the whole
// backoff before rethrowing it unchanged. Only the transport failure carries this message.
function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError && error.message === 'fetch failed';
}

// An abort is the caller's own decision, so it must surface on the first try rather than being
// retried until the attempts run out.
function isAborted(init: RequestInit | undefined): boolean {
  return init?.signal?.aborted === true;
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function withNetworkRetry(inner: Fetch): Fetch {
  return async function retryingFetch(input, init) {
    let lastError: unknown;

    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        return await inner(input, init);
      } catch (error) {
        if (!isNetworkFailure(error) || isAborted(init)) {
          throw error;
        }

        lastError = error;

        if (attempt < ATTEMPTS) {
          await wait(
            Math.min(FIRST_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS),
          );
        }
      }
    }

    throw lastError;
  };
}

// `new NolusClient()` eagerly starts three connections in its constructor and parks the promises
// in fields — `cosmWasmClient`, `tmClient`, `stargateClient`. Almost every suite awaits only the
// first. So when the network hiccups, the other two reject with nobody attached, Node treats that
// as an unhandled rejection and kills the process outright: no jest summary, no sweep, and the
// throwaway wallets keep their funds. Attaching a no-op catch marks them observed without
// consuming them — a real awaiter still gets the rejection, at the point where it can be handled.
interface EagerClientPromises {
  cosmWasmClient?: Promise<unknown>;
  tmClient?: Promise<unknown>;
  stargateClient?: Promise<unknown>;
}

function observeEagerPromises(): void {
  const setInstance = NolusClient.setInstance.bind(NolusClient);

  NolusClient.setInstance = (tendermintRpc: string) => {
    setInstance(tendermintRpc);

    const instance =
      NolusClient.getInstance() as unknown as EagerClientPromises;

    instance.cosmWasmClient?.catch(() => undefined);
    instance.tmClient?.catch(() => undefined);
    instance.stargateClient?.catch(() => undefined);
  };
}

// Jest hands each test file a fresh module registry and global, so this normally runs once per
// file. The guard is for anything that loads it twice within one: wrapping the wrapper would nest
// the retries into 49 attempts and minutes of backoff, and re-patch the already-patched
// `setInstance`.
let installed = false;

export function installNetworkResilience(): void {
  if (installed) {
    return;
  }

  installed = true;

  setDefaultResultOrder('ipv4first');
  setDefaultAutoSelectFamilyAttemptTimeout(CONNECT_ATTEMPT_TIMEOUT_MS);

  globalThis.fetch = withNetworkRetry(globalThis.fetch);
  observeEagerPromises();
}
