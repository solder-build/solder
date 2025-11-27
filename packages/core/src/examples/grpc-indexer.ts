import { GrpcIndexer } from "../indexer/grpc-indexer";
import type { GrpcIndexerConfig } from "../indexer/grpc-indexer";

import PumpFunIdl from './idl';

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

  const config: GrpcIndexerConfig = {
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

  const indexer = new GrpcIndexer(config);

  console.log("\n📡 Registering event handlers...");

  await indexer.onEvent({
    programId: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
    idl: PumpFunIdl,
    eventName: "TradeEvent",
    handler: async (event) => {
      const params = event.params;

      const isBuy = params.is_buy === true;
      
      console.log("\n" + "═".repeat(80));
      console.log(`🎯 ${isBuy ? "🟢 BUY" : "🔴 SELL"} TradeEvent`);
      console.log("─".repeat(80));
      console.log(`📍 Slot:        ${formatNumber(event.transaction.slot)}`);
      console.log(`🔐 Signature:   ${truncateAddress(event.transaction.hash)}`);
      console.log(`💎 Mint:        ${truncateAddress(params.mint)}`);
      console.log(`👤 User:        ${truncateAddress(params.user)}`);
      console.log(`💵 SOL Amount:  ${formatSOL(Number(params.sol_amount))}`);
      console.log(`🪙 Token Amount: ${formatNumber(Number(params.token_amount))}`);
      console.log(`💰 Fee:         ${formatSOL(Number(params.fee))} (${params.fee_basis_points} bps)`);
      if (params.creator_fee && Number(params.creator_fee) !== 0) {
        console.log(`🎨 Creator Fee: ${formatSOL(Number(params.creator_fee))} (${params.creator_fee_basis_points} bps)`);
      }
      console.log(`📊 Reserves:`);
      console.log(`   Real SOL:    ${formatSOL(Number(params.real_sol_reserves))}`);
      console.log(`   Real Token:  ${formatNumber(Number(params.real_token_reserves))}`);
      console.log(`   Virtual SOL: ${formatSOL(Number(params.virtual_sol_reserves))}`);
      console.log(`   Virtual Token: ${formatNumber(Number(params.virtual_token_reserves) )}`);
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

