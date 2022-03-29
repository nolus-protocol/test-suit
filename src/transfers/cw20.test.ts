import * as fs from "fs";
import {InstantiateResult, SigningCosmWasmClient} from "@cosmjs/cosmwasm-stargate";
import {getUser2Client, getUser2Wallet, getUser1Client, getUser1Wallet} from "../util/clients";
import {AccountData} from "@cosmjs/amino";


describe("CW20 transfer", () => {
    let user1Client: SigningCosmWasmClient;
    let user1Account: AccountData;
    let contractAddress: string;
    let tokenName = "Test";
    let tokenSymbol = "TST";
    let tokenDecimals = 18;
    let totalSupply = "1000000000000000000";
    const customFees = {
        upload: {
            amount: [{amount: "2000000", denom: "unolus"}],
            gas: "2000000",
        },
        init: {
            amount: [{amount: "500000", denom: "unolus"}],
            gas: "500000",
        },
        exec: {
            amount: [{amount: "500000", denom: "unolus"}],
            gas: "500000",
        }
    };

    beforeAll(async () => {
        user1Client = await getUser1Client();
        [user1Account] = await (await getUser1Wallet()).getAccounts();

        // get wasm binary file
        const wasmBinary: Buffer = fs.readFileSync("./wasm-contracts/cw20_base.wasm");

        // upload wasm binary
        const uploadReceipt = await user1Client.upload(user1Account.address, wasmBinary, customFees.upload);
        const codeId = uploadReceipt.codeId;
        console.log("uploadReceipt:", uploadReceipt);

        // instantiate the contract
        const instatiateMsg = {
            "name": tokenName,
            "symbol": tokenSymbol,
            "decimals": tokenDecimals,
            "initial_balances": [
                {
                    "address": user1Account.address,
                    "amount": totalSupply
                }
            ]
        };
        const contract: InstantiateResult = await user1Client.instantiate(user1Account.address, codeId, instatiateMsg, "Sample CW20", customFees.init);
        contractAddress = contract.contractAddress;
        console.log("contract address:", contractAddress);
    });

    test("contract should be deployed", async () => {
        // get token info
        const tokenInfoMsg = {
            "token_info": {}
        };
        const tokenInfoResponse = await user1Client.queryContractSmart(contractAddress, tokenInfoMsg);
        console.log("token_info: ", tokenInfoResponse);

        expect(tokenInfoResponse.name).toBe(tokenName);
        expect(tokenInfoResponse.symbol).toBe(tokenSymbol);
        expect(tokenInfoResponse.decimals).toBe(tokenDecimals);
        expect(tokenInfoResponse["total_supply"]).toBe(totalSupply);

        // get user1 balance
        const balanceMsg = {
            "balance": {
                "address": user1Account.address
            }
        };
        const user1BalanceMsgResponse = await user1Client.queryContractSmart(contractAddress, balanceMsg);
        console.log("user1 balance:", user1BalanceMsgResponse);

        expect(user1BalanceMsgResponse.balance).toBe(totalSupply);
    });

    test("users should be able transfer tokens", async () => {
        const user2Client = await getUser2Client();
        const [user2Account] = await (await getUser2Wallet()).getAccounts();
        let amountToTransfer = "1000";
        let user2BalanceBefore;
        let user2BalanceAfter;

        const balanceMsgUser2 = {
            "balance": {
                "address": user2Account.address
            }
        };
        user2BalanceBefore = (await user2Client.queryContractSmart(contractAddress, balanceMsgUser2)).balance;
        console.log("User2 before balance:", user2BalanceBefore);

        const transferMsg = {
            "transfer": {
                "recipient": user2Account.address,
                "amount": amountToTransfer,
            }
        };

        await user1Client.execute(user1Account.address, contractAddress, transferMsg, customFees.exec);
        user2BalanceAfter = (await user2Client.queryContractSmart(contractAddress, balanceMsgUser2)).balance;
        console.log("User2 after balance:", user2BalanceAfter);

        expect(BigInt(user2BalanceAfter)).toBe(BigInt(user2BalanceBefore) + BigInt(amountToTransfer));
    });

    test("users should be able to transfer tokens allowed from another user", async () => {
        const user2Client = await getUser2Client();
        const [user2Account] = await (await getUser2Wallet()).getAccounts();
        let user2AllowanceBefore;
        let user2AllowanceAfter;
        let user2BalanceBefore;
        let user2BalanceAfter;
        let amountToTransfer = "1000";

        const allowanceMsg = {
            "allowance": {
                "owner": user1Account.address,
                "spender": user2Account.address
            }
        };
        user2AllowanceBefore = (await user2Client.queryContractSmart(contractAddress, allowanceMsg)).allowance;
        console.log("User before allowance:", user2AllowanceBefore);

        const balanceMsg = {
            "balance": {
                "address": user2Account.address
            }
        };
        user2BalanceBefore = (await user2Client.queryContractSmart(contractAddress, balanceMsg)).balance;
        console.log("User before balance:", user2BalanceBefore);

        // send some native tokens to the user, so that they can call TransferFrom
        const nativeTokenTransfer = {
            denom: "unolus",
            amount: "2000000",
        };
        const fee = {
            amount: [{denom: "unolus", amount: "12"}],
            gas: "100000"
        };
        await user1Client.sendTokens(user1Account.address, user2Account.address, [nativeTokenTransfer], fee, "Send transaction");

        const increaseAllowanceMsg = {
            "increase_allowance": {
                "spender": user2Account.address,
                "amount": amountToTransfer,
            }
        };
        await user1Client.execute(user1Account.address, contractAddress, increaseAllowanceMsg, customFees.exec);

        user2AllowanceAfter = (await user2Client.queryContractSmart(contractAddress, allowanceMsg)).allowance;
        console.log("User after allowance:", user2AllowanceAfter);

        expect(BigInt(user2AllowanceAfter)).toBe(BigInt(user2AllowanceBefore) + BigInt(amountToTransfer));

        const transferFromMsg = {
            "transfer_from": {
                "owner": user1Account.address,
                "recipient": user2Account.address,
                "amount": amountToTransfer
            }
        };
        await user2Client.execute(user2Account.address, contractAddress, transferFromMsg, customFees.exec);

        user2BalanceAfter = (await user2Client.queryContractSmart(contractAddress, balanceMsg)).balance;
        console.log("User after balance:", user2BalanceAfter);
        console.log("User after transfer allowance:", (await user2Client.queryContractSmart(contractAddress, allowanceMsg)).allowance);

        expect(BigInt(user2BalanceAfter)).toBe(BigInt(user2BalanceBefore) + BigInt(amountToTransfer));
    });
});
