import { Indexer } from "../indexer/indexer";
import PumpFunIdl from "./idl";

/**
 * Simple example of using the Solder indexer with type-safe event handling
 */
async function main() {
  console.log("🚀 Starting Solder Indexer Example");

  const indexer = new Indexer({
    startBlock: 384234500,
    rpcUrl: "https://solder-solanam-6597.mainnet.rpcpool.com/3b46c479-63d2-4713-8555-49171bd416eb",
    databaseUrl: "postgresql://postgres:password123@127.0.0.1:6500/app",
    cursorKey: "my-indexer-2",
    enableUIProgress: true,
  });

  console.log("📝 Registering event handlers...");
  
  await indexer.onEvent({
    programId: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
    idl: PumpFunIdl,
    eventName: "TradeEvent",
    handler: async (event) => {
      console.log("Event parsed:", event);
    },
  });

  console.log("📡 Starting indexer...");
  console.log("📊 Monitoring programs:", indexer.getRegisteredProgramIds());
  console.log("🎯 Event handlers registered:", indexer.getEventHandlers().length);
  
  try {
    await indexer.start();
  } catch (error) {
    console.error("❌ Indexer failed:", error);
    process.exit(1);
  }

  process.on('SIGINT', () => {
    console.log("\n🛑 Shutting down indexer...");
    indexer.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log("\n🛑 Shutting down indexer...");
    indexer.stop();
    process.exit(0);
  });
}

main().catch(console.error);
