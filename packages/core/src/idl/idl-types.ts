// Simple overridable primitives via generics (no module augmentation required)
import type { Idl } from "@coral-xyz/anchor";
import type { LegacyIdl } from "./legacy-idl-types";

export type PrimitiveConfig<
  PK = string,
  Int = bigint,
  Str = string,
  Bool = boolean,
  Bytes = string
> = {
  PublicKeyType: PK;
  IntegerType: Int;
  StringType: Str;
  BoolType: Bool;
  BytesType: Bytes;
};
type DefaultPrimitives = PrimitiveConfig;

type DeepReadonly<T> =
  T extends (...args: any[]) => any ? T :
  T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } :
  T;

export type ReadonlyIdl = DeepReadonly<Idl>;
export type AnchorIdl = Idl | ReadonlyIdl | LegacyIdl;

export function toMutableIdl(idl: AnchorIdl): Idl {
  return idl as Idl;
}

// Base mapping from Anchor IDL scalar types to TS types
export type IdlScalarToTs<T, P extends PrimitiveConfig = DefaultPrimitives> =
  T extends "string" ? P["StringType"] :
  T extends "bool" ? P["BoolType"] :
  // numeric-like -> prefer bigint (overridable)
  T extends "u8" | "u16" | "u32" | "u64" | "u128" | "u256" | "i8" | "i16" | "i32" | "i64" | "i128" | "i256" ? P["IntegerType"] :
  // PublicKey represented as base58 string by default (overridable)
  T extends "publicKey" ? P["PublicKeyType"] :
  T extends "pubkey" ? P["PublicKeyType"] :
  // bytes-like
  T extends "bytes" ? P["BytesType"] :
  unknown;

// Recursively resolve complex Anchor IDL types (option, vec, array, defined)
export type ResolveIdlType<T, P extends PrimitiveConfig = DefaultPrimitives> =
  // simple string type
  T extends string ? IdlScalarToTs<T, P> :
  // option
  T extends { option: infer O } ? ResolveIdlType<O, P> | null :
  // vec
  T extends { vec: infer V } ? ResolveIdlType<V, P>[] :
  // array
  T extends { array: [infer A, infer _Len] } ? ResolveIdlType<A, P>[] :
  // defined (custom struct/enum) -> unknown by default; user may specialize
  T extends { defined: string } ? unknown :
  // fallback
  unknown;

// IDL shapes (minimal) for typing
export type IdlField = { readonly name: string; readonly type: any };
type IdlStructDef = {
  readonly kind: "struct";
  readonly fields: readonly IdlField[];
};

type IdlEnumVariant = {
  readonly name: string;
  readonly fields?: readonly IdlField[];
};

type IdlEnumDef = {
  readonly kind: "enum";
  readonly variants: readonly IdlEnumVariant[];
};

type IdlTypeDefType = IdlStructDef | IdlEnumDef | { readonly kind: string };

export type IdlEvent = {
  readonly name: string;
  readonly fields?: readonly IdlField[];
  readonly type?: IdlTypeDefType;
};
export type IdlInstruction = { readonly name: string; readonly args: readonly IdlField[] };
export type IdlTypeDef = {
  readonly name: string;
  readonly type: IdlTypeDefType;
};
export type IdlLike = {
  events?: readonly IdlEvent[];
  instructions?: readonly IdlInstruction[];
  types?: readonly IdlTypeDef[];
};

// Unions of names for autocomplete
export type EventNames<IDL extends IdlLike> = IDL extends { events: readonly { name: infer N }[] } ? N : never;
export type InstructionNames<IDL> = IDL extends { instructions: readonly { name: infer N }[] } ? N : never;

// Given IDL-like "fields" array -> build an object { name: resolved-type }
export type FieldsToObject<Fields extends readonly IdlField[], P extends PrimitiveConfig = DefaultPrimitives> = {
  [K in Fields[number] as K["name"]]: ResolveIdlType<K["type"], P>
};

// Extract event by name from an Anchor IDL
type EventFieldsFromEvents<
  IDL extends IdlLike,
  Name extends string
