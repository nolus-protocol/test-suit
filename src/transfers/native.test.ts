import {
  assertIsDeliverTxSuccess,
  Coin,
  DeliverTxResponse,
  isDeliverTxFailure,
} from '@cosmjs/stargate';
import NODE_ENDPOINT, {
  getUser1Wallet,
  getUser2Wallet,
  getUser3Wallet,
} from '../util/clients';
import { customFees, NATIVE_MINIMAL_DENOM } from '../util/utils';
import { NolusWallet, NolusClient, ChainConstants } from '@nolus/nolusjs';
import { calcFeeProfit, sendInitTransferFeeTokens } from '../util/transfer';
import { ifLocal, runOrSkip } from '../util/testingRules';
import { HDNodeWallet, Wallet } from 'ethers';
import { Buffer } from 'buffer';
import * as bech32 from 'bech32';
import { sha256, ripemd160 } from '@cosmjs/crypto';
import {
  AuthInfo,
  Fee,
  ModeInfo,
  SignerInfo,
  TxBody,
  TxRaw,
} from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import { MsgSend } from 'cosmjs-types/cosmos/bank/v1beta1/tx';
import { SignMode } from 'cosmjs-types/cosmos/tx/signing/v1beta1/signing';
import { PubKey } from 'cosmjs-types/cosmos/crypto/secp256k1/keys';

