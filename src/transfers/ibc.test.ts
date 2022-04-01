import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { assertIsDeliverTxSuccess, DeliverTxResponse } from "@cosmjs/stargate";
import { getUser1Client, getUser1Wallet, getUser2Wallet, getUser2Client } from "../util/clients";

describe("IBC transfer", () => {
    const NATIVE_TOKEN = "unolus";
    let ibcToken = process.env.IBC_TOKEN as string;

    test("users should be able to transfer ibc tokens", async () => {
        const user1Client: SigningCosmWasmClient = await getUser1Client();
        const [user1Account] = await (await getUser1Wallet()).getAccounts();
        const user2Client: SigningCosmWasmClient = await getUser2Client();
        const [user2Account] = await (await getUser2Wallet()).getAccounts();
        const transfer = {
            denom: ibcToken,
            amount: "1000",
        };
        const fee = {
            amount: [{denom: NATIVE_TOKEN, amount: "12"}],
            gas: "100000"
        };

        let initialUser1Balance = await user1Client.getBalance(user1Account.address, ibcToken);
        let initialUser2Balance = await user2Client.getBalance(user2Account.address, ibcToken);
        console.log("User 1 before balance:", initialUser1Balance);
        console.log("User 2 before balance:", initialUser2Balance);

        expect(ibcToken).toBeDefined();
        expect(ibcToken.length > 0).toBeTruthy();
        expect(BigInt(initialUser1Balance.amount) > 0).toBeTruthy();

        let sendTokensResponse: DeliverTxResponse = await user1Client.sendTokens(user1Account.address, user2Account.address, [transfer], fee, "Testing send transaction");
        assertIsDeliverTxSuccess(sendTokensResponse);
        let nextUser1Balance = await (user1Client.getBalance(user1Account.address, ibcToken));
        let nextUser2Balance = await (user2Client.getBalance(user2Account.address, ibcToken))
        console.log("User 1 after balance:", nextUser1Balance);
        console.log("User 2 after balance:", nextUser2Balance);

        expect(BigInt(nextUser1Balance.amount)).toBe(BigInt(initialUser1Balance.amount) - BigInt(transfer.amount));
        expect(BigInt(nextUser2Balance.amount)).toBe(BigInt(initialUser2Balance.amount) + BigInt(transfer.amount));
    });
});
