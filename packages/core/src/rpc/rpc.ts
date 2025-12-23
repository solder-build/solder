import { createSolanaRpc } from "@solana/rpc";
import { fetchParsedBlock, buildBlockInfoResult } from "../utils/block";
import type {
  BlockInfoResult,
  BlockTransactionInfo,
  EventFilterOptions,
  InstructionFilterOptions,
} from "../types/block";

export type RpcClientOptions = {
  endpoint?: string;
  cluster?: "devnet" | "testnet" | "mainnet-beta";
  commitment?: "processed" | "confirmed" | "finalized";
  httpHeaders?: Record<string, string>;
};

// Aliases already imported from utils/block.ts

type BlockInfoOptions = {
  includeEvents?: boolean;
  includeInstructions?: boolean;
  eventFilter?: EventFilterOptions;
  instructionFilter?: InstructionFilterOptions;
} & (
  | {
      includeEvents: true;
      eventFilter: EventFilterOptions;
    }
  | {
      includeInstructions: true;
      instructionFilter: InstructionFilterOptions;
    }
  | {}
);

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
    transactions: Array<
      Omit<BlockTransactionInfo, "events">
    >;
  } | null> {
    const data = await this.getBlockInfo(slot, {
      includeEvents: false,
      includeInstructions: true,
      instructionFilter: (filter ?? { programIds: [] }) as InstructionFilterOptions,
    });
    if (!data) return null;

    return {
      block_number: data.block_number,
      block_hash: data.block_hash,
      block_time: data.block_time,
      transactions: data.transactions
        .filter((txn) => txn.instructions.length > 0)
        .map((txn) => ({
          block_number: txn.block_number,
          block_hash: txn.block_hash,
          block_ts: txn.block_ts,
          txn_hash: txn.txn_hash,
          instructions: txn.instructions,
        })),
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
    transactions: Array<
      Omit<BlockTransactionInfo, "instructions">
    >;
  } | null> {
    const data = await this.getBlockInfo(slot, {
      includeEvents: true,
      includeInstructions: false,
      eventFilter: filter,
    });
    if (!data) return null;

    return {
      block_number: data.block_number,
      block_hash: data.block_hash,
      block_time: data.block_time,
      transactions: data.transactions
        .filter((txn) => txn.events.length > 0)
        .map((txn) => ({
          block_number: txn.block_number,
          block_hash: txn.block_hash,
          block_ts: txn.block_ts,
          txn_hash: txn.txn_hash,
          events: txn.events,
        })),
    };
  }

  async getBlockInfo(
    slot: number,
    options: BlockInfoOptions = {}
  ): Promise<BlockInfoResult | null> {
    const includeEvents = options.includeEvents ?? true;
    const includeInstructions = options.includeInstructions ?? true;

    if (!includeEvents && !includeInstructions) {
      return {
        block_number: slot,
        block_hash: "",
        block_time: null,
        transactions: [],
      };
    }

    const { block, blockHash, blockTime } = await fetchParsedBlock(this.rpc, slot);

    if (!block || !blockHash) return null;

    return buildBlockInfoResult({
      block,
      slot,
      blockHash,
      blockTime,
      includeEvents,
      includeInstructions,
      eventFilter: options.eventFilter,
      instructionFilter: options.instructionFilter,
    });
  }
}

export type {
  BlockTransactionInfo,
  BlockInfoResult,
  EventFilterOptions,
  InstructionFilterOptions,
  EventInfo,
  InstructionInfo,
} from "../types/block";