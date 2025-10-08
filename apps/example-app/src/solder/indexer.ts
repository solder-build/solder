import { Indexer } from "@repo/core";
import { type Idl } from "@project-serum/anchor";
import pumpFunIdl from "../idls/pump-fun.json" with { type: "json" };

export const initializeIndexer = async () => {
  const indexer = new Indexer({
    startBlock: 300000000,
    rpcUrl: process.env.RPC_URL || "https://api.mainnet-beta.solana.com",
    databaseUrl:
      process.env.DATABASE_URL ||
      "postgresql://postgres:password123@127.0.0.1:6500/app",
    cursorKey: "my-indexer",
  });

  await indexer.onEvent({
    programId: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
    idl: pumpFunIdl as unknown as Idl,
    eventName: "TradeEvent",
    handler: async (event) => {
      console.log("Event parsed:", event);
    },
  });

  await indexer.start();

  return indexer;
};

export const stopIndexer = async (indexer: Indexer) => indexer.stop();
