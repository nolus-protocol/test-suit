import {
    getClient,
    createWallet,
    getUser1Client,
    getUser1Wallet
} from "../util/clients";
import {AccountData, EncodeObject} from "@cosmjs/proto-signing";
import {SigningCosmWasmClient} from "@cosmjs/cosmwasm-stargate";
import {MsgCreateVestingAccount, protobufPackage as vestingPackage} from "../util/codec/cosmos/vesting/v1beta1/tx";
import Long from "long";
import {assertIsDeliverTxSuccess, isDeliverTxFailure} from "@cosmjs/stargate";
import {DEFAULT_FEE, sleep} from "../util/utils";
import { Coin } from "src/util/codec/cosmos/base/v1beta1/coin";

describe("Delayed vesting tests", () => {
    const AMOUNT: Coin = {denom: "unolus", amount: "10000"};
    const INIT: Coin = {denom: "unolus", amount: "200"};
    const ENDTIME_SECONDS: number = 30;
    let user1Client: SigningCosmWasmClient;
    let user1Account: AccountData;
    let delayedClient: SigningCosmWasmClient;
    let delayedAccount: AccountData;

    beforeAll(async () => {
        user1Client = await getUser1Client();
        [user1Account] = await (await getUser1Wallet()).getAccounts();
        const delWallet = await createWallet();
        delayedClient = await getClient(delWallet);
        [delayedAccount] = await delWallet.getAccounts();
    });

    test("created delayed vesting account should works as expected", async () => {
        const createVestingAccountMsg: MsgCreateVestingAccount = {
            fromAddress: user1Account.address,
            toAddress: delayedAccount.address,
            amount: [AMOUNT],
            endTime: Long.fromNumber((new Date().getTime() / 1000) + ENDTIME_SECONDS),
            delayed: true,
        };
        const encodedMsg: EncodeObject = {
            typeUrl: `/${vestingPackage}.MsgCreateVestingAccount`,
            value: createVestingAccountMsg,
        };

        let result = await user1Client.signAndBroadcast(user1Account.address, [encodedMsg], DEFAULT_FEE);
        assertIsDeliverTxSuccess(result);

        await user1Client.sendTokens(user1Account.address, delayedAccount.address, [INIT], DEFAULT_FEE);

        let sendFailTx = await delayedClient.sendTokens(delayedAccount.address, user1Account.address, [AMOUNT], DEFAULT_FEE);
        console.log(sendFailTx);
        expect(isDeliverTxFailure(sendFailTx)).toBeTruthy();
        expect(sendFailTx.rawLog).toMatch(/^.*smaller than 10000unolus: insufficient funds.*/);
        await sleep(ENDTIME_SECONDS * 1000);

        assertIsDeliverTxSuccess(await delayedClient.sendTokens(delayedAccount.address, user1Account.address, [AMOUNT], DEFAULT_FEE));
    }, 80000);
});
