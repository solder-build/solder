import {
  Connection,
  Commitment,
  Cluster,
  clusterApiUrl,
  ParsedBlockResponse,
  ParsedAccountsModeBlockResponse,
  ParsedInstruction,
  PartiallyDecodedInstruction,
  ParsedTransaction,
  ParsedTransactionMeta,
  PublicKey,
} from "@solana/web3.js";
import { decodeInstruction } from "./idl.js";

export type RpcClientOptions = {
  endpoint?: string;
  cluster?: Cluster;
  commitment?: Commitment;
  httpHeaders?: Record<string, string>;
};

type InstructionInfo = {
  index: number;
  programId: string;
  parsed: unknown;
};

type ProgramIdLike = string | PublicKey;

function normalizeProgramId(id: ProgramIdLike | undefined): string | undefined {
  if (!id) return undefined;
  if (typeof id === "string") return id;
  return id.toBase58();
}

type ParsedBlockTx =
  | NonNullable<ParsedBlockResponse["transactions"]>[number]
  | NonNullable<ParsedAccountsModeBlockResponse["transactions"]>[number];

function hasMessage(tx: ParsedBlockTx["transaction"]): tx is ParsedTransaction {
  return (tx as ParsedTransaction).message !== undefined;
}

export class RpcClient {
  private readonly connection: Connection;

  constructor(options: RpcClientOptions = {}) {
    const { endpoint, cluster = "devnet", commitment = "confirmed", httpHeaders } = options;
    const url = endpoint ?? clusterApiUrl(cluster);
    this.connection = new Connection(url, { commitment, httpHeaders });
  }

  getConnection(): Connection {
    return this.connection;
  }

  async getLatestBlockhash() {
    return this.connection.getLatestBlockhash();
  }

  async getSlot(commitment: Commitment = "confirmed") {
    return this.connection.getSlot(commitment);
  }

  async getBlockTime(slot: number) {
    return this.connection.getBlockTime(slot);
  }

  private _collectInstructionData(
    txn: { transaction: ParsedTransaction; meta: ParsedTransactionMeta },
    filter: { programIds: string[] }
  ): InstructionInfo[] {
    const meta = txn.meta;

    const transaction = txn.transaction;
    if (!meta || !transaction) return [];
    if (meta.err !== null && meta.err !== undefined) return [];

    const mainInstructions = transaction.message.instructions;
    const innerInstructions = (meta.innerInstructions ?? []).flatMap((inner) => inner.instructions);
    const all: Array<ParsedInstruction | PartiallyDecodedInstruction> = [
      ...mainInstructions,
      ...innerInstructions,
    ];

    const result: InstructionInfo[] = [];
    for (let i = 0; i < all.length; i++) {
      const programId = normalizeProgramId(
        (all[i] as ParsedInstruction | PartiallyDecodedInstruction).programId as ProgramIdLike
      );

      const instr = all[i];

      const parsedData = (instr as ParsedInstruction)?.parsed || decodeInstruction((instr as PartiallyDecodedInstruction)?.data, programId);

      if (programId && filter.programIds.includes(programId) && parsedData) {
        result.push({
          index: i + 1,
          programId,
          parsed: parsedData,
        });
      }
    }
    return result;
  }

  private _collectLogsData(meta: ParsedTransactionMeta, filter: { programIds: string[] }): string[] {
    return meta.logMessages ?? [];
  }

  async getBlockWithInstructions(
    slot: number,
    filter: { programIds: string[] }
  ): Promise<{
    block_number: number;
    block_hash: string;
    block_time: number | null;
    transactions: Array<{
      block_number: number;
      block_hash: string;
      block_ts: number | null;
      txn_hash: string | undefined;
      instructions: InstructionInfo[];
    }>;
  } | null> {
    const block: ParsedBlockResponse | ParsedAccountsModeBlockResponse | null = await this.connection.getParsedBlock(slot, {
      maxSupportedTransactionVersion: 0,
    });

    if (!block) return null;

    const blockHash = String(block.blockhash);
    const blockTime = block.blockTime ?? null;
    const transactions: Array<{
      block_number: number;
      block_hash: string;
      block_ts: number | null;
      txn_hash: string | undefined;
      instructions: InstructionInfo[];
      logs: string[];
    }> = [];

    
    for (const txn of block.transactions as ParsedBlockTx[]) {
      const signatures = txn.transaction.signatures;
      const signature = signatures[0];
      const instructions = hasMessage(txn.transaction)
        ? this._collectInstructionData(
            { transaction: txn.transaction, meta: txn.meta },
            filter
          )
        : [];

      if(!instructions.length) {
        continue
      }

      const logs = this._collectLogsData(txn.meta, filter);

      transactions.push({
        block_number: slot,
        block_hash: blockHash,
        block_ts: blockTime,
        txn_hash: signature,
        instructions,
        logs,
      });
    }

    return {
      block_number: slot,
      block_hash: blockHash,
      block_time: blockTime,
      transactions,
    };
  }
}

