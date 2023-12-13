/* eslint-disable */
import _m0, { BinaryReader, BinaryWriter } from "cosmjs-types/binary";

export const protobufPackage = 'cosmwasm.wasm.v1';

export interface MsgSudoContract {
  authority: string,
  contract: string,
  msg: Uint8Array,
}

export interface MsgSudoContractResponse {
}

function createBaseMsgSudoContract(): MsgSudoContract {
  return { authority: "", contract: "", msg: new Uint8Array() };
}

export const MsgSudoContract = {
  encode(message: MsgSudoContract, writer: _m0.BinaryWriter = BinaryWriter.create()): _m0.BinaryWriter {
    if (message.authority !== "") {
      writer.uint32(10).string(message.authority);
    }
    if (message.contract !== "") {
      writer.uint32(18).string(message.contract);
    }
    if (message.msg.length !== 0) {
      writer.uint32(26).bytes(message.msg);
    }
    return writer;
  },

  decode(input: _m0.BinaryReader | Uint8Array, length?: number): MsgSudoContract {
    const reader = input instanceof _m0.BinaryReader ? input : new _m0.BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgSudoContract();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break;
          }

          message.authority = reader.string();
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.contract = reader.string();
          continue;
        case 3:
          if (tag !== 26) {
            break;
          }

          message.msg = reader.bytes();
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): MsgSudoContract {
    return {
      authority: isSet(object.authority) ? String(object.authority) : "",
      contract: isSet(object.contract) ? String(object.contract) : "",
      msg: isSet(object.msg) ? new Uint8Array(object.msg) : new Uint8Array(),
    };
  },

  toJSON(message: MsgSudoContract): unknown {
    const obj: any = {};
    message.authority !== undefined && (obj.authority = message.authority);
    message.contract !== undefined && (obj.contract = message.contract);
    message.msg !== undefined && (obj.msg = message.msg);
    return obj;
  },

  create<I extends Exact<DeepPartial<MsgSudoContract>, I>>(base?: I): MsgSudoContract {
    return MsgSudoContract.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<MsgSudoContract>, I>>(object: I): MsgSudoContract {
    const message = createBaseMsgSudoContract();
    message.authority = object.authority ?? "";
    message.contract = object.contract ?? "";
    message.msg = object.msg ?? new Uint8Array();
    return message;
  },
};

function createBaseMsgSudoContractResponse(): MsgSudoContractResponse {
  return {};
}

export const MsgSudoContractResponse = {
  encode(_: MsgSudoContractResponse, writer: _m0.BinaryWriter = new _m0.BinaryWriter()): _m0.BinaryWriter {
    return writer;
  },

  decode(input: _m0.BinaryReader | Uint8Array, length?: number): MsgSudoContractResponse {
    const reader = input instanceof _m0.BinaryReader ? input : new _m0.BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgSudoContractResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  fromJSON(_: any): MsgSudoContractResponse {
    return {};
  },

  toJSON(_: MsgSudoContractResponse): unknown {
    const obj: any = {};
    return obj;
  },

  create<I extends Exact<DeepPartial<MsgSudoContractResponse>, I>>(base?: I): MsgSudoContractResponse {
    return MsgSudoContractResponse.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<MsgSudoContractResponse>, I>>(_: I): MsgSudoContractResponse {
    const message = createBaseMsgSudoContractResponse();
    return message;
  },
};

export interface Msg {
  SudoContract(request: MsgSudoContract): Promise<MsgSudoContractResponse>;
}

export class MsgClientImpl implements Msg {
  private readonly rpc: Rpc;
  private readonly service: string;
  constructor(rpc: Rpc, opts?: { service?: string }) {
    this.service = opts?.service || 'cosmwasm.wasm.v1';
    this.rpc = rpc;
    this.SudoContract = this.SudoContract.bind(this);
  }
  SudoContract(request: MsgSudoContract): Promise<MsgSudoContractResponse> {
    const data = MsgSudoContract.encode(request).finish();
    const promise = this.rpc.request(this.service, "SudoContract", data);
    return promise.then((data) => MsgSudoContractResponse.decode(new BinaryReader(data)));
  }
}

interface Rpc {
  request(service: string, method: string, data: Uint8Array): Promise<Uint8Array>;
}

type Builtin = Date | Function | Uint8Array | string | number | boolean | undefined;

export type DeepPartial<T> = T extends Builtin ? T
  : T extends Long ? string | number | Long : T extends Array<infer U> ? Array<DeepPartial<U>>
  : T extends ReadonlyArray<infer U> ? ReadonlyArray<DeepPartial<U>>
  : T extends {} ? { [K in keyof T]?: DeepPartial<T[K]> }
  : Partial<T>;

type KeysOfUnion<T> = T extends T ? keyof T : never;
export type Exact<P, I extends P> = P extends Builtin ? P
  : P & { [K in keyof P]: Exact<P[K], I[K]> } & { [K in Exclude<keyof I, KeysOfUnion<P>>]: never };

function isSet(value: any): boolean {
  return value !== null && value !== undefined;
}
