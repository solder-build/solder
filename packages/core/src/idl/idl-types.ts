// Simple overridable primitives via generics (no module augmentation required)
import type { Idl } from "@coral-xyz/anchor";

export type PrimitiveConfig<
  PK = import("@solana/web3.js").PublicKey,
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

// Default primitives for Anchor IDLs - use PublicKey for pubkey types
type DefaultPrimitives = PrimitiveConfig<
  import("@solana/web3.js").PublicKey,
  bigint,
  string,
  boolean,
  string
>;

type DeepReadonly<T> =
  T extends (...args: any[]) => any ? T :
  T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } :
  T;

export type ReadonlyIdl = DeepReadonly<Idl>;
export type AnchorIdl = Idl | ReadonlyIdl;

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
  T extends "pubkey" | "publicKey" ? P["PublicKeyType"] :
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
export type IdlField = { name: string; type: any, discriminator?: number[] };
export type IdlEvent = { name: string; fields: readonly IdlField[], discriminator?: number[] };
export type IdlInstruction = { name: string; args: readonly IdlField[], discriminator?: number[]  };
export type IdlLike = {
  events?: readonly IdlEvent[];
  instructions?: readonly IdlInstruction[];
  types?: readonly IdlTypeDef[];
};

// Unions of names for autocomplete
export type EventNames<IDL> = IDL extends { events: readonly any[] }
  ? IDL["events"][number]["name"]
  : never;
export type InstructionNames<IDL> = IDL extends { instructions: readonly any[] }
  ? IDL["instructions"][number]["name"]
  : never;

// Given IDL-like "fields" array -> build an object { name: resolved-type }
export type FieldsToObject<Fields extends readonly IdlField[], P extends PrimitiveConfig = DefaultPrimitives> = {
  [K in Fields[number] as K["name"]]: ResolveIdlType<K["type"], P>
};

// Extract event by name from an Anchor IDL
// Events are defined in the "events" array, but their type definitions are in the "types" array
// We need to find the type in "types" that matches the event name
/**
 * Extracts the type of an event by name from an Anchor IDL.
 * Events are listed in IDL["events"], but their field structures are typically specified in IDL["types"].
 * 
 * - The IDL["events"] array contains objects with a "name": string.
 * - The IDL["types"] array contains struct definitions, which may match event names.
 * 
 * Example: 
 *  - In blueshift_anchor_escrow.ts and pump-fun.ts, there are event entries like:
 *    { name: "TakeEvent", discriminator: [...] } in "events" and
 *    { name: "TakeEvent", type: { kind: "struct", fields: [...] } } in "types".
 *  - This utility gets the field mapping for a given event or returns never if not found.
 * 
 * Note: Prefer extracting from "types" as that's where event field shapes reside.
 */
// Helper to extract fields from a single type entry (distributive)
type ExtractFieldsFromType<T, Name extends string, P extends PrimitiveConfig> =
  T extends { name: Name; type: { kind: "struct"; fields: infer Fields } }
    ? Fields extends readonly IdlField[]
      ? FieldsToObject<Fields, P>
      : never
    : never;

export type ExtractEvent<
  IDL, 
  Name extends string, 
  P extends PrimitiveConfig = DefaultPrimitives
> =
  IDL extends { types: readonly any[] }
    ? ExtractFieldsFromType<IDL["types"][number], Name, P>
    : never;

// Extract instruction args by instruction name from an Anchor IDL
export type ExtractInstructionArgs<IDL, Name extends string, P extends PrimitiveConfig = DefaultPrimitives> =
  IDL extends { instructions: readonly any[] }
    ? IDL["instructions"][number] extends infer I
      ? I extends { name: Name; args: readonly IdlField[] }
        ? FieldsToObject<I["args"], P>
        : never
      : never
    : never;

// Convenience aliases constrained by name unions for autocomplete
export type EventType<
  IDL,
  Name extends EventNames<IDL>,
  P extends PrimitiveConfig = DefaultPrimitives
> = ExtractEvent<IDL, Name & string, P>;

export type InstructionArgs<IDL, Name extends InstructionNames<IDL>, P extends PrimitiveConfig = DefaultPrimitives> =
  ExtractInstructionArgs<IDL, Name & string, P>;

// Runtime helper to tag a decoded payload with its inferred type without transforming it
export function asEventParams<
  IDL,
  N extends EventNames<IDL>
>(
  _idl: IDL,
  _name: N,
  payload: unknown
) {
  return payload as EventType<IDL, N>;
}


