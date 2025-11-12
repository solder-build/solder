import { ParsedTransaction } from "@solana/web3.js";
import { createSolanaRpc } from "@solana/rpc";
import { fromLegacyPublicKey } from "@solana/compat";
import { DecodedEvent, decodeEvent, decodeInstruction } from "../idl/idl";
import { collectWith, fetchParsedBlock, isParsedInstruction, isPartiallyDecodedInstruction } from "../utils/block";

export type RpcClientOptions = {
  endpoint?: string;
  cluster?: "devnet" | "testnet" | "mainnet-beta";
  commitment?: "processed" | "confirmed" | "finalized";
  httpHeaders?: Record<string, string>;
};

type InstructionInfo = {
  index: number;
  programId: string;
  parsed: unknown;
};

type EventInfo = {
  index: number;
  programId: string;
  event: DecodedEvent;
};

// For type narrowing on transactions array
type ParsedBlockTx = import("../utils/block").ParsedBlockTx;

function hasMessage(tx: ParsedBlockTx["transaction"]): tx is ParsedTransaction {
  return (tx as ParsedTransaction).message !== undefined;
}

// Aliases already imported from utils/block.ts

export class RpcClient {
  private readonly rpc: ReturnType<typeof createSolanaRpc>;

  constructor(options: RpcClientOptions = {}) {
    const {
      endpoint,
      cluster = "devnet",
      commitment = "confirmed",
      httpHeaders,
    } = options;
    
    let url: string;
    if (endpoint) {
      url = endpoint;
    } else {
      // Map cluster to URL
      switch (cluster) {
        case "devnet":
          url = "https://api.devnet.solana.com";
          break;
        case "testnet":
          url = "https://api.testnet.solana.com";
          break;
        case "mainnet-beta":
          url = "https://api.mainnet-beta.solana.com";
          break;
        default:
          url = "https://api.devnet.solana.com";
      }
    }
    
    this.rpc = createSolanaRpc(url);
  }

  getConnection(): ReturnType<typeof createSolanaRpc> {
    return this.rpc;
  }

  async getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: bigint }> {
    const response = await this.rpc.getLatestBlockhash().send();
    return response.value;
  }

  async getSlot(commitment: "processed" | "confirmed" | "finalized" = "confirmed"): Promise<bigint> {
    const response = await this.rpc.getSlot({ commitment }).send();
    return response;
  }

  async getBlockTime(slot: number): Promise<number | null> {
    const response = await this.rpc.getBlockTime(BigInt(slot)).send();
    return response ? Number(response) : null;
  }

  // --- Shared helpers are in utils/block.ts ---

  async getBlockWithInstructions(
    slot: number,
    filter?: { 
      programIds: string[];
      programIdls?: Map<string, any>;
    }
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
    const { block, blockHash, blockTime } = await fetchParsedBlock(
      this.rpc,
      slot,
    );
    if (!block || !blockHash) return null;
    const transactions: Array<{
      block_number: number;
      block_hash: string;
      block_ts: number | null;
      txn_hash: string | undefined;
      instructions: InstructionInfo[];
    }> = [];

    for (const txn of block.transactions as ParsedBlockTx[]) {
      const signatures = txn.transaction.signatures;
      const signature = signatures[0];
      const instructions = hasMessage(txn.transaction)
        ? collectWith<InstructionInfo>(
            { transaction: txn.transaction, meta: txn.meta! },
            filter ?? { programIds: [] },
            ({ index, programId, instr }) => {
              if (isParsedInstruction(instr)) {
                return { index, programId, parsed: instr.parsed };
              }
              if (isPartiallyDecodedInstruction(instr) && filter?.programIdls) {
                // Use program-specific IDL if provided
                const programIdl = filter.programIdls?.get(programId);
                const decoded = decodeInstruction(instr.data, programId, programIdl);
                return decoded == null ? null : { index, programId, parsed: decoded };
              }
              return null;
            },
          )
        : [];

      if (!instructions.length) {
        continue;
      }

      transactions.push({
        block_number: slot,
        block_hash: blockHash,
        block_ts: blockTime,
        txn_hash: signature,
        instructions,
      });
    }

    return {
      block_number: slot,
      block_hash: blockHash,
      block_time: blockTime,
      transactions,
    };
  }

  async getBlockWithEvents(
    slot: number,
    filter: { 
      programIds: string[];
      programIdls?: Map<string, any>;
    }
  ): Promise<{
    block_number: number;
    block_hash: string;
    block_time: number | null;
    transactions: Array<{
      block_number: number;
      block_hash: string;
      block_ts: number | null;
      txn_hash: string | undefined;
      events: EventInfo[];
    }>;
  } | null> {
    const { block, blockHash, blockTime } = await fetchParsedBlock(
      this.rpc,
      slot,
    );
    if (!block || !blockHash) return null;
    const transactions: Array<{
      block_number: number;
      block_hash: string;
      block_ts: number | null;
      txn_hash: string | undefined;
      events: EventInfo[];
    }> = [];

    for (const txn of block.transactions as ParsedBlockTx[]) {
      const signatures = txn.transaction.signatures;
      const signature = signatures[0];
      const events = hasMessage(txn.transaction)
        ? collectWith<EventInfo>(
            { transaction: txn.transaction, meta: txn.meta! },
            filter,
            ({ index, programId, instr }) => {
              if (isPartiallyDecodedInstruction(instr)) {
                const programIdl = filter.programIdls?.get(programId);
                const decoded = decodeEvent(instr.data, programId, programIdl);
                return decoded ? { index, programId, event: decoded } : null;
              }
              return null;
            },
          )
        : [];

      if (!events.length) continue;

      transactions.push({
        block_number: slot,
        block_hash: blockHash,
        block_ts: blockTime,
        txn_hash: signature,
        events,
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
