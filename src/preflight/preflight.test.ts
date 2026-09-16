import { CosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { connectComet } from '@cosmjs/tendermint-rpc';
import { QueryClient, setupIbcExtension } from '@cosmjs/stargate';
import { NolusClient } from '@nolus/nolusjs';
import NODE_ENDPOINT, { getUser1Wallet } from '../util/clients';
import { NATIVE_MINIMAL_DENOM } from '../util/utils';
import { getLeaseGroupCurrencies } from '../util/smart-contracts/getters';
import { Oracle } from '../util/contracts';

function configured(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

describe('preflight', () => {
  let cosm: CosmWasmClient;
  let oracleInstance: Oracle;
  let customerAddress: string;

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    cosm = await NolusClient.getInstance().getCosmWasmClient();

    oracleInstance = new Oracle(cosm, process.env.ORACLE_ADDRESS as string);

    customerAddress = (await getUser1Wallet()).address as string;
  });

  test('every lease currency has a price', async () => {
    const leaseCurrencies = await getLeaseGroupCurrencies(oracleInstance);
    const { prices } = await oracleInstance.getPrices();
    const priced = prices.map(({ amount }) => amount.ticker);

    expect(leaseCurrencies.length).toBeGreaterThan(0);
    expect(priced.length).toBeGreaterThan(0);

    const unpriced = leaseCurrencies.filter(
      (ticker) => !priced.includes(ticker),
    );

    expect(unpriced).toStrictEqual([]);
  });

  test('no packet is in flight on the channels we use', async () => {
    const channels = [
      {
        label: 'ICS20_CHANNEL_LOCAL',
        port: 'transfer',
        channel: configured(process.env.ICS20_CHANNEL_LOCAL),
      },
      {
        // The port is wasm.<controller>, not transfer.
        label: 'LEASE_CHANNEL',
        port:
          configured(process.env.REMOTE_LEASE_CONTROLLER) === undefined
            ? undefined
            : `wasm.${process.env.REMOTE_LEASE_CONTROLLER}`,
        channel: configured(process.env.LEASE_CHANNEL),
      },
    ];

    const configuredChannels = channels.filter(
      ({ port, channel }) => port !== undefined && channel !== undefined,
    );

    if (configuredChannels.length !== channels.length) {
      throw new Error(
        'ICS20_CHANNEL_LOCAL, LEASE_CHANNEL or REMOTE_LEASE_CONTROLLER is missing, so the ' +
          'in-flight check cannot run.',
      );
    }

    const cometClient = await connectComet(NODE_ENDPOINT);
    const queryClient = QueryClient.withExtensions(
      cometClient,
      setupIbcExtension,
    );

    const inFlight = [];

    for (const { label, port, channel } of configuredChannels) {
      const commitments = await queryClient.ibc.channel.packetCommitments(
        port as string,
        channel as string,
      );

      if (commitments.commitments.length > 0) {
        inFlight.push(`${label} (${port}/${channel})`);
      }
    }

    cometClient.disconnect();

    expect(inFlight).toStrictEqual([]);
  });

  test('the main account holds native currency for its fees', async () => {
    const unls = BigInt(
      (await cosm.getBalance(customerAddress, NATIVE_MINIMAL_DENOM)).amount,
    );

    expect(
      unls > 0n ? [] : [`${customerAddress} holds no ${NATIVE_MINIMAL_DENOM}`],
    ).toStrictEqual([]);
  });

  test('the customer is the account the env file names', () => {
    expect(customerAddress).toMatch(/^nolus1[0-9a-z]{38}$/);
  });
});