runOrSkip(process.env.TEST_TRANSFER as string)(
  'Transfers - Native transfer',
  () => {
    let user1Wallet: NolusWallet;
    let user2Wallet: NolusWallet;
    let user3Wallet: NolusWallet;
    let transfer1: Coin;
    let transfer2: Coin;
    let transfer3: Coin;
    const transferAmount = 10;
    const treasuryAddress = process.env.TREASURY_ADDRESS as string;

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);
      user1Wallet = await getUser1Wallet();
      user2Wallet = await getUser2Wallet();
      user3Wallet = await getUser3Wallet();

      transfer1 = {
        denom: NATIVE_MINIMAL_DENOM,
        amount: (
          transferAmount +
          +customFees.transfer.amount[0].amount * 2
        ).toString(),
      };
      transfer2 = {
        denom: NATIVE_MINIMAL_DENOM,
        amount: (
          transferAmount + +customFees.transfer.amount[0].amount
        ).toString(),
      };
      transfer3 = {
        denom: NATIVE_MINIMAL_DENOM,
        amount: transferAmount.toString(),
      };
    });

    function buildExactSignDoc(
      accountNumber: bigint | number,
      sequence: bigint | number,
      fromAddress: string,
      toAddress: string,
      sendAmount: string,
      feeAmount: string,
      gas: string,
      memo: string,
      chainId: string,
    ) {
      return {
        account_number: accountNumber.toString(),
        chain_id: chainId,
        fee: {
          amount: [
            {
              amount: feeAmount,
              denom: NATIVE_MINIMAL_DENOM,
            },
          ],
          gas: gas,
        },
        memo: memo,
        msgs: [
          {
            type: 'cosmos-sdk/MsgSend',
            value: {
              amount: [
                {
                  amount: sendAmount,
                  denom: NATIVE_MINIMAL_DENOM,
                },
              ],
              from_address: fromAddress,
              to_address: toAddress,
            },
          },
        ],
        sequence: sequence.toString(),
      };
    }

    function deriveNolusFromEthCompressedPubkey(compressed: Uint8Array) {
      const sha = sha256(compressed);
      const rip = ripemd160(sha);

      return bech32.encode(
        ChainConstants.BECH32_PREFIX_ACC_ADDR,
        bech32.toWords(rip),
      );
    }

    async function fetchAccountInfo(address: string) {
      const account = await user1Wallet.getAccount(address);
      if (!account) return { accountNumber: 0, sequence: 0 };

      return {
        accountNumber: account.accountNumber,
        sequence: account.sequence,
      };
    }

    function getCompressedPubkeyFromEth(wallet: HDNodeWallet): Uint8Array {
      const fullUncompressed = wallet.signingKey.publicKey; // 0x04 + X32 + Y32
      const uncompressedBytes = Buffer.from(fullUncompressed.slice(2), 'hex');
      const x = uncompressedBytes.subarray(1, 33);
      const y = uncompressedBytes.subarray(33);
      const compressed = new Uint8Array(33);
      compressed[0] = y[y.length - 1] % 2 ? 0x03 : 0x02;
      compressed.set(x, 1);

      return compressed;
    }

    async function signWithEip191Async(
      ethWallet: HDNodeWallet,
      signDoc: unknown,
    ) {
      const signBytes = Buffer.from(JSON.stringify(signDoc, null, 4), 'utf8');
      const sigHex = await ethWallet.signMessage(signBytes);
      const sigBuf = Buffer.from(sigHex.slice(2), 'hex');

      return sigBuf.subarray(0, 64); // r||s
    }

    function buildTxBytesEip191(
      fromAddress: string,
      toAddress: string,
      sendAmount: string,
      feeAmount: string,
      gas: string,
      memo: string,
      compressedPubkey: Uint8Array,
      sequence: bigint | number,
    ) {
      const msgSend = MsgSend.fromPartial({
        fromAddress,
        toAddress,
        amount: [{ denom: NATIVE_MINIMAL_DENOM, amount: sendAmount }],
      });

      const txBodyBytes = TxBody.encode(
        TxBody.fromPartial({
          messages: [
            {
              typeUrl: '/cosmos.bank.v1beta1.MsgSend',
              value: MsgSend.encode(msgSend).finish(),
            },
          ],
          memo: memo,
        }),
      ).finish();

      const pubkeyAny = {
        typeUrl: '/cosmos.crypto.secp256k1.PubKey',
        value: PubKey.encode({ key: compressedPubkey }).finish(),
      };

      const authInfoBytes = AuthInfo.encode(
        AuthInfo.fromPartial({
          signerInfos: [
            SignerInfo.fromPartial({
              publicKey: pubkeyAny,
              modeInfo: ModeInfo.fromPartial({
                single: { mode: SignMode.SIGN_MODE_EIP_191 },
              }),
              sequence: BigInt(sequence),
            }),
          ],
          fee: Fee.fromPartial({
            amount: [{ denom: NATIVE_MINIMAL_DENOM, amount: feeAmount }],
            gasLimit: BigInt(gas),
          }),
        }),
      ).finish();

      return { txBodyBytes, authInfoBytes };
    }

    test('account should have some balance', async () => {
      const balance = await user1Wallet.getBalance(
        user1Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      expect(BigInt(balance.amount) > 0).toBeTruthy();
    });

    test('users should be able to transfer and receive native tokens', async () => {
      const treasuryBalanceBefore = await user1Wallet.getBalance(
        treasuryAddress,
        NATIVE_MINIMAL_DENOM,
      );
      // user1 -> user2
      const previousUser1Balance = await user1Wallet.getBalance(
        user1Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );
      let previousUser2Balance = await user2Wallet.getBalance(
        user2Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );
      const broadcastTxResponse1: DeliverTxResponse =
        await user1Wallet.transferAmount(
          user2Wallet.address as string,
          [transfer1],
          customFees.transfer,
        );

      const treasuryBalanceAfter = await user1Wallet.getBalance(
        treasuryAddress,
        NATIVE_MINIMAL_DENOM,
      );

      if (ifLocal()) {
        expect(BigInt(treasuryBalanceAfter.amount)).toBe(
          BigInt(treasuryBalanceBefore.amount) +
            BigInt(calcFeeProfit(customFees.transfer)),
        );
      }

      assertIsDeliverTxSuccess(broadcastTxResponse1);

      const nextUser1Balance = await user1Wallet.getBalance(
        user1Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );
      let nextUser2Balance = await user2Wallet.getBalance(
        user2Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      expect(BigInt(nextUser1Balance.amount)).toBe(
        BigInt(previousUser1Balance.amount) -
          BigInt(transfer1.amount) -
          BigInt(customFees.transfer.amount[0].amount),
      );
      expect(BigInt(nextUser2Balance.amount)).toBe(
        BigInt(previousUser2Balance.amount) + BigInt(transfer1.amount),
      );

      // user2 -> user3
      previousUser2Balance = await user2Wallet.getBalance(
        user2Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );
      const previousUser3Balance = await user3Wallet.getBalance(
        user3Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      const broadcastTxResponse2: DeliverTxResponse =
        await user2Wallet.transferAmount(
          user3Wallet.address as string,
          [transfer2],
          customFees.transfer,
        );
      assertIsDeliverTxSuccess(broadcastTxResponse2);
      nextUser2Balance = await user2Wallet.getBalance(
        user2Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );
      const nextUser3Balance = await user3Wallet.getBalance(
        user3Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      expect(BigInt(nextUser2Balance.amount)).toBe(
        BigInt(previousUser2Balance.amount) -
          BigInt(transfer2.amount) -
          BigInt(customFees.transfer.amount[0].amount),
      );
      expect(BigInt(nextUser3Balance.amount)).toBe(
        BigInt(previousUser3Balance.amount) + BigInt(transfer2.amount),
      );

      // user 3 -> user 1 - isolate the test and finish in the initial state

      const broadcastTxResponse3: DeliverTxResponse =
        await user3Wallet.transferAmount(
          user1Wallet.address as string,
          [transfer3],
          customFees.transfer,
        );
      assertIsDeliverTxSuccess(broadcastTxResponse3);

      const user1Balance = await user1Wallet.getBalance(
        user1Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );
      const user3Balance = await user3Wallet.getBalance(
        user3Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      expect(BigInt(user1Balance.amount)).toBe(
        BigInt(previousUser1Balance.amount) -
          BigInt(+customFees.transfer.amount[0].amount * 3), // *3 -> transfer1 -> amount=2*fee.amount; fee=1*fee.amount
      );
      expect(BigInt(user3Balance.amount)).toBe(
        BigInt(previousUser3Balance.amount),
      );
    });

    test('user tries to send 0 tokens - should produce an error', async () => {
      const transfer = {
        denom: NATIVE_MINIMAL_DENOM,
        amount: '0',
      };

      const previousUser2Balance = await user2Wallet.getBalance(
        user2Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );
      const previousUser3Balance = await user1Wallet.getBalance(
        user3Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      await sendInitTransferFeeTokens(
        user1Wallet,
        user2Wallet.address as string,
      );

      const transferTx = await user2Wallet.transferAmount(
        user3Wallet.address as string,
        [transfer],
        customFees.transfer,
      );

      expect(transferTx.rawLog).toContain('0unls: invalid coins');

      const nextUser2Balance = await user2Wallet.getBalance(
        user2Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );
      const nextUser3Balance = await user3Wallet.getBalance(
        user3Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      expect(BigInt(nextUser2Balance.amount)).toBe(
        BigInt(previousUser2Balance.amount),
      );
      expect(BigInt(nextUser3Balance.amount)).toBe(
        BigInt(previousUser3Balance.amount),
      );
    });

    test('user tries to send the entire amount tokens he owns - should produce an error message', async () => {
      await sendInitTransferFeeTokens(
        user1Wallet,
        user2Wallet.address as string,
      );

      const previousUser2Balance = await user2Wallet.getBalance(
        user2Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );
      const transfer = {
        denom: NATIVE_MINIMAL_DENOM,
        amount: previousUser2Balance.amount,
      };
      const previousUser3Balance = await user3Wallet.getBalance(
        user3Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      const broadcastTxResponse: DeliverTxResponse =
        await user2Wallet.transferAmount(
          user3Wallet.address as string,
          [transfer],
          customFees.transfer,
        );

      expect(isDeliverTxFailure(broadcastTxResponse)).toBeTruthy();
      expect(broadcastTxResponse.rawLog).toMatch(/^.*insufficient funds.*/);

      const nextUser3Balance = await user3Wallet.getBalance(
        user3Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );
      const nextUser2Balance = await user2Wallet.getBalance(
        user2Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      expect(BigInt(nextUser2Balance.amount)).toBe(
        BigInt(previousUser2Balance.amount) -
          BigInt(customFees.transfer.amount[0].amount),
      );
      expect(BigInt(nextUser3Balance.amount)).toBe(
        BigInt(previousUser3Balance.amount),
      );
    });

    test('user should not be able to send tokens to an incompatible nolus wallet address', async () => {
      const WRONG_WALLET_ADDRESS =
        'wasm1gzkmn2lfm56m0q0l4rmjamq7rlwpfjrp7k78xw'; // wasm1 -> nolus1

      const previousUser2Balance = await user2Wallet.getBalance(
        user2Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      await sendInitTransferFeeTokens(
        user1Wallet,
        user2Wallet.address as string,
      );

      const transferTx = await user2Wallet.transferAmount(
        WRONG_WALLET_ADDRESS,
        [transfer2],
        customFees.transfer,
      );
      expect(transferTx.rawLog).toContain('invalid address');

      const nextUser2Balance = await user2Wallet.getBalance(
        user2Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      expect(BigInt(nextUser2Balance.amount)).toBe(
        BigInt(previousUser2Balance.amount),
      );
    });

    test('send tx using EIP-191 signer', async () => {
      const ethWallet = Wallet.createRandom();

      const compressed = getCompressedPubkeyFromEth(ethWallet);

      const signerAddress = deriveNolusFromEthCompressedPubkey(compressed);

      await user1Wallet.transferAmount(
        signerAddress,
        [transfer3],
        customFees.transfer,
      );
      await sendInitTransferFeeTokens(user1Wallet, signerAddress);

      const fromAddress = signerAddress; // EIP-191 signer address
      const toAddress = (await getUser1Wallet()).address as string; // recipient
      const sendAmount = transfer3.amount;
      const memo = 'EIP-191';

      const { accountNumber, sequence } = await fetchAccountInfo(fromAddress);

      const feeAmount = customFees.transfer.amount[0].amount;
      const gas = String(customFees.transfer.gas);

      const signDoc = buildExactSignDoc(
        accountNumber,
        sequence,
        fromAddress,
        toAddress,
        sendAmount,
        feeAmount,
        gas,
        memo,
        process.env.CHAIN_ID as string,
      );
      const sigBytes = await signWithEip191Async(ethWallet, signDoc);

      const { txBodyBytes, authInfoBytes } = buildTxBytesEip191(
        fromAddress,
        toAddress,
        sendAmount,
        feeAmount,
        gas,
        memo,
        compressed,
        sequence,
      );

      const txRaw = TxRaw.fromPartial({
        bodyBytes: txBodyBytes,
        authInfoBytes,
        signatures: [sigBytes],
      });

      const user1BalanceBefore = await user1Wallet.getBalance(
        user1Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      const txBytes = TxRaw.encode(txRaw).finish();
      const res = await user1Wallet.broadcastTx(txBytes);
      expect(res.code).toBe(0);

      const user1BalanceAfter = await user1Wallet.getBalance(
        user1Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      expect(BigInt(user1BalanceAfter.amount)).toBe(
        BigInt(user1BalanceBefore.amount) + BigInt(sendAmount),
      );
    });
  },
);
