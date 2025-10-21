---
sidebar_position: 2
---

# Indexer Instance Documentation

The `Indexer` class is the core component for monitoring Solana blockchain events and processing them into your database.

## Creating an Indexer

```typescript
import { Indexer } from "@solder-build/core";

const indexer = new Indexer({
  startBlock: 300000000, // Starting slot number
  rpcUrl: process.env.RPC_URL, // Solana RPC endpoint
  databaseUrl: process.env.DATABASE_URL, // PostgreSQL connection string
  cursorKey: "my-indexer", // Unique identifier for this indexer
  enableUIProgress: true, // Enable real-time progress UI
});
```

## Configuration Options

| Option        | Type     | Required | Description                                             |
| ------------- | -------- | -------- | ------------------------------------------------------- |
| `startBlock`  | `number` | Yes      | Slot number to start indexing from                      |
| `rpcUrl`      | `string` | Yes      | Solana RPC endpoint URL                                 |
| `databaseUrl` | `string` | No       | PostgreSQL connection string (required for persistence) |
| `cursorKey`   | `string` | No       | Unique key for cursor storage (defaults to "default")   |

## Registering Event Handlers

Use the `onEvent` method to register handlers for specific program events:

```typescript
import { type Idl } from "@coral-xyz/anchor";
import pumpFunIdl from "./idls/pump-fun.json";

await indexer.onEvent({
  programId: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  idl: pumpFunIdl as Idl,
  eventName: "TradeEvent",
  handler: async (event, db) => {
    // Process the event
    await db.insert(tradesTable).values({
      mint: event.parsed.mint.toBase58(),
      user: event.parsed.user.toBase58(),
      isBuy: event.parsed.isBuy,
      timestamp: new Date(Number(event.parsed.timestamp) * 1000),
    });
  },
});
```

## Event Handler Signature

```typescript
type EventHandler<TIdl, TEventName> = (
  event: IndexerEvent<TIdl, TEventName>,
  db: NodePgDatabase,
) => Promise<void> | void;

interface IndexerEvent {
  name: string; // Event name
  contract: string; // Program ID
  type: string; // Event type
  parsed: any; // Parsed event data (typed based on IDL)
  timestamp: string; // Event timestamp
  transaction: {
    hash: string; // Transaction signature
    slot: number; // Slot number
    blockTime: number; // Block timestamp
  };
  programId: string; // Program ID
  eventName: string; // Event name
}
```

## Starting and Stopping

```typescript
// Start the indexer
await indexer.start();

// Stop the indexer
indexer.stop();
```

## Getting Status

```typescript
const status = indexer.getStatus();
console.log(status);
// {
//   isRunning: true,
//   currentSlot: 300000042,
//   registeredPrograms: 1,
//   eventHandlers: 1
// }
```

## Progress UI

When `enableUIProgress: true` is set, Solder provides a real-time terminal UI that displays:

- **Chain Status**: Current blockchain status and sync progress
- **Indexing Stats**: Real-time event processing statistics with RPS (requests per second)
- **Event Table**: Live view of processed events with counts and performance metrics
- **Progress Bar**: Visual progress indicator with ETA calculations
- **Health Monitoring**: Database, WebSocket, and RPC connection status

The progress UI automatically updates in place, providing a clean development experience without cluttering your terminal output.

```typescript
const indexer = new Indexer({
  // ... other options
  enableUIProgress: true, // Enables the real-time progress UI
});
```

**Features:**
- Live terminal updates without scrolling
- Performance metrics (RPS, average processing time)
- Health status indicators
- Progress tracking with ETA
- Event processing statistics
- Responsive design that adapts to terminal width

## Complete Example

```typescript
import { Indexer } from "@solder-build/core";
import { tradesTable } from "./schema";
import pumpFunIdl from "./idls/pump-fun.json";

export const initializeIndexer = async () => {
  const indexer = new Indexer({
    startBlock: 300000000,
    rpcUrl: process.env.RPC_URL || "https://api.mainnet-beta.solana.com",
    databaseUrl: process.env.DATABASE_URL,
    cursorKey: "pump-fun-indexer",
    enableUIProgress: true,
  });

  await indexer.onEvent({
    programId: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
    idl: pumpFunIdl,
    eventName: "TradeEvent",
    handler: async (event, db) => {
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

  await indexer.start();
  return indexer;
};
```
