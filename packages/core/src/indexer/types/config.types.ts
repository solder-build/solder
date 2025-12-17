import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type {
  AnchorIdl,
  EventType,
  InstructionNames,
} from "../../idl/idl-types";
import type { LegacyEventType, LegacyIdl } from "../../idl/legacy-idl-types";
import type { Logger } from "../../utils/logger";

export interface WebsocketConfig {
  url: string;
}

export interface IndexerConfig {
  startBlock: number;
  rpcUrl: string;
  wsUrl: string;
  databaseUrl: string; 
  cursorKey?: string; 
  enableUIProgress?: boolean;
  logger?: Logger;
}

export interface RegisteredProgram {
  programId: string;
  eventTypes: string[];
  idl: AnchorIdl; 
}

export interface EventHandler<
  TIdl extends AnchorIdl = AnchorIdl,
  TEventName extends ExtractEventNames<TIdl> = ExtractEventNames<TIdl>,
> {
  id: string;
  programId: string;
  idl: TIdl;
  eventName: string;
  handler: (
    event: IndexerEvent<TIdl, TEventName>,
    db: NodePgDatabase<Record<string, never>> & { $client: Pool },
  ) => Promise<void> | void;
}

export interface OnEventConfig<
  TIdl extends AnchorIdl = AnchorIdl,
  TEventName extends ExtractEventNames<TIdl> = ExtractEventNames<TIdl>,
> {
  programId: string;
  idl: TIdl;
  eventName: TEventName;
  handler: (
    event: IndexerEvent<TIdl, TEventName>,
    db: NodePgDatabase<Record<string, never>> & { $client: Pool },
  ) => Promise<void> | void;
}

export interface IndexerTransaction {
  hash: string;
  slot: number;
  blockTime: number | null;
  blockHash: string;
  instructions: Array<{
    index: number;
    programId: string;
    parsed: unknown;
  }>;
}

export interface TransactionHandler<TIdl extends AnchorIdl = AnchorIdl> {
  id: string;
  programId: string;
  idl?: TIdl;
  instructionNames?: string[];
  handler: (
    transaction: IndexerTransaction,
    db: NodePgDatabase<Record<string, never>> & { $client: Pool },
  ) => Promise<void> | void;
}

export interface OnTransactionConfig<
  TIdl extends AnchorIdl = AnchorIdl,
  TInstructionName extends InstructionNames<TIdl> & string = InstructionNames<TIdl> & string,
> {
  programId: string;
  idl?: TIdl;
  instructionNames?: TInstructionName[];
  handler: (
    transaction: IndexerTransaction,
    db: NodePgDatabase<Record<string, never>> & { $client: Pool },
  ) => Promise<void> | void;
}

export type ExtractEventNames<TIdl extends AnchorIdl> =
  [TIdl] extends [LegacyIdl]
    ? TIdl extends { events?: readonly { name: infer TName }[] }
      ? TName extends string
        ? TName
        : never
      : never
    : TIdl extends { events?: readonly { name: infer TName }[] }
      ? TName extends string
        ? TName
        : never
      : never;

export type ExtractEventData<
  TIdl extends AnchorIdl,
  TEventName extends ExtractEventNames<TIdl>,
> = TIdl extends { events: infer TEvents }
  ? TEvents extends readonly any[]
    ? TEvents[number] extends { name: TEventName; fields: infer TFields }
      ? TFields
      : never
    : never
  : never;

type EventPayload<
  TIdl extends AnchorIdl,
  TEventName extends ExtractEventNames<TIdl>
> = TIdl extends LegacyIdl
  ? LegacyEventType<TIdl, TEventName & string>
  : TIdl extends AnchorIdl
    ? EventType<TIdl, TEventName>
    : never;

export interface IndexerEvent<
  TIdl extends AnchorIdl = AnchorIdl,
  TEventName extends ExtractEventNames<TIdl> = ExtractEventNames<TIdl>,
> {
  params: EventPayload<TIdl, TEventName>;
  timestamp: string;
  transaction: {
    hash: string;
    slot: number;
    blockTime: number;
  };
  programId: string;
  eventName: TEventName;
}
