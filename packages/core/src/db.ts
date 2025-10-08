// your-package/db.ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { Schema, TableDefinition } from "./tables.js";

export function makeDb(
  tablesOrSchema: TableDefinition[] | Schema,
  connectionString: string,
) {
  const pool = new Pool({ connectionString });
  const schema = Array.isArray(tablesOrSchema as any)
    ? Object.fromEntries(
        (tablesOrSchema as TableDefinition[]).map((t) => [t.name, t.table]),
      )
    : (tablesOrSchema as Schema).schema;
  const db = drizzle(pool, { schema });
  return db;
}
