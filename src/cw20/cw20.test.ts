import * as fs from 'fs';
import { InstantiateResult } from '@cosmjs/cosmwasm-stargate';
import NODE_ENDPOINT, { getUser2Wallet, getUser1Wallet } from '../util/clients';
import { ChainConstants } from '@nolus/nolusjs';
import { NolusWallet, NolusClient } from '@nolus/nolusjs';
import { customFees, gasPrice } from '../util/utils';

describe('CW20 transfer', () => {
  const NATIVE_TOKEN = ChainConstants.COIN_MINIMAL_DENOM;
  let user1Wallet: NolusWallet;
  let user2Wallet: NolusWallet;
  let contractAddress: string;
  const tokenName = 'Test';
  const tokenSymbol = 'TST';
  const tokenDecimals = 18;
  const totalSupply = '1000000000000000000';
  let NATIVE_TOKEN_DENOM: string;
  const treasuryAddress = process.env.TREASURY_ADDRESS as string;

  beforeAll(async () => {
    NATIVE_TOKEN_DENOM = ChainConstants.COIN_MINIMAL_DENOM;
    NolusClient.setInstance(NODE_ENDPOINT);
    user1Wallet = await getUser1Wallet();
    user2Wallet = await getUser2Wallet();

    // get wasm binary file
    const wasmBinary: Buffer = fs.readFileSync(
      './wasm-contracts/cw20_base.wasm',
    );

    const treasuryBalanceBefore = await user1Wallet.getBalance(
      treasuryAddress,
      NATIVE_TOKEN_DENOM,
    );

    // upload wasm binary
    const uploadReceipt = await user1Wallet.upload(
      user1Wallet.address as string,
      wasmBinary,
      customFees.upload,
    );

    const treasuryBalanceAfter = await user1Wallet.getBalance(
      treasuryAddress,
      NATIVE_TOKEN_DENOM,
    );

    expect(+treasuryBalanceAfter.amount).toBe(
      +treasuryBalanceBefore.amount +
        +customFees.upload.amount[0].amount -
        Math.floor(+customFees.upload.gas * gasPrice),
    );
    const codeId = uploadReceipt.codeId;

    // instantiate the contract
    const instatiateMsg = {
      name: tokenName,
      symbol: tokenSymbol,
      decimals: tokenDecimals,
      initial_balances: [
        {
          address: user1Wallet.address,
          amount: totalSupply,
        },
      ],
    };

    const contract: InstantiateResult = await user1Wallet.instantiate(
      user1Wallet.address as string,
      codeId,
      instatiateMsg,
      'Sample CW20',
      customFees.init,
    );

    const treasuryBalanceAfterInit = await user1Wallet.getBalance(
      treasuryAddress,
      NATIVE_TOKEN_DENOM,
    );

    expect(+treasuryBalanceAfterInit.amount).toBe(
      +treasuryBalanceAfter.amount +
        +customFees.init.amount[0].amount -
        Math.floor(+customFees.init.gas * gasPrice),
    );

    contractAddress = contract.contractAddress;
  });

  test('contract should be deployed', async () => {
    const tokenInfoMsg = {
      token_info: {},
    };
    const balanceMsg = {
      balance: {
        address: user1Wallet.address as string,
      },
    };

    const tokenInfoResponse = await user1Wallet.queryContractSmart(
      contractAddress,
      tokenInfoMsg,
    );

    expect(tokenInfoResponse.name).toBe(tokenName);
    expect(tokenInfoResponse.symbol).toBe(tokenSymbol);
    expect(tokenInfoResponse.decimals).toBe(tokenDecimals);
    expect(tokenInfoResponse['total_supply']).toBe(totalSupply);

    const user1BalanceMsgResponse = await user1Wallet.queryContractSmart(
      contractAddress,
      balanceMsg,
    );

    expect(user1BalanceMsgResponse.balance).toBe(totalSupply);
  });

  test('users should be able transfer tokens', async () => {
    const amountToTransfer = '1000';
    const balanceMsgUser2 = {
      balance: {
        address: user2Wallet.address,
      },
    };
    const transferMsg = {
      transfer: {
        recipient: user2Wallet.address,
        amount: amountToTransfer,
      },
    };

    const user2BalanceBefore = (
      await user2Wallet.queryContractSmart(contractAddress, balanceMsgUser2)
    ).balance;
    await user1Wallet.executeContract(
      contractAddress,
      transferMsg,
      customFees.transfer,
    );
    const user2BalanceAfter = (
      await user2Wallet.queryContractSmart(contractAddress, balanceMsgUser2)
    ).balance;

    expect(BigInt(user2BalanceAfter)).toBe(
      BigInt(user2BalanceBefore) + BigInt(amountToTransfer),
    );
  });

  test('users should be able to transfer tokens allowed from another user', async () => {
    const amountToTransfer = '1000';
    const allowanceMsg = {
      allowance: {
        owner: user1Wallet.address as string,
        spender: user2Wallet.address as string,
      },
    };
    const transferFromMsg = {
      transfer_from: {
        owner: user1Wallet.address as string,
        recipient: user2Wallet.address as string,
        amount: amountToTransfer,
      },
    };
    const nativeTokenTransfer = {
      denom: NATIVE_TOKEN,
      amount: '2000000',
    };

    const balanceMsg = {
      balance: {
        address: user2Wallet.address as string,
      },
    };
    const increaseAllowanceMsg = {
      increase_allowance: {
        spender: user2Wallet.address as string,
        amount: amountToTransfer,
      },
    };

    const user2AllowanceBefore = (
      await user2Wallet.queryContractSmart(contractAddress, allowanceMsg)
    ).allowance;
    const user2BalanceBefore = (
      await user2Wallet.queryContractSmart(contractAddress, balanceMsg)
    ).balance;

    // send some native tokens to the user, so that they can call TransferFrom
    await user1Wallet.transferAmount(
      user2Wallet.address as string,
      [nativeTokenTransfer],
      customFees.transfer,
      '',
    );

    const treasuryBalanceBeforeExec = await user1Wallet.getBalance(
      treasuryAddress,
      NATIVE_TOKEN_DENOM,
    );

    await user1Wallet.executeContract(
      contractAddress,
      increaseAllowanceMsg,
      customFees.exec,
    );

    const treasuryBalanceAfterExec = await user1Wallet.getBalance(
      treasuryAddress,
      NATIVE_TOKEN_DENOM,
    );

    expect(+treasuryBalanceAfterExec.amount).toBe(
      +treasuryBalanceBeforeExec.amount +
        +customFees.exec.amount[0].amount -
        Math.floor(+customFees.exec.gas * gasPrice),
    );

    const user2AllowanceAfter = (
      await user2Wallet.queryContractSmart(contractAddress, allowanceMsg)
    ).allowance;

    expect(BigInt(user2AllowanceAfter)).toBe(
      BigInt(user2AllowanceBefore) + BigInt(amountToTransfer),
    );

    await user2Wallet.executeContract(
      contractAddress,
      transferFromMsg,
      customFees.exec,
    );
    const user2BalanceAfter = (
      await user2Wallet.queryContractSmart(contractAddress, balanceMsg)
    ).balance;
    console.log(
      'User after transfer allowance:',
      (await user2Wallet.queryContractSmart(contractAddress, allowanceMsg))
        .allowance,
    );

    expect(BigInt(user2BalanceAfter)).toBe(
      BigInt(user2BalanceBefore) + BigInt(amountToTransfer),
    );
  });
});
