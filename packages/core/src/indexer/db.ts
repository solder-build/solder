import { Pool } from "pg";

export type IndexerStateType = "historical" | "realtime";

export type CursorRecord = {
  cursor_key: string;
  state_type: IndexerStateType;
  last_slot: number;
  last_block_hash: string;
  last_block_time: string | null;
  updated_at: string;
};

export type StoredBlock = {
  slot: number;
  blockHash: string;
  parentHash?: string | null;
  blockTime?: number | null;
  source: IndexerStateType;
};

export type StoredEvent = {
  slot: number;
  blockHash: string;
  blockTime?: number | null;
  txnHash: string;
  programId: string;
  eventIndex: number;
};

export class CursorStore {
  private pool: Pool | null = null;
  private initialized = false;

  constructor(private readonly databaseUrl: string) {
    if (!databaseUrl) {
      throw new Error("CursorStore requires a valid database url");
    }
  }

  async connect(): Promise<void> {
    if (this.pool) return;
    this.pool = new Pool({ connectionString: this.databaseUrl });
    await this.pool.query("SELECT 1");
  }

  async close(): Promise<void> {
    if (!this.pool) return;
    await this.pool.end();
    this.pool = null;
    this.initialized = false;
  }

  async init(): Promise<void> {
    if (!this.pool) throw new Error("CursorStore not connected");
    if (this.initialized) return;

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS indexer_state (
        cursor_key TEXT NOT NULL,
        state_type TEXT NOT NULL,
        last_slot BIGINT NOT NULL,
        last_block_hash TEXT NOT NULL,
        last_block_time TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (cursor_key, state_type),
        CHECK (state_type IN ('historical', 'realtime'))
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS indexed_blocks (
        cursor_key TEXT NOT NULL,
        slot BIGINT NOT NULL,
        block_hash TEXT NOT NULL,
        parent_hash TEXT,
        block_time TIMESTAMPTZ,
        source TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (cursor_key, slot),
        CHECK (source IN ('historical', 'realtime'))
      )
    `);

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_indexed_blocks_cursor_hash
      ON indexed_blocks (cursor_key, block_hash)
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS processed_events (
        cursor_key TEXT NOT NULL,
        slot BIGINT NOT NULL,
        block_hash TEXT NOT NULL,
        block_time TIMESTAMPTZ,
        txn_hash TEXT NOT NULL,
        program_id TEXT NOT NULL,
        event_index INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (cursor_key, txn_hash, program_id, event_index)
      )
    `);

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_processed_events_cursor_slot
      ON processed_events (cursor_key, slot)
    `);

    this.initialized = true;
  }

  async getCursor(
    cursorKey: string,
    stateType: IndexerStateType = "historical",
  ): Promise<CursorRecord | null> {
    const pool = this.requirePool();
    await this.init();
    const res = await pool.query(
      `SELECT cursor_key, state_type, last_slot, last_block_hash, last_block_time, updated_at
       FROM indexer_state
       WHERE cursor_key = $1 AND state_type = $2`,
      [cursorKey, stateType],
    );
    if (res.rowCount === 0) return null;
    const row = res.rows[0];
    return {
      cursor_key: row.cursor_key,
      state_type: row.state_type,
      last_slot: Number(row.last_slot),
      last_block_hash: row.last_block_hash,
      last_block_time: row.last_block_time,
      updated_at: row.updated_at,
    };
  }

  async upsertCursor(
    cursorKey: string,
    lastSlot: number,
    lastBlockHash: string,
    stateType: IndexerStateType = "historical",
    blockTime?: number | null,
  ): Promise<void> {
    if (!lastBlockHash) return;
    const pool = this.requirePool();
    await this.init();
    const blockTimestamp = blockTime ? new Date(blockTime * 1000).toISOString() : null;
    await pool.query(
      `INSERT INTO indexer_state (cursor_key, state_type, last_slot, last_block_hash, last_block_time)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (cursor_key, state_type)
       DO UPDATE SET last_slot = EXCLUDED.last_slot,
                     last_block_hash = EXCLUDED.last_block_hash,
                     last_block_time = EXCLUDED.last_block_time,
                     updated_at = NOW()`,
      [cursorKey, stateType, lastSlot, lastBlockHash, blockTimestamp],
    );
  }

  async recordBlock(cursorKey: string, block: StoredBlock): Promise<void> {
    if (!block.blockHash) return;
    const pool = this.requirePool();
    await this.init();
    const blockTimestamp = block.blockTime ? new Date(block.blockTime * 1000).toISOString() : null;
    await pool.query(
      `INSERT INTO indexed_blocks (cursor_key, slot, block_hash, parent_hash, block_time, source, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (cursor_key, slot)
       DO UPDATE SET block_hash = EXCLUDED.block_hash,
                     parent_hash = EXCLUDED.parent_hash,
                     block_time = EXCLUDED.block_time,
                     source = EXCLUDED.source,
                     updated_at = NOW()`,
      [
        cursorKey,
        block.slot,
        block.blockHash,
        block.parentHash ?? null,
        blockTimestamp,
        block.source,
      ],
    );
  }

  async markEventProcessed(cursorKey: string, event: StoredEvent): Promise<boolean> {
    const pool = this.requirePool();
    await this.init();
    const blockTimestamp = event.blockTime ? new Date(event.blockTime * 1000).toISOString() : null;
    const res = await pool.query(
      `INSERT INTO processed_events (
          cursor_key,
          slot,
          block_hash,
          block_time,
          txn_hash,
          program_id,
          event_index,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        ON CONFLICT (cursor_key, txn_hash, program_id, event_index)
        DO NOTHING
        RETURNING 1`,
      [
        cursorKey,
        event.slot,
        event.blockHash,
        blockTimestamp,
        event.txnHash,
        event.programId,
        event.eventIndex,
      ],
    );
    return (res.rowCount ?? 0) > 0;
  }

  private requirePool(): Pool {
    if (!this.pool) {
      throw new Error("CursorStore not connected");
    }
    return this.pool;
  }
  
  async checkIsBlockIndexed(cursorKey: string, slot: number): Promise<boolean> {
    const pool = this.requirePool();
    await this.init();
    const res = await pool.query(
      `SELECT 1 FROM indexed_blocks WHERE cursor_key = $1 AND slot = $2`,
      [cursorKey, slot],
    );
    return (res.rowCount ?? 0) > 0;
  }
}
