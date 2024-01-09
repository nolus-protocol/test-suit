/* eslint-disable */
import _m0, { BinaryReader, BinaryWriter } from "cosmjs-types/binary";
import { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin";
import { Any } from "cosmjs-types/google/protobuf/any";

export const protobufPackage = "cosmos.gov.v1";

export interface MsgSubmitProposalCheck {
  messages: Any[];
  initialDeposit: Coin[];
  proposer: string;
  metadata: string;
  summary: string;
  title: string;
}

export interface MsgSubmitProposalCheckResponse {
  proposalId: bigint;
}

function createBaseMsgSubmitProposalCheck(): MsgSubmitProposalCheck {
  return { messages: [], initialDeposit: [], proposer: "", metadata: "", summary: "", title: "" };
}

export const  MsgSubmitProposalCheck = {
  encode(message: MsgSubmitProposalCheck, writer: _m0.BinaryWriter = BinaryWriter.create()): _m0.BinaryWriter {
    for (const v of message.messages) {
      Any.encode(v, writer.uint32(10).fork()).ldelim();
    }
    for (const v of message.initialDeposit) {
      Coin.encode(v, writer.uint32(18).fork()).ldelim();
    }
    if (message.proposer !== "") {
    writer.uint32(26).string(message.proposer);
    }
    if (message.metadata !== "") {
      writer.uint32(34).string(message.metadata);
    }
    if (message.summary !== "") {
      writer.uint32(42).string(message.summary);
    }
    if (message.title !== "") {
      writer.uint32(50).string(message.title);
    }

    return writer;
  },

  decode(input: _m0.BinaryReader | Uint8Array, length?: number):  MsgSubmitProposalCheck {
    const reader = input instanceof _m0.BinaryReader ? input : new _m0.BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgSubmitProposalCheck();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break;
          }

          message.messages.push(Any.decode(reader, reader.uint32()));
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.initialDeposit.push(Coin.decode(reader, reader.uint32()));
          continue;
        case 3:
          if (tag !== 26) {
            break;
          }

          message.proposer = reader.string();
          continue;
        case 4:
          if (tag !== 34) {
            break;
          }

          message.metadata = reader.string();
          continue;
        case 5:
          if (tag !== 42) {
             break;
          }

          message.summary = reader.string();
          continue;
        case 6:
          if (tag !== 50) {
             break;
          }

          message.title = reader.string();
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): MsgSubmitProposalCheck {
    const obj = createBaseMsgSubmitProposalCheck();
        if (Array.isArray(object?.messages))
            obj.messages = object.messages.map((e: any) => Any.fromJSON(e));
        if (Array.isArray(object?.initialDeposit))
            obj.initialDeposit = object.initialDeposit.map((e: any) => Coin.fromJSON(e));
        if (isSet(object.proposer))
            obj.proposer = String(object.proposer);
        if (isSet(object.metadata))
            obj.metadata = String(object.metadata);
        if (isSet(object.summary))
            obj.metadata = String(object.metadata);
        if (isSet(object.title))
            obj.metadata = String(object.metadata);
        return obj;
  },

  toJSON(message: MsgSubmitProposalCheck): unknown {
    const obj: any = {};
        if (message.messages) {
            obj.messages = message.messages.map((e) => (e ? Any.toJSON(e) : undefined));
        }
        else {
            obj.messages = [];
        }
        if (message.initialDeposit) {
            obj.initialDeposit = message.initialDeposit.map((e) => (e ? Coin.toJSON(e) : undefined));
        }
        else {
            obj.initialDeposit = [];
        }
        message.proposer !== undefined && (obj.proposer = message.proposer);
        message.metadata !== undefined && (obj.metadata = message.metadata);
        message.summary !== undefined && (obj.metadata = message.summary);
        message.title !== undefined && (obj.metadata = message.title);
        return obj;
  },

  create<I extends Exact<DeepPartial<MsgSubmitProposalCheck>, I>>(base?: I): MsgSubmitProposalCheck {
    return MsgSubmitProposalCheck.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<MsgSubmitProposalCheck>, I>>(object: I): MsgSubmitProposalCheck {
    const message = createBaseMsgSubmitProposalCheck();
    message.messages = object.messages?.map((e) => Any.fromPartial(e)) || [];
        message.initialDeposit = object.initialDeposit?.map((e) => Coin.fromPartial(e)) || [];
        message.proposer = object.proposer ?? "";
        message.metadata = object.metadata ?? "";
        message.summary = object.summary ?? "";
        message.title = object.title ?? "";
    return message;
  },
};

function createBaseMsgSubmitProposalCheckResponse(): MsgSubmitProposalCheckResponse {
  return { proposalId: BigInt(0) };
}

export const MsgSubmitProposalCheckResponse = {
  encode(message: MsgSubmitProposalCheckResponse, writer: _m0.BinaryWriter = new _m0.BinaryWriter()): _m0.BinaryWriter {
    if (message.proposalId !== BigInt(0)) {
      writer.uint32(8).uint64(message.proposalId);
  }
  return writer;
  },

  decode(input: _m0.BinaryReader | Uint8Array, length?: number): MsgSubmitProposalCheckResponse {
    const reader = input instanceof _m0.BinaryReader ? input : new _m0.BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgSubmitProposalCheckResponse();
    while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
            case 1:
                message.proposalId = reader.uint64();
                break;
            default:
                reader.skipType(tag & 7);
                break;
        }
    }
    return message;
  },

  fromJSON(object: any): MsgSubmitProposalCheckResponse {
    const obj = createBaseMsgSubmitProposalCheckResponse();
        if (isSet(object.proposalId))
            obj.proposalId = BigInt(object.proposalId.toString());
        return obj;
  },

  toJSON(message: MsgSubmitProposalCheckResponse): unknown {
    const obj: any = {};
    message.proposalId !== undefined && (obj.proposalId = (message.proposalId || BigInt(0)).toString());
    return obj;
  },

  create<I extends Exact<DeepPartial<MsgSubmitProposalCheckResponse>, I>>(base?: I): MsgSubmitProposalCheckResponse {
    return MsgSubmitProposalCheckResponse.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<MsgSubmitProposalCheckResponse>, I>>(object: I): MsgSubmitProposalCheckResponse {
    const message = createBaseMsgSubmitProposalCheckResponse();
    if (object.proposalId !== undefined && object.proposalId !== null) {
      message.proposalId = BigInt(object.proposalId.toString());
  }
  return message;
  },
};

export interface Msg {
  SubmitProposalCheck(request: MsgSubmitProposalCheck): Promise<MsgSubmitProposalCheckResponse>;
}

export class MsgClientImpl implements Msg {
  private readonly rpc: Rpc;
  private readonly service: string;
  constructor(rpc: Rpc, opts?: { service?: string }) {
    this.service = opts?.service || 'cosmos.gov.v1';
    this.rpc = rpc;
    this.SubmitProposalCheck = this.SubmitProposalCheck.bind(this);
  }
  SubmitProposalCheck(request: MsgSubmitProposalCheck): Promise<MsgSubmitProposalCheckResponse> {
    const data = MsgSubmitProposalCheck.encode(request).finish();
    const promise = this.rpc.request(this.service, "SubmitProposalCheck", data);
    return promise.then((data) => MsgSubmitProposalCheckResponse.decode(new BinaryReader(data)));
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
