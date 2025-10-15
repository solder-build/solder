<div align="center">

# Solder

<img width="120" alt="Solder architecture diagram" src="./assets/logo.png" />

**A modern Solana backend framework for shipping web2 backends faster**

_Build production-ready Solana indexers with auto-generated APIs in minutes, not days._

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)

[Website](https://solder.build) • [Documentation](https://solder.gitbook.io/solder-documentation) • [Examples](./apps/example-app)

**This project is currently in active development.** APIs, features, and documentation may change without notice. Use at your own risk.

</div>

---

## What is Solder?

Solder is a comprehensive Solana backend framework that abstracts away the complexity of building blockchain indexers and APIs. It provides:

- 🚀 **Indexer Abstraction** - Monitor Solana programs and events with minimal configuration
- 🗄️ **Built-in Database Support** - Integrated Drizzle ORM with PostgreSQL
- 🔌 **Auto-generated APIs** - RESTful CRUD endpoints created automatically from your schema
- 📝 **Type-safe** - Full TypeScript support with IDL-based type inference
- 📊 **Real-time Progress UI** - Live terminal interface with performance metrics and health monitoring
- ⚡ **Fast Development** - Go from zero to production-ready backend in minutes

## Quick Start

### Option 1: Using the CLI (Recommended)

The fastest way to get started with Solder is using the `create-solder-app` CLI:

```bash
npx create-solder-app
```

The CLI will:

1. Prompt you for a project name
2. Ask where you want to create the project
3. Ask if you want to install dependencies automatically
4. Set up a complete Solder project with example code

**After creation:**

```bash
cd your-project-name

# Copy and configure environment variables
cp .env.example .env
# Update .env with your RPC URL and database connection string

# Install dependencies (if you skipped during setup)
pnpm install

# Generate database schema
pnpm run generate

# Push schema to database
pnpm run push

# Start the indexer and API server
pnpm run dev
```

### Option 2: Clone the Example App

Clone the repository and navigate to the example application:

```bash
git clone https://github.com/your-org/solder.git
cd solder/apps/example-app

# Install dependencies
pnpm install

# Configure environment
cp .env.example .env
# Update .env with your configuration

# Generate and push database schema
pnpm run generate
pnpm run push

# Start the server
pnpm run dev
```

### Requirements

- Node.js >= 18
- PostgreSQL database
- Solana RPC endpoint (optional: defaults to public mainnet RPC)

---

## `solderTable` Documentation

The `solderTable` function is the core building block for defining your database schema with Solder. It extends Drizzle ORM tables with additional metadata for automatic API generation.

### Basic Usage

```typescript
import { solderTable } from "solder";
import { serial, varchar, timestamp, boolean, text } from "drizzle-orm/pg-core";

const trades = solderTable(
  "trades", // Table name
  {
    // Column definitions (standard Drizzle ORM)
    id: serial("id").primaryKey(),
    mint: varchar("mint", { length: 44 }).notNull(),
    user: varchar("user", { length: 44 }).notNull(),
    isBuy: boolean("is_buy").notNull(),
    timestamp: timestamp("timestamp", { mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  {
    // Solder-specific options
    primaryKey: "id",
    api: {
      basePath: "/trades",
      enabled: true,
      operations: {
        list: true, // GET /trades
        read: true, // GET /trades/:id
        create: true, // POST /trades
        update: false, // PUT /trades/:id (disabled)
        delete: false, // DELETE /trades/:id (disabled)
      },
    },
    description: "Trade events from pump.fun",
  },
);
```

### Options

#### Table Options (Third Parameter)

| Option        | Type     | Required | Description                         |
| ------------- | -------- | -------- | ----------------------------------- |
| `primaryKey`  | `string` | Yes      | Name of the primary key column      |
| `api`         | `object` | No       | API generation configuration        |
| `description` | `string` | No       | Table description for documentation |

#### API Configuration

| Option              | Type      | Default          | Description                                  |
| ------------------- | --------- | ---------------- | -------------------------------------------- |
| `enabled`           | `boolean` | `true`           | Enable/disable API generation for this table |
| `basePath`          | `string`  | `"/{tableName}"` | Base path for API endpoints                  |
| `operations.list`   | `boolean` | `true`           | Enable GET /basePath (list with query support) |
| `operations.read`   | `boolean` | `true`           | Enable GET /basePath/:id (read one)          |
| `operations.create` | `boolean` | `true`           | Enable POST /basePath (create)               |
| `operations.update` | `boolean` | `true`           | Enable PUT /basePath/:id (update)            |
| `operations.delete` | `boolean` | `true`           | Enable DELETE /basePath/:id (delete)         |

### Fine-Grained Query API

The LIST operation supports powerful PostgREST-style query parameters for filtering, sorting, pagination, and field selection.

**Important:** All query parameters use **database column names** (snake_case like `is_buy`, `sol_amount`), not schema property names (camelCase like `isBuy`, `solAmount`).

#### Basic Filtering

Filter results by adding query parameters with operator syntax: `field=operator.value`

```bash
# Get trades where is_buy equals true
GET /trades?is_buy=eq.true

# Get trades where sol_amount is greater than 1000
GET /trades?sol_amount=gt.1000

# Multiple filters (AND condition by default)
GET /trades?is_buy=eq.true&sol_amount=gt.1000
```

#### Filter Operators

Solder supports the following comparison operators:

| Operator | Description              | Example                    |
|----------|--------------------------|----------------------------|
| `eq`     | Equal                    | `?amount=eq.100`           |
| `neq`    | Not equal                | `?amount=neq.0`            |
| `gt`     | Greater than             | `?amount=gt.1000`          |
| `gte`    | Greater than or equal    | `?amount=gte.1000`         |
| `lt`     | Less than                | `?amount=lt.500`           |
| `lte`    | Less than or equal       | `?amount=lte.500`          |

**Type Handling:** The API automatically converts values to the appropriate type (booleans, numbers, strings, null).

#### Logical Operators

**OR Conditions:**
```bash
# Get trades where is_buy is true OR sol_amount is greater than 5000
GET /trades?or=(is_buy.eq.true,sol_amount.gt.5000)
```

**AND Conditions (Default):**
```bash
# Get trades where is_buy is true AND sol_amount is greater than 1000
GET /trades?is_buy=eq.true&sol_amount=gt.1000
```

#### Sorting

Sort results by specifying a field and direction:

```bash
# Sort by timestamp descending (newest first)
GET /trades?order=timestamp.desc

# Sort by amount ascending
GET /trades?order=sol_amount.asc
```

#### Pagination

Control the number of results and starting position:

```bash
# Get first 10 results
GET /trades?limit=10

# Skip first 20 results, then get 10
GET /trades?limit=10&offset=20

# Page 3 with 25 items per page
GET /trades?limit=25&offset=50
```

#### Field Selection

Return only specific fields instead of all columns:

```bash
# Return only mint, user, and timestamp fields
GET /trades?select=mint,user,timestamp

# Return only the amount fields
GET /trades?select=sol_amount,token_amount
```

**Note:** Field names must match the database column names (snake_case), not the schema property names.

#### Combining Parameters

All query parameters can be combined for powerful queries:

```bash
# Complex query: Filter, sort, paginate, and select fields
GET /trades?is_buy=eq.true&sol_amount=gt.1000&order=timestamp.desc&limit=10&select=mint,user,sol_amount,timestamp

# OR condition with sorting and pagination
GET /trades?or=(is_buy.eq.true,sol_amount.gt.5000)&order=sol_amount.desc&limit=20

# Filter by date range with field selection
GET /trades?timestamp=gte.2024-01-01&timestamp=lt.2024-02-01&select=mint,timestamp,sol_amount
```

#### Solana Use Cases

```bash
# Get recent buys over a certain amount
GET /trades?is_buy=eq.true&sol_amount=gt.10&order=timestamp.desc&limit=50

# Find all trades for a specific mint
GET /trades?mint=eq.abc123...&order=timestamp.desc

# Get large trades (buy or sell)
GET /trades?or=(sol_amount.gt.100,token_amount.gt.1000000)&order=sol_amount.desc

# Monitor recent activity
GET /trades?order=timestamp.desc&limit=100&select=mint,user,is_buy,sol_amount,timestamp
```

#### Error Handling

If a query is malformed or references invalid fields, the API will return a 400 error with details:

```json
{
  "error": "Unknown field: invalid_field_name"
}
```

#### Backwards Compatibility

If no query parameters are provided, the API behaves as before and returns all records:

```bash
# Returns all trades (no filtering)
GET /trades
```

### Building the Schema

After defining your tables, use `solderSchema` to build the final schema:

```typescript
import { solderSchema } from "solder";

const built = solderSchema(trades, users, tokens);

// Export for Drizzle Kit
export const tradesTable = trades.table;
export const usersTable = users.table;

// Export for application use
export const schema = built.schema;
export const tables = built.tables;
export type AppSchema = typeof schema;
```

---

## `Indexer` Instance Documentation

The `Indexer` class is the core component for monitoring Solana blockchain events and processing them into your database.

### Creating an Indexer

```typescript
import { Indexer } from "solder";

const indexer = new Indexer({
  startBlock: 300000000, // Starting slot number
  rpcUrl: process.env.RPC_URL, // Solana RPC endpoint
  databaseUrl: process.env.DATABASE_URL, // PostgreSQL connection string
  cursorKey: "my-indexer", // Unique identifier for this indexer
  enableUIProgress: true, // Enable real-time progress UI
});
```

### Configuration Options

| Option        | Type     | Required | Description                                             |
| ------------- | -------- | -------- | ------------------------------------------------------- |
| `startBlock`  | `number` | Yes      | Slot number to start indexing from                      |
| `rpcUrl`      | `string` | Yes      | Solana RPC endpoint URL                                 |
| `databaseUrl` | `string` | No       | PostgreSQL connection string (required for persistence) |
| `cursorKey`   | `string` | No       | Unique key for cursor storage (defaults to "default")   |

### Registering Event Handlers

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

### Event Handler Signature

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

### Starting and Stopping

```typescript
// Start the indexer
await indexer.start();

// Stop the indexer
indexer.stop();
```

### Getting Status

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

### Progress UI

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

### Complete Example

```typescript
import { Indexer } from "solder";
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

---

## Architecture

Solder is built on a modern, modular architecture that combines several best-in-class technologies:

<p align="center">
  <img width="700" alt="Solder Architecture" src="./assets/architecture.png" />
</p>

### Key Components

1. **Indexer Layer** - Monitors Solana blockchain for program events
2. **Schema Layer** - Type-safe database schema with Drizzle ORM
3. **API Layer** - Auto-generated RESTful APIs with Hono
4. **RPC Layer** - Efficient Solana RPC client for block and transaction data

For a detailed explanation of Solder's architecture, features, and design philosophy, please visit our comprehensive documentation:

**📚 [Solder Documentation](https://solder.gitbook.io/solder-documentation)**

---

## What's Inside This Monorepo?

This Turborepo includes the following packages and apps:

### Apps

- **`apps/docs`** - Documentation website (Next.js)
- **`apps/web`** - Marketing website (Next.js)
- **`apps/example-app`** - Example Solder application indexing pump.fun trades

### Packages

- **`packages/core`** - Core Solder framework (`solder`)
- **`packages/cli`** - CLI for scaffolding projects (`create-solder-app`)
- **`@repo/ui`** - Shared React component library
- **`@repo/eslint-config`** - Shared ESLint configurations
- **`@repo/typescript-config`** - Shared TypeScript configurations

### Development Commands

```bash
# Build all packages
pnpm build

# Run all apps in development mode
pnpm dev

# Lint all packages
pnpm lint

# Format code
pnpm format

# Create a new Solder app
pnpm create-app
```

<div align="center">

## 🚀 Ready to Build?

**Start building production-ready Solana backends today**

[Visit solder.build →](https://solder.build)

Follow us on [X/Twitter](https://x.com/solder_official) • Check out [legends.fun](https://www.legends.fun/products/3fcaabac-2fe8-402b-a1fd-53833b66dfad)

</div>