> =
  IDL["events"] extends readonly IdlEvent[]
    ? Extract<IDL["events"][number], { name: Name }> extends { fields: readonly IdlField[] }
      ? Extract<IDL["events"][number], { name: Name }>["fields"]
      : Extract<IDL["events"][number], { name: Name }> extends { type: infer T }
        ? T extends { fields: readonly IdlField[] }
          ? T["fields"]
          : never
        : never
    : never;

type EventFieldsFromTypes<
  IDL extends IdlLike,
  Name extends string
> =
  IDL["types"] extends readonly IdlTypeDef[]
    ? Extract<IDL["types"][number], { name: Name }> extends { type: infer T }
      ? T extends { fields: readonly IdlField[] }
        ? T["fields"]
        : never
      : never
    : never;

type EventFieldArray<
  IDL extends IdlLike,
  Name extends string
> =
  EventFieldsFromEvents<IDL, Name> extends never
    ? EventFieldsFromTypes<IDL, Name>
    : EventFieldsFromEvents<IDL, Name>;

export type ExtractEvent<
  IDL extends IdlLike & { events: readonly IdlEvent[] },
  Name extends IDL["events"][number]["name"],
  P extends PrimitiveConfig = DefaultPrimitives
> =
  EventFieldArray<IDL, Name> extends readonly IdlField[]
    ? FieldsToObject<EventFieldArray<IDL, Name>, P>
    : {};

// Extract instruction args by instruction name from an Anchor IDL
export type ExtractInstructionArgs<
  IDL extends { instructions: readonly IdlInstruction[] },
  Name extends IDL["instructions"][number]["name"],
  P extends PrimitiveConfig = DefaultPrimitives
> =
  IDL["instructions"][number] extends infer I
    ? I extends { name: Name; args: readonly IdlField[] }
      ? FieldsToObject<I["args"], P>
      : never
    : never;

// Convenience aliases constrained by name unions for autocomplete
export type EventType<
  IDL extends AnchorIdl,
  Name extends EventNames<IDL> & string,
  P extends PrimitiveConfig = DefaultPrimitives
> =
  IDL extends { events: readonly IdlEvent[] }
    ? ExtractEvent<IDL, Extract<Name, IDL["events"][number]["name"] & string>, P>
    : never;

export type InstructionArgs<
  IDL extends IdlLike,
  Name extends InstructionNames<IDL> & string,
  P extends PrimitiveConfig = DefaultPrimitives
> =
  IDL extends { instructions: readonly IdlInstruction[] }
    ? ExtractInstructionArgs<IDL, Extract<Name, IDL["instructions"][number]["name"] & string>, P>
    : never;

// Runtime helper to tag a decoded payload with its inferred type without transforming it
export function asEventParams<IDL extends AnchorIdl, N extends EventNames<IDL> & string>(
  _idl: IDL,
  _name: N,
  payload: unknown
) {
  return payload as EventType<IDL, N>;
}

export type GenericInstructionPayload = {
  name: string;
  params: Record<string, unknown>;
};

export type InstructionPayload<IDL extends AnchorIdl> =
  InstructionNames<IDL> extends never
    ? GenericInstructionPayload
    : {
        [Name in InstructionNames<IDL> & string]: {
          name: Name;
          params: InstructionArgs<IDL, Name>;
        };
      }[InstructionNames<IDL> & string];

export type GenericEventPayload = {
  index: number;
  name: string;
  params: Record<string, unknown>;
};

export type EventPayload<IDL extends AnchorIdl> =
  EventNames<IDL> extends never
    ? GenericEventPayload
    : {
        [Name in EventNames<IDL> & string]: {
          index: number;
          name: Name;
          params: EventType<IDL, Name>;
        };
      }[EventNames<IDL> & string];

export type IdlTransaction<IDL extends AnchorIdl = AnchorIdl> = {
  hash: string;
  slot: number;
  blockTime: number | null;
  blockHash: string;
  data: {
    block_number: number;
    block_hash: string;
    block_ts: number | null;
    txn_hash: string;
    instructions: InstructionPayload<IDL>[];
    events: EventPayload<IDL>[];
  };
};


