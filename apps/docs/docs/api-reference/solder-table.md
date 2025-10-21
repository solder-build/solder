---
sidebar_position: 1
---

# solderTable Documentation

The `solderTable` function is the core building block for defining your database schema with Solder. It extends Drizzle ORM tables with additional metadata for automatic API generation.

## Basic Usage

```typescript
import { solderTable } from "@solder-build/core";
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

## Options

### Table Options (Third Parameter)

| Option        | Type     | Required | Description                         |
| ------------- | -------- | -------- | ----------------------------------- |
| `primaryKey`  | `string` | Yes      | Name of the primary key column      |
| `api`         | `object` | No       | API generation configuration        |
| `description` | `string` | No       | Table description for documentation |

### API Configuration

| Option              | Type      | Default          | Description                                    |
| ------------------- | --------- | ---------------- | ---------------------------------------------- |
| `enabled`           | `boolean` | `true`           | Enable/disable API generation for this table   |
| `basePath`          | `string`  | `"/{tableName}"` | Base path for API endpoints                    |
| `operations.list`   | `boolean` | `true`           | Enable GET /basePath (list with query support) |
| `operations.read`   | `boolean` | `true`           | Enable GET /basePath/:id (read one)            |
| `operations.create` | `boolean` | `true`           | Enable POST /basePath (create)                 |
| `operations.update` | `boolean` | `true`           | Enable PUT /basePath/:id (update)              |
| `operations.delete` | `boolean` | `true`           | Enable DELETE /basePath/:id (delete)           |

## Fine-Grained Query API

The LIST operation supports powerful PostgREST-style query parameters for filtering, sorting, pagination, and field selection.

**Important:** All query parameters use **database column names** (snake_case like `is_buy`, `sol_amount`), not schema property names (camelCase like `isBuy`, `solAmount`).

### Basic Filtering

Filter results by adding query parameters with operator syntax: `field=operator.value`

```bash
# Get trades where is_buy equals true
GET /trades?is_buy=eq.true

# Get trades where sol_amount is greater than 1000
GET /trades?sol_amount=gt.1000

# Multiple filters (AND condition by default)
GET /trades?is_buy=eq.true&sol_amount=gt.1000
```

### Filter Operators

Solder supports the following comparison operators:

| Operator | Description           | Example            |
| -------- | --------------------- | ------------------ |
| `eq`     | Equal                 | `?amount=eq.100`   |
| `neq`    | Not equal             | `?amount=neq.0`    |
| `gt`     | Greater than          | `?amount=gt.1000`  |
| `gte`    | Greater than or equal | `?amount=gte.1000` |
| `lt`     | Less than             | `?amount=lt.500`   |
| `lte`    | Less than or equal    | `?amount=lte.500`  |

**Type Handling:** The API automatically converts values to the appropriate type (booleans, numbers, strings, null).

### Logical Operators

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

### Sorting

Sort results by specifying a field and direction:

```bash
# Sort by timestamp descending (newest first)
GET /trades?order=timestamp.desc

# Sort by amount ascending
GET /trades?order=sol_amount.asc
```

### Pagination

Control the number of results and starting position:

```bash
# Get first 10 results
GET /trades?limit=10

# Skip first 20 results, then get 10
GET /trades?limit=10&offset=20

# Page 3 with 25 items per page
GET /trades?limit=25&offset=50
```

### Field Selection

Return only specific fields instead of all columns:

```bash
# Return only mint, user, and timestamp fields
GET /trades?select=mint,user,timestamp

# Return only the amount fields
GET /trades?select=sol_amount,token_amount
```

**Note:** Field names must match the database column names (snake_case), not the schema property names.

### Combining Parameters

All query parameters can be combined for powerful queries:

```bash
# Complex query: Filter, sort, paginate, and select fields
GET /trades?is_buy=eq.true&sol_amount=gt.1000&order=timestamp.desc&limit=10&select=mint,user,sol_amount,timestamp

# OR condition with sorting and pagination
GET /trades?or=(is_buy.eq.true,sol_amount.gt.5000)&order=sol_amount.desc&limit=20

# Filter by date range with field selection
GET /trades?timestamp=gte.2024-01-01&timestamp=lt.2024-02-01&select=mint,timestamp,sol_amount
```

### Solana Use Cases

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

### Error Handling

If a query is malformed or references invalid fields, the API will return a 400 error with details:

```json
{
  "error": "Unknown field: invalid_field_name"
}
```

### Backwards Compatibility

If no query parameters are provided, the API behaves as before and returns all records:

```bash
# Returns all trades (no filtering)
GET /trades
```

## Building the Schema

After defining your tables, use `solderSchema` to build the final schema:

```typescript
import { solderSchema } from "@solder-build/core";

const built = solderSchema(trades, users, tokens);

// Export for Drizzle Kit
export const tradesTable = trades.table;
export const usersTable = users.table;

// Export for application use
export const schema = built.schema;
export const tables = built.tables;
export type AppSchema = typeof schema;
```
