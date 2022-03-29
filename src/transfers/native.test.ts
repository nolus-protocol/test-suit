import {SigningCosmWasmClient} from "@cosmjs/cosmwasm-stargate";
import {assertIsDeliverTxSuccess, Coin, DeliverTxResponse} from "@cosmjs/stargate";
import { getUser1Wallet, getUser2Wallet, getUser3Wallet, getUser1Client, getUser2Client} from "../util/clients";

describe("Native transfer", () => {
    const NATIVE_TOKEN = "unolus";

    test("account should have some balance", async () => {
        const userClient: SigningCosmWasmClient = await getUser1Client();
        const [userAccount] = await (await getUser1Wallet()).getAccounts();
        const balance: Coin = await userClient.getBalance(userAccount.address, NATIVE_TOKEN);
        console.log(`User balance=(${balance.denom}, ${balance.amount})`);

        expect(BigInt(balance.amount) > 0).toBeTruthy();
    });

    test("users should be able to transfer native tokens", async () => {
        const user1Client: SigningCosmWasmClient = await getUser1Client();
        const user2Client: SigningCosmWasmClient = await getUser2Client();
        const [user1Account] = await (await getUser1Wallet()).getAccounts();
        const [user2Account] = await (await getUser2Wallet()).getAccounts();
        const [user3Account] = await (await getUser3Wallet()).getAccounts();
        const transfer1 = {
            denom: NATIVE_TOKEN,
            amount: "1234",
        };
        const transfer2 = {
            denom: NATIVE_TOKEN,
            amount: "1000",
        };
        const fee = {
            amount: [{denom: NATIVE_TOKEN, amount: "12"}],
            gas: "10000000"
        };

        // user1 -> user2
        let previousUser1Balance: Coin = await user1Client.getBalance(user1Account.address, NATIVE_TOKEN);
        let previousUser2Balance: Coin = await user1Client.getBalance(user2Account.address, NATIVE_TOKEN);

        let broadcastTxResponse1: DeliverTxResponse = await user1Client.sendTokens(user1Account.address, user2Account.address, [transfer1], fee, "Testing send transaction");
        assertIsDeliverTxSuccess(broadcastTxResponse1);
        let nextUser1Balance: Coin = await user1Client.getBalance(user1Account.address, NATIVE_TOKEN);
        let nextUser2Balance: Coin = await user1Client.getBalance(user2Account.address, NATIVE_TOKEN);
        console.log(`User1 balance before=(${previousUser1Balance.denom}, ${previousUser1Balance.amount}) after=(${nextUser1Balance.denom}, ${nextUser1Balance.amount})`);
        console.log(`User2 balance before=(${previousUser2Balance.denom}, ${previousUser2Balance.amount}) after=(${nextUser2Balance.denom}, ${nextUser2Balance.amount})`);

        expect(BigInt(nextUser1Balance.amount)).toBe(BigInt(previousUser1Balance.amount) - BigInt(transfer1.amount) - BigInt(fee.amount[0].amount));
        expect(BigInt(nextUser2Balance.amount)).toBe(BigInt(previousUser2Balance.amount) + BigInt(transfer1.amount));

        // user2 -> user3
        previousUser2Balance = await user1Client.getBalance(user2Account.address, NATIVE_TOKEN);
        let previousUser3Balance: Coin = await user1Client.getBalance(user3Account.address, NATIVE_TOKEN);

        let broadcastTxResponse3: DeliverTxResponse = await user2Client.sendTokens(user2Account.address, user3Account.address, [transfer2], fee, "Testing send transaction");
        assertIsDeliverTxSuccess(broadcastTxResponse3);
        nextUser2Balance = await user1Client.getBalance(user2Account.address, NATIVE_TOKEN);
        let nextUser3Balance: Coin = await user1Client.getBalance(user3Account.address, NATIVE_TOKEN);
        console.log(`User2 balance before=(${previousUser2Balance.denom}, ${previousUser2Balance.amount}) after=(${nextUser2Balance.denom}, ${nextUser2Balance.amount})`);
        console.log(`User3 balance before=(${previousUser3Balance.denom}, ${previousUser3Balance.amount}) after=(${nextUser3Balance.denom}, ${nextUser3Balance.amount})`);

        expect(BigInt(nextUser2Balance.amount)).toBe(BigInt(previousUser2Balance.amount) - BigInt(transfer2.amount) - BigInt(fee.amount[0].amount));
        expect(BigInt(nextUser3Balance.amount)).toBe(BigInt(previousUser3Balance.amount) + BigInt(transfer2.amount));
    });
});

