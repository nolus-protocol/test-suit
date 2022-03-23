import {CosmWasmClient, SigningCosmWasmClient} from "@cosmjs/cosmwasm-stargate";
import {assertIsDeliverTxSuccess, Coin, DeliverTxResponse} from "@cosmjs/stargate";
import { getValidatorWallet } from "../utils/index";

describe("firs test", () => {
    test("first test", async () => {
        const client: CosmWasmClient = await CosmWasmClient.connect(process.env.NODE_URL as string);
        const [validatorAccount] = await (await getValidatorWallet()).getAccounts()
        const balance: Coin = await client.getBalance(validatorAccount.address, "unolus");
        console.log(`Validator balance=(${balance.denom}, ${balance.amount})`);

        expect(BigInt(balance.amount) > 0).toBeTruthy();
    });

});
