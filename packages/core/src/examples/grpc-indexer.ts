import { GrpcIndexer, type GrpcIndexerConfig } from "../indexer/grpc-indexer";
import PumpFunIdl from "./idl";

const DEFAULT_ENDPOINT = "https://ultra.grpc.solanavibestation.com";
const DEFAULT_TOKEN = "3faf0bbdc35266fb50d6fa1a94ec6e98";

async function main() {
    const grpcEndpoint = DEFAULT_ENDPOINT;
    const xToken = DEFAULT_TOKEN;
    const databaseUrl = "postgresql://postgres:password123@127.0.0.1:6500/app";
    const startSlot = 382200000;

    if (!databaseUrl) {
    console.error("❌ DATABASE_URL is required (postgres connection string)");
    process.exit(1);
  }

  const config: GrpcIndexerConfig = {
    mode: "grpc",
    databaseUrl,
    grpcEndpoint,
    xToken,
    subscriberName: "solder-direct-grpc-demo",
    cursorKey: "direct-grpc-demo-3200",
    timeout: 120,
    sourceKind: "grpc",
    fromSlot: startSlot,
  };

  console.log("🌐 Connecting to DragonMouth endpoint");
  console.log(`  - grpcEndpoint: ${grpcEndpoint}`);
  console.log(`  - subscriberName: ${config.subscriberName}`);
  if (startSlot) {
    console.log(`  - startSlot: ${startSlot}`);
  }

  const indexer = new GrpcIndexer(config);

  await indexer.onEvent({
    programId: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
    idl: PumpFunIdl,
    eventName: "TradeEvent",
    handler: async (event) => {
      console.log("🎯 TradeEvent");
      console.log(`  slot: ${event.transaction.slot}`);
      console.log(`  signature: ${event.transaction.hash}`);
      console.log(`  params: ${JSON.stringify((event as any).params, null, 2)}`);
    },
  });

  await indexer.onTransaction({
    programId: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
    idl: PumpFunIdl,
    instructionNames: ["sell"],
    handler: async (tx) => {
      console.log("💸 Transaction");
      console.log(`  hash: ${tx.hash}`);
      console.log(`  slot: ${tx.slot}`);
      console.log(
        `  parsed events: ${(tx.data.events ?? [])
          .map((e: any) => `${e.name}@${e.index}`)
          .join(", ")}`,
      );
    },
  });

  await indexer.start();

  process.on("SIGINT", () => {
    console.log("🛑 Interrupt received, stopping indexer...");
    indexer.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("❌ Failed to start direct gRPC indexer", err);
  process.exit(1);
});

