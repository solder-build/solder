import type { DecodedEvent } from "../idl/idl";

export type InstructionInfo = {
  index: number;
  programId: string;
  parsed: unknown;
};

export type EventInfo = {
  index: number;
  programId: string;
  event: DecodedEvent;
};

export type BlockTransactionInfo = {
  block_number: number;
  block_hash: string;
  block_ts: number | null;
  txn_hash: string | undefined;
  instructions: InstructionInfo[];
  events: EventInfo[];
};

export type BlockInfoResult = {
  block_number: number;
  block_hash: string;
  block_time: number | null;
  transactions: BlockTransactionInfo[];
};

export type EventFilterOptions = {
  programIds: string[];
  programIdls?: Map<string, any>;
};

export type InstructionFilterOptions = {
  programIds: string[];
  programIdls?: Map<string, any>;
};

