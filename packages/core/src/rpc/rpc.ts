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

// For type narrowing on transactions array
type ParsedBlockTx = import("../utils/block").ParsedBlockTx;

function hasMessage(tx: ParsedBlockTx["transaction"]): tx is ParsedTransaction {
  return (tx as ParsedTransaction).message !== undefined;
}

// Aliases already imported from utils/block.ts

type EventFilterOptions = {
  programIds: string[];
  programIdls?: Map<string, any>;
};

type InstructionFilterOptions = {
  programIds: string[];
  programIdls?: Map<string, any>;
};

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

    const { block, blockHash, blockTime } = await fetchParsedBlock(
      this.rpc,
      slot,
    );
    if (!block || !blockHash) return null;

    const transactions: BlockTransactionInfo[] = [];

    for (const txn of block.transactions as ParsedBlockTx[]) {
      const signatures = txn.transaction.signatures;
      const signature = signatures[0];
      const hasTxnMessage = hasMessage(txn.transaction);

      let events: EventInfo[] = [];
      if (includeEvents && options.eventFilter && hasTxnMessage) {
        events = collectWith<EventInfo>(
          { transaction: txn.transaction as ParsedTransaction, meta: txn.meta! },
          options.eventFilter,
          ({ index, programId, instr }) => {
            if (isPartiallyDecodedInstruction(instr)) {
              const programIdl = options.eventFilter?.programIdls?.get(programId);
              const decoded = decodeEvent(instr.data, programId, programIdl);
              return decoded ? { index, programId, event: decoded } : null;
            }
            return null;
          },
        );
      }

      let instructions: InstructionInfo[] = [];
      if (includeInstructions && hasTxnMessage) {
        const instructionFilter = options.instructionFilter ?? { programIds: [] };
        instructions = collectWith<InstructionInfo>(
          { transaction: txn.transaction as ParsedTransaction, meta: txn.meta! },
          instructionFilter,
          ({ index, programId, instr }) => {
            if (isParsedInstruction(instr)) {
              return { index, programId, parsed: instr.parsed };
            }
            if (isPartiallyDecodedInstruction(instr) && instructionFilter.programIdls) {
              const programIdl = instructionFilter.programIdls.get(programId);
              const decoded = decodeInstruction(instr.data, programId, programIdl);
              return decoded == null ? null : { index, programId, parsed: decoded };
            }
            return null;
          },
        );
      }

      transactions.push({
        block_number: slot,
        block_hash: blockHash,
        block_ts: blockTime,
        txn_hash: signature,
        instructions: includeInstructions ? instructions : [],
        events: includeEvents ? events : [],
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