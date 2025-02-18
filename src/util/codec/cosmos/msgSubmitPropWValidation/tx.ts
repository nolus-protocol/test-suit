/* eslint-disable */
import _m0, { BinaryReader, BinaryWriter } from "cosmjs-types/binary";
import { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin";
import { Any } from "cosmjs-types/google/protobuf/any";

export const protobufPackage = "cosmos.gov.v1";

export interface MsgSubmitPropWValidation {
  messages: Any[];
  initialDeposit: Coin[];
  proposer: string;
  metadata: string;
  summary: string;
  title: string;
  expedited: boolean;
}

export interface MsgSubmitPropWValidationResponse {
  proposalId: bigint;
}

function createBaseMsgSubmitPropWValidation(): MsgSubmitPropWValidation {
  return { messages: [], initialDeposit: [], proposer: "", metadata: "", summary: "", title: "", expedited: false};
}

export const  MsgSubmitPropWValidation = {
  encode(message: MsgSubmitPropWValidation, writer: _m0.BinaryWriter = BinaryWriter.create()): _m0.BinaryWriter {
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
    if (message.expedited === true) {
      writer.uint32(58).bool(message.expedited);
    }

    return writer;
  },

  decode(input: _m0.BinaryReader | Uint8Array, length?: number):  MsgSubmitPropWValidation {
    const reader = input instanceof _m0.BinaryReader ? input : new _m0.BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgSubmitPropWValidation();
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
        case 7:
          if (tag !== 58) {
            break;
          }

          message.expedited = reader.bool();
          continue;
      }

      if ((tag & 8) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 8);
    }
    return message;
  },

  fromJSON(object: any): MsgSubmitPropWValidation {
    const obj = createBaseMsgSubmitPropWValidation();
        if (Array.isArray(object?.messages))
            obj.messages = object.messages.map((e: any) => Any.fromJSON(e));
        if (Array.isArray(object?.initialDeposit))
            obj.initialDeposit = object.initialDeposit.map((e: any) => Coin.fromJSON(e));
        if (isSet(object.proposer))
            obj.proposer = String(object.proposer);
        if (isSet(object.metadata))
            obj.metadata = String(object.metadata);
        if (isSet(object.summary))
            obj.summary = String(object.summary);
        if (isSet(object.title))
            obj.title = String(object.title);
        if (isSet(object.expedited))
            obj.expedited=object.expedited;
        return obj;
  },

  toJSON(message: MsgSubmitPropWValidation): unknown {
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
        message.summary !== undefined && (obj.summary = message.summary);
        message.title !== undefined && (obj.title = message.title);
        message.expedited !== undefined && (obj.expedited = message.expedited);
        return obj;
  },

  create<I extends Exact<DeepPartial<MsgSubmitPropWValidation>, I>>(base?: I): MsgSubmitPropWValidation {
    return MsgSubmitPropWValidation.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<MsgSubmitPropWValidation>, I>>(object: I): MsgSubmitPropWValidation {
    const message = createBaseMsgSubmitPropWValidation();
    message.messages = object.messages?.map((e) => Any.fromPartial(e)) || [];
        message.initialDeposit = object.initialDeposit?.map((e) => Coin.fromPartial(e)) || [];
        message.proposer = object.proposer ?? "";
        message.metadata = object.metadata ?? "";
        message.summary = object.summary ?? "";
        message.title = object.title ?? "";
        message.expedited = object.expedited ?? false;
    return message;
  },
};

function createBaseMsgSubmitPropWValidationResponse(): MsgSubmitPropWValidationResponse {
  return { proposalId: BigInt(0) };
}

export const MsgSubmitPropWValidationResponse = {
  encode(message: MsgSubmitPropWValidationResponse, writer: _m0.BinaryWriter = new _m0.BinaryWriter()): _m0.BinaryWriter {
    if (message.proposalId !== BigInt(0)) {
      writer.uint32(8).uint64(message.proposalId);
  }
  return writer;
  },

  decode(input: _m0.BinaryReader | Uint8Array, length?: number): MsgSubmitPropWValidationResponse {
    const reader = input instanceof _m0.BinaryReader ? input : new _m0.BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgSubmitPropWValidationResponse();
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

  fromJSON(object: any): MsgSubmitPropWValidationResponse {
    const obj = createBaseMsgSubmitPropWValidationResponse();
        if (isSet(object.proposalId))
            obj.proposalId = BigInt(object.proposalId.toString());
        return obj;
  },

  toJSON(message: MsgSubmitPropWValidationResponse): unknown {
    const obj: any = {};
    message.proposalId !== undefined && (obj.proposalId = (message.proposalId || BigInt(0)).toString());
    return obj;
  },

  create<I extends Exact<DeepPartial<MsgSubmitPropWValidationResponse>, I>>(base?: I): MsgSubmitPropWValidationResponse {
    return MsgSubmitPropWValidationResponse.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<MsgSubmitPropWValidationResponse>, I>>(object: I): MsgSubmitPropWValidationResponse {
    const message = createBaseMsgSubmitPropWValidationResponse();
    if (object.proposalId !== undefined && object.proposalId !== null) {
      message.proposalId = BigInt(object.proposalId.toString());
  }
  return message;
  },
};

export interface Msg {
  SubmitPropWValidation(request: MsgSubmitPropWValidation): Promise<MsgSubmitPropWValidationResponse>;
}

export class MsgClientImpl implements Msg {
  private readonly rpc: Rpc;
  private readonly service: string;
  constructor(rpc: Rpc, opts?: { service?: string }) {
    this.service = opts?.service || 'cosmos.gov.v1';
    this.rpc = rpc;
    this.SubmitPropWValidation = this.SubmitPropWValidation.bind(this);
  }
  SubmitPropWValidation(request: MsgSubmitPropWValidation): Promise<MsgSubmitPropWValidationResponse> {
    const data = MsgSubmitPropWValidation.encode(request).finish();
    const promise = this.rpc.request(this.service, "SubmitPropWValidation", data);
    return promise.then((data) => MsgSubmitPropWValidationResponse.decode(new BinaryReader(data)));
  }
}

interface Rpc {
  request(service: string, method: string, data: Uint8Array): Promise<Uint8Array>;
}

type Builtin = Date | Function | Uint8Array | string | number | boolean | undefined;

export type DeepPartial<T> = T extends Builtin ? T
  : T extends number | string | bigint ? T
  : T extends Array<infer U> ? Array<DeepPartial<U>>
  : T extends ReadonlyArray<infer U> ? ReadonlyArray<DeepPartial<U>>
  : T extends {} ? { [K in keyof T]?: DeepPartial<T[K]> }
  : Partial<T>;

type KeysOfUnion<T> = T extends T ? keyof T : never;
export type Exact<P, I extends P> = P extends Builtin ? P
  : P & { [K in keyof P]: Exact<P[K], I[K]> } & { [K in Exclude<keyof I, KeysOfUnion<P>>]: never };

function isSet(value: any): boolean {
  return value !== null && value !== undefined;
}
