import { CosmWasmClient } from "@cosmjs/cosmwasm-stargate";

test('the blockchain should be running', async () => {
    const client = await CosmWasmClient.connect(process.env.NODE_URL as string);
    const chainId = await client.getChainId();
    const height = await client.getHeight();

    expect(chainId).toBeDefined();
    expect(height).toBeGreaterThan(0);
});
