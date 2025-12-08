import { Pool } from "pg";

export type CursorRecord = {
  cursor_key: string;
  last_slot: number;
  last_block_hash: string;
  updated_at: string;
};

export type SignatureCursorRecord = {
  cursor_key: string;
  program_id: string;
  latest_signature: string | null;
  latest_slot: number | null;
  backfill_before: string | null;
  backfill_slot: number | null;
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

    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS indexer_signature_state (
        cursor_key TEXT NOT NULL,
        program_id TEXT NOT NULL,
        latest_signature TEXT,
        latest_slot BIGINT,
        backfill_before TEXT,
        backfill_slot BIGINT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (cursor_key, program_id)
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
    
    // Ensure table exists before upserting
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

  async getSignatureCursor(cursorKey: string, programId: string): Promise<SignatureCursorRecord | null> {
    if (!this.pool) throw new Error("CursorStore not connected");
    await this.ensureSignatureTableExists();
    const res = await this.pool.query(
      `SELECT cursor_key, program_id, latest_signature, latest_slot, backfill_before, backfill_slot, updated_at
       FROM indexer_signature_state
       WHERE cursor_key = $1 AND program_id = $2`,
      [cursorKey, programId]
    );
    if (res.rowCount === 0) return null;
    const row = res.rows[0];
    return {
      cursor_key: row.cursor_key,
      program_id: row.program_id,
      latest_signature: row.latest_signature,
      latest_slot: row.latest_slot ? Number(row.latest_slot) : null,
      backfill_before: row.backfill_before,
      backfill_slot: row.backfill_slot ? Number(row.backfill_slot) : null,
      updated_at: row.updated_at,
    };
  }

  async upsertSignatureCursor(params: {
    cursorKey: string;
    programId: string;
    latestSignature: string | null;
    latestSlot: number | null;
    backfillBefore: string | null;
    backfillSlot: number | null;
  }): Promise<void> {
    if (!this.pool) throw new Error("CursorStore not connected");
    await this.ensureSignatureTableExists();
    const { cursorKey, programId, latestSignature, latestSlot, backfillBefore, backfillSlot } = params;
    await this.pool.query(
      `INSERT INTO indexer_signature_state (cursor_key, program_id, latest_signature, latest_slot, backfill_before, backfill_slot)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (cursor_key, program_id)
       DO UPDATE SET
         latest_signature = EXCLUDED.latest_signature,
         latest_slot = EXCLUDED.latest_slot,
         backfill_before = EXCLUDED.backfill_before,
         backfill_slot = EXCLUDED.backfill_slot,
         updated_at = NOW()`,
      [cursorKey, programId, latestSignature, latestSlot, backfillBefore, backfillSlot]
    );
  }

  private async ensureSignatureTableExists(): Promise<void> {
    if (!this.pool) throw new Error("CursorStore not connected");
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS indexer_signature_state (
        cursor_key TEXT NOT NULL,
        program_id TEXT NOT NULL,
        latest_signature TEXT,
        latest_slot BIGINT,
        backfill_before TEXT,
        backfill_slot BIGINT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (cursor_key, program_id)
      )`
    );
  }
}


