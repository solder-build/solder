import type { PrimitiveConfig, FieldsToObject } from "./idl-types";

type DefaultPrimitives = PrimitiveConfig<
  import("@solana/web3.js").PublicKey,
  bigint,
  string,
  boolean,
  string
>;

// Legacy IDL shape definitions
export type LegacyIdlField = { name: string; type: any };

export type LegacyIdlAccount = {
  name: string;
  writable?: boolean;
  signer?: boolean;
  optional?: boolean;
  address?: string;
  pda?: {
    seeds: Array<{
      kind: "const" | "account" | "arg";
      value?: number[];
      path?: string;
      account?: string;
    }>;
  };
};

export type LegacyIdlInstruction = {
  name: string;
  discriminator?: number[];
  accounts: readonly LegacyIdlAccount[];
  args: readonly LegacyIdlField[];
};

export type LegacyIdlType = {
  name: string;
  type: {
    kind: "struct" | "enum";
    fields?: readonly LegacyIdlField[];
    variants?: readonly any[];
  };
};

export type LegacyIdl = {
  address?: string;
  name?: string;
  version?: string;
  metadata?: {
    name?: string;
    version?: string;
    spec?: string;
    address?: string;
  };
  instructions: readonly LegacyIdlInstruction[];
  accounts?: readonly { name: string; discriminator?: number[] }[];
  types?: readonly LegacyIdlType[];
  events?: readonly { name: string }[];
  errors?: readonly any[];
};

// Type extraction utilities
export type LegacyEventNames<IDL> = 
  IDL extends { events: readonly any[] }
    ? IDL["events"][number]["name"]
    : never;

export type LegacyInstructionNames<IDL> = 
  IDL extends { instructions: readonly any[] }
    ? IDL["instructions"][number]["name"]
    : never;

// Extract event type from events array
export type ExtractLegacyEvent<
  IDL extends { events: readonly any[] },
  Name extends string,
  P extends PrimitiveConfig = DefaultPrimitives
> = IDL["events"][number] extends infer T
  ? T extends { name: Name; fields: readonly LegacyIdlField[] }
    ? FieldsToObject<T["fields"], P>
    : never
  : never;

// Extract instruction args
export type ExtractLegacyInstructionArgs<
  IDL extends { instructions: readonly any[] },
  Name extends string,
  P extends PrimitiveConfig = DefaultPrimitives
> = IDL["instructions"][number] extends infer I
  ? I extends { name: Name; args: readonly LegacyIdlField[] }
    ? FieldsToObject<I["args"], P>
    : never
  : never;

// Main convenience types
export type LegacyEventType<
  IDL,
  Name extends LegacyEventNames<IDL>,
  P extends PrimitiveConfig = DefaultPrimitives
> = IDL extends { events: readonly any[] }
  ? ExtractLegacyEvent<IDL, Name & string, P>
  : never;

export type LegacyInstructionArgs<
  IDL,
  Name extends LegacyInstructionNames<IDL>,
  P extends PrimitiveConfig = DefaultPrimitives
> = IDL extends { instructions: readonly any[] }
  ? ExtractLegacyInstructionArgs<IDL, Name & string, P>
  : never;

// Account structure types
export type LegacyAccountMeta<Acc extends LegacyIdlAccount> = {
  name: Acc["name"];
  writable: Acc["writable"] extends true ? true : false;
  signer: Acc["signer"] extends true ? true : false;
  optional: Acc["optional"] extends true ? true : false;
};

export type LegacyInstructionAccounts<
  IDL extends { instructions: readonly any[] },
  Name extends string
> = IDL["instructions"][number] extends infer I
  ? I extends { name: Name; accounts: readonly LegacyIdlAccount[] }
    ? { [K in I["accounts"][number] as K["name"]]: LegacyAccountMeta<K> }
    : never
  : never;

// PDA seed type extraction
export type LegacyPdaSeed<Seed> = 
  Seed extends { kind: "const"; value: infer V } ? Uint8Array :
  Seed extends { kind: "account"; path: infer P } ? string :
  Seed extends { kind: "arg"; path: infer P } ? any :
  unknown;

// Discriminator utilities
export type LegacyInstructionDiscriminator<
  IDL extends { instructions: readonly any[] },
  Name extends string
> = IDL["instructions"][number] extends infer I
  ? I extends { name: Name; discriminator: infer D }
    ? D
    : never
  : never;

// Runtime helpers
export function asLegacyEventParams<IDL, N extends LegacyEventNames<IDL> & string>(
  _idl: IDL,
  _name: N,
  payload: unknown
) {
  return payload as LegacyEventType<IDL, N>;
}

export function asLegacyInstructionArgs<IDL, N extends LegacyInstructionNames<IDL> & string>(
  _idl: IDL,
  _name: N,
  payload: unknown
) {
  return payload as LegacyInstructionArgs<IDL, N>;
}
