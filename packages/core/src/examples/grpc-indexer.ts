import { RustIndexer } from "../indexer/rust-indexer";
import type { RustIndexerConfig } from "../indexer/rust-indexer";

import PumpFunIdl from './idl';
import PumpFunLegacyIdl from './legacy-idl';

/**
 * Example demonstrating the high-performance gRPC-based indexer
 * using Yellowstone Vixen for real-time Solana event streaming
 * 
 * Prerequisites:
 * 1. Build the native addon: pnpm build:native
 * 2. Access to a Yellowstone Fumarole gRPC endpoint
 * 3. Set environment variables: GRPC_ENDPOINT, GRPC_TOKEN, DATABASE_URL
 */
async function main() {
  console.log("🚀 Starting Solder gRPC Indexer Example (Rust/Yellowstone)");

  // Validate environment variables
  const grpcEndpoint = "https://solder-solanam-6597.mainnet.rpcpool.com";
  const xToken = "0dd351ec-3106-48dd-946b-acd8e9d5c38c";
  const databaseUrl = "postgresql://postgres:password123@127.0.0.1:6500/app";

  if (!grpcEndpoint) {
    console.error("❌ Missing GRPC_ENDPOINT environment variable");
    console.log("\nExample:");
    console.log("  export GRPC_ENDPOINT=https://your-fumarole-endpoint.com");
    console.log("  export GRPC_TOKEN=your-auth-token");
    console.log("  export DATABASE_URL=postgresql://user:pass@localhost:5432/db");
    process.exit(1);
  }

  if (!databaseUrl) {
    console.error("❌ Missing DATABASE_URL environment variable");
    console.log("\nExample:");
    console.log("  export DATABASE_URL=postgresql://user:pass@localhost:5432/db");
    process.exit(1);
  }

  const config: RustIndexerConfig = {
    mode: 'grpc',
    databaseUrl,
    grpcEndpoint,
    xToken,
    subscriberName: 'solder-grpc-example',
    cursorKey: 'grpc-indexer-example',
  };

  console.log("📝 Creating gRPC indexer with configuration:");
  console.log(`  - Mode: ${config.mode}`);
  console.log(`  - Endpoint: ${config.grpcEndpoint}`);
  console.log(`  - Commitment: ${config.commitmentLevel}`);
  console.log(`  - Database: ${databaseUrl ? 'Enabled' : 'Disabled'}`);

  const indexer = new RustIndexer(config);

  console.log("\n📡 Registering event handlers...");
  
  await indexer.onEvent({
    programId: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
    idl: PumpFunIdl,
    eventName: "TradeEvent",
    handler: async (event) => {
      console.log("\n🎯 TradeEvent received:");
      console.log("  Event:", event.eventName);
      console.log("  Program:", event.programId);
      console.log("  Slot:", event.transaction.slot);
      console.log("  Signature:", event.transaction.hash);
      console.log("  Data:", JSON.stringify(event.parsed, null, 2));      
      // If database is configured, you can insert data here
      // await db.insert(tradesTable).values({ ... });
    },
  });

  console.log("\n✅ Event handlers registered");
  console.log("📊 Monitoring programs:", indexer.getRegisteredProgramIds());
  console.log("🎯 Event handlers:", indexer.getEventHandlers().length);
  
  console.log("\n⚡ Starting gRPC stream...");
  console.log("   This uses Yellowstone Vixen for high-performance event streaming");
  console.log("   Press Ctrl+C to stop\n");

  try {
    await indexer.start();
  } catch (error) {
    console.error("❌ Indexer failed:", error);
    process.exit(1);
  }

  // Graceful shutdown handlers
  process.on('SIGINT', () => {
    console.log("\n🛑 Shutting down gRPC indexer...");
    indexer.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log("\n🛑 Shutting down gRPC indexer...");
    indexer.stop();
    process.exit(0);
  });
}

main().catch(console.error);

