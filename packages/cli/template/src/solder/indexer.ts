import { Indexer, type IndexerEvent } from "@solder-build/core";
import { type Idl } from "@coral-xyz/anchor";
import pumpFunIdl from "../idls/pump-fun.json" with { type: "json" };
import { tradesTable } from "../../solder.schema.js";
import { PublicKey } from "@solana/web3.js";

export const initializeIndexer = async () => {
  /// configure your indexer here
  const indexer = new Indexer({
    startBlock: 300000000,
    rpcUrl: process.env.RPC_URL || "https://api.mainnet-beta.solana.com",
    databaseUrl:
      process.env.DATABASE_URL ||
      "postgresql://postgres:password123@127.0.0.1:6500/app",
    cursorKey: "my-indexer",
  });

  /// configure your event listeners here
  await indexer.onEvent({
    programId: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
    idl: pumpFunIdl,
    eventName: "TradeEvent",
    handler: async (
      event: {
        parsed: {
          mint: PublicKey;
          solAmount: bigint;
          tokenAmount: bigint;
          isBuy: boolean;
          user: PublicKey;
          timestamp: bigint;
          virtualSolReserves: bigint;
          virtualTokenReserves: bigint;
        };
      },
      db,
    ) => {
      await db.insert(tradesTable).values({
        mint: event.parsed.mint.toBase58(),
        solAmount: event.parsed.solAmount.toString(),
        tokenAmount: event.parsed.tokenAmount.toString(),
        isBuy: event.parsed.isBuy,
        user: event.parsed.user.toBase58(),
        virtualSolReserves: event.parsed.virtualSolReserves.toString(),
        virtualTokenReserves: event.parsed.virtualTokenReserves.toString(),
        timestamp: new Date(Number(event.parsed.timestamp) * 1000),
      });
    },
  });

  /// start the indexer
  await indexer.start();

  return indexer;
};

export const stopIndexer = async (indexer: Indexer) => indexer.stop();
