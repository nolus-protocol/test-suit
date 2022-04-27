import * as fs from 'fs';
import {
  InstantiateResult,
  SigningCosmWasmClient,
} from '@cosmjs/cosmwasm-stargate';
import {
  getUser2Client,
  getUser2Wallet,
  getUser1Client,
  getUser1Wallet,
} from '../util/clients';
import { AccountData } from '@cosmjs/amino';

describe('CW20 transfer', () => {
  const NATIVE_TOKEN = 'unolus';
  let user1Client: SigningCosmWasmClient;
  let user1Account: AccountData;
  let contractAddress: string;
  const tokenName = 'Test';
  const tokenSymbol = 'TST';
  const tokenDecimals = 18;
  const totalSupply = '1000000000000000000';
  const customFees = {
    upload: {
      amount: [{ amount: '2000000', denom: NATIVE_TOKEN }],
      gas: '2000000',
    },
    init: {
      amount: [{ amount: '500000', denom: NATIVE_TOKEN }],
      gas: '500000',
    },
    exec: {
      amount: [{ amount: '500000', denom: NATIVE_TOKEN }],
      gas: '500000',
    },
  };

  beforeAll(async () => {
    user1Client = await getUser1Client();
    [user1Account] = await (await getUser1Wallet()).getAccounts();

    // get wasm binary file
    const wasmBinary: Buffer = fs.readFileSync(
      './wasm-contracts/cw20_base.wasm',
    );

    // upload wasm binary
    const uploadReceipt = await user1Client.upload(
      user1Account.address,
      wasmBinary,
      customFees.upload,
    );
    const codeId = uploadReceipt.codeId;
    console.log('UploadReceipt:', uploadReceipt);

    // instantiate the contract
    const instatiateMsg = {
      name: tokenName,
      symbol: tokenSymbol,
      decimals: tokenDecimals,
      initial_balances: [
        {
          address: user1Account.address,
          amount: totalSupply,
        },
      ],
    };
    const contract: InstantiateResult = await user1Client.instantiate(
      user1Account.address,
      codeId,
      instatiateMsg,
      'Sample CW20',
      customFees.init,
    );
    contractAddress = contract.contractAddress;
    console.log('Contract address:', contractAddress);
  });

  test('contract should be deployed', async () => {
    const tokenInfoMsg = {
      token_info: {},
    };
    const balanceMsg = {
      balance: {
        address: user1Account.address,
      },
    };

    const tokenInfoResponse = await user1Client.queryContractSmart(
      contractAddress,
      tokenInfoMsg,
    );
    console.log('token_info: ', tokenInfoResponse);

    expect(tokenInfoResponse.name).toBe(tokenName);
    expect(tokenInfoResponse.symbol).toBe(tokenSymbol);
    expect(tokenInfoResponse.decimals).toBe(tokenDecimals);
    expect(tokenInfoResponse['total_supply']).toBe(totalSupply);

    const user1BalanceMsgResponse = await user1Client.queryContractSmart(
      contractAddress,
      balanceMsg,
    );
    console.log('User1 balance:', user1BalanceMsgResponse);

    expect(user1BalanceMsgResponse.balance).toBe(totalSupply);
  });

  test('users should be able transfer tokens', async () => {
    const user2Client = await getUser2Client();
    const [user2Account] = await (await getUser2Wallet()).getAccounts();
    const amountToTransfer = '1000';
    const balanceMsgUser2 = {
      balance: {
        address: user2Account.address,
      },
    };
    const transferMsg = {
      transfer: {
        recipient: user2Account.address,
        amount: amountToTransfer,
      },
    };

    const user2BalanceBefore = (
      await user2Client.queryContractSmart(contractAddress, balanceMsgUser2)
    ).balance;
    console.log('User2 before balance:', user2BalanceBefore);
    await user1Client.execute(
      user1Account.address,
      contractAddress,
      transferMsg,
      customFees.exec,
    );
    const user2BalanceAfter = (
      await user2Client.queryContractSmart(contractAddress, balanceMsgUser2)
    ).balance;
    console.log('User2 after balance:', user2BalanceAfter);

    expect(BigInt(user2BalanceAfter)).toBe(
      BigInt(user2BalanceBefore) + BigInt(amountToTransfer),
    );
  });

  test('users should be able to transfer tokens allowed from another user', async () => {
    const user2Client = await getUser2Client();
    const [user2Account] = await (await getUser2Wallet()).getAccounts();
    const amountToTransfer = '1000';
    const allowanceMsg = {
      allowance: {
        owner: user1Account.address,
        spender: user2Account.address,
      },
    };
    const transferFromMsg = {
      transfer_from: {
        owner: user1Account.address,
        recipient: user2Account.address,
        amount: amountToTransfer,
      },
    };
    const nativeTokenTransfer = {
      denom: NATIVE_TOKEN,
      amount: '2000000',
    };
    const fee = {
      amount: [{ denom: NATIVE_TOKEN, amount: '12' }],
      gas: '100000',
    };
    const balanceMsg = {
      balance: {
        address: user2Account.address,
      },
    };
    const increaseAllowanceMsg = {
      increase_allowance: {
        spender: user2Account.address,
        amount: amountToTransfer,
      },
    };

    const user2AllowanceBefore = (
      await user2Client.queryContractSmart(contractAddress, allowanceMsg)
    ).allowance;
    console.log('User before allowance:', user2AllowanceBefore);
    const user2BalanceBefore = (
      await user2Client.queryContractSmart(contractAddress, balanceMsg)
    ).balance;
    console.log('User before balance:', user2BalanceBefore);

    // send some native tokens to the user, so that they can call TransferFrom
    await user1Client.sendTokens(
      user1Account.address,
      user2Account.address,
      [nativeTokenTransfer],
      fee,
      'Send transaction',
    );
    await user1Client.execute(
      user1Account.address,
      contractAddress,
      increaseAllowanceMsg,
      customFees.exec,
    );
    const user2AllowanceAfter = (
      await user2Client.queryContractSmart(contractAddress, allowanceMsg)
    ).allowance;
    console.log('User after allowance:', user2AllowanceAfter);

    expect(BigInt(user2AllowanceAfter)).toBe(
      BigInt(user2AllowanceBefore) + BigInt(amountToTransfer),
    );

    await user2Client.execute(
      user2Account.address,
      contractAddress,
      transferFromMsg,
      customFees.exec,
    );
    const user2BalanceAfter = (
      await user2Client.queryContractSmart(contractAddress, balanceMsg)
    ).balance;
    console.log('User after balance:', user2BalanceAfter);
    console.log(
      'User after transfer allowance:',
      (await user2Client.queryContractSmart(contractAddress, allowanceMsg))
        .allowance,
    );

    expect(BigInt(user2BalanceAfter)).toBe(
      BigInt(user2BalanceBefore) + BigInt(amountToTransfer),
    );
  });
});
