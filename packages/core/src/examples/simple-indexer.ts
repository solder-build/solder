import { Indexer } from "../indexer/indexer";
import PumpFunIdl from "./idl";

// Helper function to format numbers with commas
const formatNumber = (value: string | number): string => {
  return BigInt(value).toLocaleString("en-US");
};

// Helper function to truncate addresses
const truncateAddress = (address: string | { toString(): string }, start = 8, end = 8): string => {
  const addressStr = typeof address === 'string' ? address : address.toString();
  if (addressStr.length <= start + end) return addressStr;
  return `${addressStr.slice(0, start)}...${addressStr.slice(-end)}`;
};

// Helper function to format SOL (lamports to SOL)
const formatSOL = (lamports: string | number): string => {
  const sol = Number(lamports) / 1e9;
  return `${sol.toLocaleString("en-US", { maximumFractionDigits: 4 })} SOL`;
};

/**
 * Simple example of using the Solder indexer with type-safe event handling
 */
async function main() {
  console.log("🚀 Starting Solder Indexer Example");

  const indexer = new Indexer({
    startBlock: 385809526,
    rpcUrl: "https://solder-solanam-6597.mainnet.rpcpool.com/3b46c479-63d2-4713-8555-49171bd416eb",
    databaseUrl: "postgresql://postgres:password123@127.0.0.1:6500/app",
    cursorKey: "my-indexer-2",
    wsUrl: "wss://solder-solanam-6597.mainnet.rpcpool.com/3b46c479-63d2-4713-8555-49171bd416eb/whirligig",
  });

  console.log("📝 Registering event handlers...");
  
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
