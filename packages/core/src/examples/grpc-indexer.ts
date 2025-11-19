import { RustIndexer } from "../indexer/rust-indexer";
import type { RustIndexerConfig } from "../indexer/rust-indexer";

import PumpFunIdl from './idl';
import PumpFunLegacyIdl from "./legacy-idl";

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
  const grpcEndpoint = process.env.GRPC_ENDPOINT;
  const xToken = process.env.GRPC_TOKEN;
  const databaseUrl = process.env.DATABASE_URL;

  if (!grpcEndpoint || !xToken || !databaseUrl) {
    console.error("❌ Missing environment variables");
    console.error("  export GRPC_ENDPOINT=https://your-fumarole-endpoint.com");
    console.error("  export GRPC_TOKEN=your-auth-token");
    console.error("  export DATABASE_URL=postgresql://user:pass@localhost:5432/db");
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
      console.log("\n🎯 TradeEvent received:\n");
      console.log("  Event:", event.eventName);
      console.log("  Program:", event.programId);
      console.log("  Slot:", event.transaction.slot);
      console.log("  Signature:", event.transaction.hash);
      console.log("  Data:", JSON.stringify((event as any).params, null, 2));
    },
  });

  console.log("\n📡 Registering transaction handler...");
  
  await indexer.onTransaction({
    programId: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
    idl: PumpFunLegacyIdl,
    instructionNames: ["buy"],
    handler: async (transaction, db) => {
      console.log("\n💸 Transaction received:\n");
      console.log("  Hash:", transaction.hash);
      console.log("  Slot:", transaction.slot);
      console.log("  Instructions:", transaction.data.instructions.length);
      console.log("  Parsed Instructions:", transaction.data.instructions.map((ix: any) => ix.name).join(", "));

      if (transaction.data.events && transaction.data.events.length > 0) {
        console.log("  Parsed Events:");
        transaction.data.events.forEach((ev: any) => {
          console.log(`    - ${ev.name}@${ev.index}:`, JSON.stringify(ev.params, null, 4));
        });
      } else {
        console.log("  Parsed Events: (none)");
      }
    },
  });

  console.log("\n✅ Handlers registered");
  console.log("📊 Monitoring programs:", indexer.getRegisteredProgramIds());
  console.log("🎯 Event handlers:", indexer.getEventHandlers().length);
  console.log("💸 Transaction handlers:", indexer.getTransactionHandlers().length);
  
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

