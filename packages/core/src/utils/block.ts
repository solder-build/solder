import {
  ParsedAccountsModeBlockResponse,
  ParsedBlockResponse,
  ParsedInstruction,
  ParsedTransaction,
  ParsedTransactionMeta,
  PartiallyDecodedInstruction,
} from "@solana/web3.js";
import { createSolanaRpc } from "@solana/rpc";
import { fromLegacyPublicKey } from "@solana/compat";
import { decodeEvent, decodeInstruction } from "../idl/idl";
import type {
  BlockInfoResult,
  BlockTransactionInfo,
  EventFilterOptions,
  EventInfo,
  InstructionFilterOptions,
  InstructionInfo,
} from "../types/block";

export type ParsedBlockTx =
  | NonNullable<ParsedBlockResponse["transactions"]>[number]
  | NonNullable<ParsedAccountsModeBlockResponse["transactions"]>[number];

export function hasMessage(tx: ParsedBlockTx["transaction"]): tx is ParsedTransaction {
  return (tx as ParsedTransaction).message !== undefined;
}

type BlockLike = {
  transactions?: unknown;
};

type BuildTransactionsParams = {
  block: BlockLike;
  slot: number;
  blockHash: string;
  blockTime: number | null;
  includeEvents: boolean;
  includeInstructions: boolean;
  eventFilter?: EventFilterOptions;
  instructionFilter?: InstructionFilterOptions;
};

export function buildBlockTransactionsFromParsedBlock({
  block,
  slot,
  blockHash,
  blockTime,
  includeEvents,
  includeInstructions,
  eventFilter,
  instructionFilter,
}: BuildTransactionsParams): BlockTransactionInfo[] {
  const parsedTransactions = block.transactions as ParsedBlockTx[] | undefined;
  if (!parsedTransactions?.length) {
    return [];
  }

  const results: BlockTransactionInfo[] = [];

  for (const txn of parsedTransactions) {
    if (!txn?.transaction || !txn.meta) {
      continue;
    }

    const signatures = txn.transaction.signatures;
    const signature = signatures?.[0];
    const hasTxnMessage = hasMessage(txn.transaction);

    let events: EventInfo[] = [];

    if (includeEvents && eventFilter && hasTxnMessage) {
      events = collectWith<EventInfo>(
        { transaction: txn.transaction as ParsedTransaction, meta: txn.meta },
        eventFilter,
        ({ index, programId, instr }) => {
          if (isPartiallyDecodedInstruction(instr)) {
            const programIdl = eventFilter.programIdls?.get(programId);
            const decoded = decodeEvent(instr.data, programId, programIdl);
            return decoded ? { index, programId, event: decoded } : null;
          }
          return null;
        },
      );
    }

    let instructions: InstructionInfo[] = [];
    if (includeInstructions && hasTxnMessage) {
      const resolvedFilter = instructionFilter ?? { programIds: [] };
      instructions = collectWith<InstructionInfo>(
        { transaction: txn.transaction as ParsedTransaction, meta: txn.meta },
        resolvedFilter,
        ({ index, programId, instr }) => {
          if (isParsedInstruction(instr)) {
            return { index, programId, parsed: instr.parsed };
          }
          if (isPartiallyDecodedInstruction(instr) && resolvedFilter.programIdls) {
            const programIdl = resolvedFilter.programIdls.get(programId);
            const decoded = decodeInstruction(instr.data, programId, programIdl);
            return decoded == null ? null : { index, programId, parsed: decoded };
          }
          return null;
        },
      );
    }

    results.push({
      block_number: slot,
      block_hash: blockHash,
      block_ts: blockTime,
      txn_hash: signature,
      instructions: includeInstructions ? instructions : [],
      events: includeEvents ? events : [],
    });
  }

  return results;
}

export function buildBlockInfoResult(params: BuildTransactionsParams): BlockInfoResult {
  const transactions = buildBlockTransactionsFromParsedBlock(params);
  return {
    block_number: params.slot,
    block_hash: params.blockHash,
    block_time: params.blockTime,
    transactions,
  };
}

export function isParsedInstruction(
  instr: ParsedInstruction | PartiallyDecodedInstruction,
): instr is ParsedInstruction {
  return (instr as ParsedInstruction).parsed !== undefined;
}

export function isPartiallyDecodedInstruction(
  instr: ParsedInstruction | PartiallyDecodedInstruction,
): instr is PartiallyDecodedInstruction {
  return (
    (instr as PartiallyDecodedInstruction).data !== undefined &&
    (instr as any).parsed === undefined
  );
}

export async function fetchParsedBlock(
  rpc: ReturnType<typeof createSolanaRpc>,
  slot: number,
): Promise<{
  block: ParsedBlockResponse | ParsedAccountsModeBlockResponse | null;
  blockHash: string | null;
  blockTime: number | null;
}> {
  const response = await rpc.getBlock(BigInt(slot), {
    encoding: "jsonParsed",
    transactionDetails: "full",
    maxSupportedTransactionVersion: 0,
    rewards: false,
  }).send();

  if (!response) return { block: null, blockHash: null, blockTime: null };

  return {
    block: response as unknown as ParsedBlockResponse | ParsedAccountsModeBlockResponse,
    blockHash: response.blockhash,
    blockTime: response.blockTime ? Number(response.blockTime) : null,
  };
}

export function forEachInstruction(
  txn: { transaction: ParsedTransaction; meta: ParsedTransactionMeta },
  fn: (args: {
    index: number;
    programId: string;
    instr: ParsedInstruction | PartiallyDecodedInstruction;
  }) => void,
): void {
  const { transaction, meta } = txn;
  if (!meta || !transaction) return;
  if (meta.err !== null && meta.err !== undefined) return;
  const mainInstructions = transaction.message.instructions;
  const innerInstructions = (meta.innerInstructions ?? []).flatMap(
    (inner) => inner.instructions,
  );
  const all: Array<ParsedInstruction | PartiallyDecodedInstruction> = [
    ...mainInstructions,
    ...innerInstructions,
  ];
  for (let i = 0; i < all.length; i++) {
    const instr = all[i];
    if (!instr) continue;
    // Convert legacy PublicKey to string for compatibility
    const programId = typeof instr.programId === 'string'
      ? instr.programId
      : fromLegacyPublicKey(instr.programId);
    fn({ index: i + 1, programId, instr });
  }
}

export function collectWith<T>(
  txn: { transaction: ParsedTransaction; meta: ParsedTransactionMeta },
  filter: { programIds: string[] },
  mapper: (args: {
    index: number;
    programId: string;
    instr: ParsedInstruction | PartiallyDecodedInstruction;
  }) => T | null,
): T[] {
  const results: T[] = [];
  forEachInstruction(txn, ({ index, programId, instr }) => {
    if (filter.programIds.length > 0 && !filter.programIds.includes(programId)) return;
    const mapped = mapper({ index, programId, instr });
    if (mapped !== null) results.push(mapped);
  });
  return results;
}