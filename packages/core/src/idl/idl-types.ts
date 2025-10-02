// Simple overridable primitives via generics (no module augmentation required)
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

// Base mapping from Anchor IDL scalar types to TS types
export type IdlScalarToTs<T, P extends PrimitiveConfig = DefaultPrimitives> =
  T extends "string" ? P["StringType"] :
  T extends "bool" ? P["BoolType"] :
  // numeric-like -> prefer bigint (overridable)
  T extends "u8" | "u16" | "u32" | "u64" | "u128" | "u256" | "i8" | "i16" | "i32" | "i64" | "i128" | "i256" ? P["IntegerType"] :
  // PublicKey represented as base58 string by default (overridable)
  T extends "publicKey" ? P["PublicKeyType"] :
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
export type IdlField = { name: string; type: any };
export type IdlEvent = { name: string; fields: readonly IdlField[] };
export type IdlInstruction = { name: string; args: readonly IdlField[] };
export type IdlLike = {
  events?: readonly IdlEvent[];
  instructions?: readonly IdlInstruction[];
};

// Unions of names for autocomplete
export type EventNames<IDL> = IDL extends { events: readonly { name: infer N }[] } ? N : never;
export type InstructionNames<IDL> = IDL extends { instructions: readonly { name: infer N }[] } ? N : never;

// Given IDL-like "fields" array -> build an object { name: resolved-type }
export type FieldsToObject<Fields extends readonly IdlField[], P extends PrimitiveConfig = DefaultPrimitives> = {
  [K in Fields[number] as K["name"]]: ResolveIdlType<K["type"], P>
};

// Extract event by name from an Anchor IDL
export type ExtractEvent<IDL extends { events: readonly any[] }, Name extends IDL["events"][number]["name"], P extends PrimitiveConfig = DefaultPrimitives> =
  IDL["events"][number] extends infer E
    ? E extends { name: Name; fields: readonly IdlField[] }
      ? FieldsToObject<E["fields"], P>
      : never
    : never;

// Extract instruction args by instruction name from an Anchor IDL
export type ExtractInstructionArgs<IDL extends { instructions: readonly any[] }, Name extends IDL["instructions"][number]["name"], P extends PrimitiveConfig = DefaultPrimitives> =
  IDL["instructions"][number] extends infer I
    ? I extends { name: Name; args: readonly IdlField[] }
      ? FieldsToObject<I["args"], P>
      : never
    : never;

// Convenience aliases constrained by name unions for autocomplete
export type EventType<IDL, Name extends EventNames<IDL> & string, P extends PrimitiveConfig = DefaultPrimitives> =
  IDL extends { events: readonly any[] }
    ? ExtractEvent<IDL, Extract<Name, IDL["events"][number]["name"] & string>, P>
    : never;

export type InstructionArgs<IDL, Name extends InstructionNames<IDL> & string, P extends PrimitiveConfig = DefaultPrimitives> =
  IDL extends { instructions: readonly any[] }
    ? ExtractInstructionArgs<IDL, Extract<Name, IDL["instructions"][number]["name"] & string>, P>
    : never;

// Runtime helper to tag a decoded payload with its inferred type without transforming it
export function asEventParams<IDL, N extends EventNames<IDL> & string>(
  _idl: IDL,
  _name: N,
  payload: unknown
) {
  return payload as EventType<IDL, N>;
}


