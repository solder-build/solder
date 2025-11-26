import { GrpcIndexer, type GrpcIndexerConfig } from "../indexer/grpc-indexer";
import PumpFunIdl from "./idl";

/**
 * Example demonstrating the high-performance gRPC-based indexer
 * using Yellowstone for real-time Solana event streaming
 * 
 * Configuration:
 * - Set SOURCE_KIND to "grpc" or "fumarole" (default: "grpc")
 * - Set GRPC_ENDPOINT for your gRPC endpoint URL
 * - Set GRPC_TOKEN for your authentication token
 * - Set DATABASE_URL for PostgreSQL connection string
 * 
 * Defaults:
 * - sourceKind "grpc": Uses DragonMouth endpoint
 * - sourceKind "fumarole": Uses Fumarole endpoint
 */

async function main() {
  console.log("🚀 Starting Solder gRPC Indexer Example");

  // Determine source kind from environment or default to "grpc"
  const sourceKind = "fumarole";

  // Get configuration from environment or use defaults
  const grpcEndpoint = process.env.GRPC_ENDPOINT || "";
  const xToken = process.env.GRPC_TOKEN || "";
  const databaseUrl = process.env.DATABASE_URL || "postgresql://postgres:password123@127.0.0.1:6500/app";
  const fromSlot = process.env.FROM_SLOT ? parseInt(process.env.FROM_SLOT) : 382200000;

  if (!databaseUrl) {
    console.error("❌ DATABASE_URL is required (postgres connection string)");
    process.exit(1);
  }

  const config: GrpcIndexerConfig = {
    mode: "grpc",
    databaseUrl,
    grpcEndpoint,
    xToken,
    subscriberName: "solder-grpc-example",
    cursorKey: "grpc-indexer-example",
    sourceKind,
  };

  console.log("📝 Creating gRPC indexer with configuration:");
  console.log(`  - Source Kind: ${sourceKind}`);
  console.log(`  - Endpoint: ${grpcEndpoint}`);
  console.log(`  - Subscriber: ${config.subscriberName}`);
  if (fromSlot) {
    console.log(`  - From Slot: ${fromSlot}`);
  }
  console.log(`  - Database: ${databaseUrl ? "Enabled" : "Disabled"}`);

  const indexer = new GrpcIndexer(config);

  // Helper function to format numbers with commas
  const formatNumber = (value: string | number): string => {
    return BigInt(value).toLocaleString("en-US");
  };

  // Helper function to truncate addresses
  const truncateAddress = (address: string, start = 8, end = 8): string => {
    if (address.length <= start + end) return address;
    return `${address.slice(0, start)}...${address.slice(-end)}`;
  };

  // Helper function to format SOL (lamports to SOL)
  const formatSOL = (lamports: string | number): string => {
    const sol = Number(lamports) / 1e9;
    return `${sol.toLocaleString("en-US", { maximumFractionDigits: 4 })} SOL`;
  };

  console.log("\n📡 Registering event handlers...");

  await indexer.onEvent({
    programId: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
    idl: PumpFunIdl,
    eventName: "TradeEvent",
    handler: async (event) => {
      const params = (event as any).params;
      const isBuy = params.is_buy === true || params.is_buy === "true";
      
      console.log("\n" + "═".repeat(80));
      console.log(`🎯 ${isBuy ? "🟢 BUY" : "🔴 SELL"} TradeEvent`);
      console.log("─".repeat(80));
      console.log(`📍 Slot:        ${formatNumber(event.transaction.slot)}`);
      console.log(`🔐 Signature:   ${truncateAddress(event.transaction.hash)}`);
      console.log(`💎 Mint:        ${truncateAddress(params.mint)}`);
      console.log(`👤 User:        ${truncateAddress(params.user)}`);
      console.log(`💵 SOL Amount:  ${formatSOL(params.sol_amount)}`);
      console.log(`🪙 Token Amount: ${formatNumber(params.token_amount)}`);
      console.log(`💰 Fee:         ${formatSOL(params.fee)} (${params.fee_basis_points} bps)`);
      if (params.creator_fee && params.creator_fee !== "0") {
        console.log(`🎨 Creator Fee: ${formatSOL(params.creator_fee)} (${params.creator_fee_basis_points} bps)`);
      }
      console.log(`📊 Reserves:`);
      console.log(`   Real SOL:    ${formatSOL(params.real_sol_reserves)}`);
      console.log(`   Real Token:  ${formatNumber(params.real_token_reserves)}`);
      console.log(`   Virtual SOL: ${formatSOL(params.virtual_sol_reserves)}`);
      console.log(`   Virtual Token: ${formatNumber(params.virtual_token_reserves)}`);
      console.log("═".repeat(80));
    },
  });

  console.log("\n📡 Registering transaction handler...");

  await indexer.onTransaction({
    programId: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
    idl: PumpFunIdl,
    instructionNames: ["sell"],
    handler: async (transaction) => {
      console.log("\n" + "═".repeat(80));
      console.log("💸 Transaction Received");
      console.log("─".repeat(80));
      console.log(`🔐 Hash:        ${truncateAddress(transaction.hash)}`);
      console.log(`📍 Slot:        ${formatNumber(transaction.slot)}`);
      console.log(`📝 Instructions: ${transaction.data.instructions.length} (${transaction.data.instructions.map((ix: any) => ix.name).join(", ")})`);
      
      if (transaction.data.events && transaction.data.events.length > 0) {
        console.log(`\n📊 Events (${transaction.data.events.length}):`);
        transaction.data.events.forEach((ev: any, idx: number) => {
          const params = ev.params;
          const isBuy = params.is_buy === true || params.is_buy === "true";
          
          console.log(`\n  ${idx + 1}. ${ev.name}@${ev.index} ${isBuy ? "🟢 BUY" : "🔴 SELL"}`);
          console.log(`     💎 Mint:        ${truncateAddress(params.mint)}`);
          console.log(`     👤 User:        ${truncateAddress(params.user)}`);
          console.log(`     💵 SOL:         ${formatSOL(params.sol_amount)}`);
          console.log(`     🪙 Tokens:      ${formatNumber(params.token_amount)}`);
          console.log(`     💰 Fee:         ${formatSOL(params.fee)} (${params.fee_basis_points} bps)`);
          if (params.creator_fee && params.creator_fee !== "0") {
            console.log(`     🎨 Creator Fee: ${formatSOL(params.creator_fee)}`);
          }
        });
      } else {
        console.log(`\n📊 Events: (none)`);
      }
      console.log("═".repeat(80));
    },
  });

  console.log("\n✅ Handlers registered");
  console.log("📊 Monitoring programs:", indexer.getRegisteredProgramIds());
  console.log("🎯 Event handlers:", indexer.getEventHandlers().length);
  console.log("💸 Transaction handlers:", indexer.getTransactionHandlers().length);

  console.log("\n⚡ Starting gRPC stream...");
  console.log("   This uses Yellowstone for high-performance event streaming");
  console.log("   Press Ctrl+C to stop\n");

  try {
    await indexer.start();
  } catch (error) {
    console.error("❌ Indexer failed:", error);
    process.exit(1);
  }

  // Graceful shutdown handlers
  process.on("SIGINT", () => {
    console.log("\n🛑 Shutting down gRPC indexer...");
    indexer.stop();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("\n🛑 Shutting down gRPC indexer...");
    indexer.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("❌ Failed to start gRPC indexer", err);
  process.exit(1);
});

