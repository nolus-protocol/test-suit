import { CosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { Coin } from "@cosmjs/stargate";
import { getUser1Wallet } from "../util/clients";

describe("firs test", () => {
    test("first test", async () => {
        const client: CosmWasmClient = await CosmWasmClient.connect(process.env.NODE_URL as string);
        const [userAccount] = await (await getUser1Wallet()).getAccounts()
        const balance: Coin = await client.getBalance(userAccount.address, "unolus");
        console.log(`User balance=(${balance.denom}, ${balance.amount})`);

        expect(BigInt(balance.amount) > 0).toBeTruthy();
    });

});
