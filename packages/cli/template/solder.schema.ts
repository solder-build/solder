import { solderSchema, solderTable } from "@solder-build/core";
import {
  serial,
  text,
  timestamp,
  varchar,
  integer,
  boolean,
  bigint,
} from "drizzle-orm/pg-core";

// trades: TradeEvent data from pump.fun
const trades = solderTable(
  "trades",
  {
    id: serial("id").primaryKey(),
    mint: varchar("mint", { length: 44 }).notNull(),
    solAmount: text("sol_amount").notNull(),
    tokenAmount: text("token_amount").notNull(),
    isBuy: boolean("is_buy").notNull(),
    user: varchar("user", { length: 44 }).notNull(),
    virtualSolReserves: text("virtual_sol_reserves").notNull(),
    virtualTokenReserves: text("virtual_token_reserves").notNull(),
    timestamp: timestamp("timestamp", { mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  {
    primaryKey: "id",
    api: {
      basePath: "/trades",
      enabled: true,
      operations: {
        list: true,
        read: true,
        create: true,
        update: false,
        delete: false,
      },
    },
    description: "Trade events from pump.fun",
  },
);

const built = solderSchema(trades);

// Export individual tables for Drizzle Kit
export const tradesTable = trades.table;

// Export the schema object for application use
export const schema = built.schema;
export const tables = built.tables;
export type AppSchema = typeof schema;
