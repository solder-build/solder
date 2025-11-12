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

export type ParsedBlockTx =
  | NonNullable<ParsedBlockResponse["transactions"]>[number]
  | NonNullable<ParsedAccountsModeBlockResponse["transactions"]>[number];

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
    maxSupportedTransactionVersion: 0,
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
