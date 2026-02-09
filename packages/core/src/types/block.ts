import type { DecodedEvent } from "../idl/idl";

export type InstructionInfo = {
  index: number;
  programId: string;
  parsed: unknown;
};

/**
 * Source of the event:
 * - "cpi": Event emitted via emit_cpi! macro (instruction data)
 * - "log": Event emitted via emit! macro (program logs)
 */
export type EventSource = "cpi" | "log";

export type EventInfo = {
  index: number;
  programId: string;
  event: DecodedEvent;
  /** Source of the event - "cpi" for emit_cpi! or "log" for emit! */
  source: EventSource;
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

