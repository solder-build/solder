import { Pool } from "pg";

export type CursorRecord = {
  cursor_key: string;
  last_slot: number;
  last_block_hash: string;
  updated_at: string;
};

export class CursorStore {
  private pool: Pool | null = null;

  constructor(private readonly databaseUrl: string) {}

  async connect(): Promise<void> {
    if (this.pool) return;
    this.pool = new Pool({ connectionString: this.databaseUrl });
    // simple sanity query
    await this.pool.query("SELECT 1");
  }

  async close(): Promise<void> {
    if (!this.pool) return;
    await this.pool.end();
    this.pool = null;
  }

  async init(): Promise<void> {
    if (!this.pool) throw new Error("CursorStore not connected");
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS indexer_state (
        cursor_key TEXT PRIMARY KEY,
        last_slot BIGINT NOT NULL,
        last_block_hash TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    );
  }

  async getCursor(cursorKey: string): Promise<CursorRecord | null> {
    if (!this.pool) throw new Error("CursorStore not connected");
    
    // Ensure table exists before querying
    await this.ensureTableExists();
    
    const res = await this.pool.query(
      `SELECT cursor_key, last_slot, last_block_hash, updated_at
       FROM indexer_state WHERE cursor_key = $1`,
      [cursorKey]
    );
    if (res.rowCount === 0) return null;
    const row = res.rows[0];
    return {
      cursor_key: row.cursor_key,
      last_slot: Number(row.last_slot),
      last_block_hash: row.last_block_hash,
      updated_at: row.updated_at,
    };
  }

  async upsertCursor(cursorKey: string, lastSlot: number, lastBlockHash: string): Promise<void> {
    if (!this.pool) throw new Error("CursorStore not connected");
    
    await this.ensureTableExists();
    
    await this.pool.query(
      `INSERT INTO indexer_state (cursor_key, last_slot, last_block_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (cursor_key)
       DO UPDATE SET last_slot = EXCLUDED.last_slot,
                     last_block_hash = EXCLUDED.last_block_hash,
                     updated_at = NOW()`,
      [cursorKey, lastSlot, lastBlockHash]
    );
  }

  async deleteCursor(cursorKey: string): Promise<void> {
    if (!this.pool) throw new Error("CursorStore not connected");
    
    await this.ensureTableExists();
    
    await this.pool.query(
      `DELETE FROM indexer_state WHERE cursor_key = $1`,
      [cursorKey]
    );
  }

  private async ensureTableExists(): Promise<void> {
    if (!this.pool) throw new Error("CursorStore not connected");
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS indexer_state (
        cursor_key TEXT PRIMARY KEY,
        last_slot BIGINT NOT NULL,
        last_block_hash TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    );
  }
}


