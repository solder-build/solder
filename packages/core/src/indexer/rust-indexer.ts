import * as fs from 'fs';
import * as path from 'path';
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { CursorStore } from "./db";
import type { OnEventConfig, EventHandler, ExtractEventNames } from "./indexer";
import type { AnchorIdl } from "../idl/idl-types";

function loadNativeAddon(): any {
  const candidates = [
    path.join(__dirname, '..', '..', 'index.node'),
    path.join(__dirname, '..', '..', '..', 'index.node'),
    path.join(__dirname, '..', '..', '..', '..', 'core', 'index.node'),
  ];
  
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return require(candidate);
    }
  }
  
  throw new Error(
    'Native addon (index.node) not found. Run `pnpm build:native` to compile the Rust addon.\n' +
    `Searched paths:\n${candidates.map(p => `  - ${p}`).join('\n')}`
  );
}

let nativeAddon: any;
try {
  nativeAddon = loadNativeAddon();
} catch (err) {
  nativeAddon = null;
}

export interface RustIndexerConfig {
  mode: 'grpc';
  databaseUrl: string;
  grpcEndpoint: string;
  xToken?: string;
  subscriberName?: string;
  commitmentLevel?: 'processed' | 'confirmed' | 'finalized';
  fromSlot?: number;
  cursorKey?: string;
}

export interface TransactionHandler {
  id: string;
  programId: string;
  idl?: AnchorIdl;
  handler: (
    transaction: any,
    db: NodePgDatabase<Record<string, never>> & { $client: Pool },
  ) => Promise<void> | void;
}

export interface OnTransactionConfig {
  programId: string;
  idl?: AnchorIdl;
  handler: (
    transaction: any,
    db: NodePgDatabase<Record<string, never>> & { $client: Pool },
  ) => Promise<void> | void;
}

export class RustIndexer {
  private nativeIndexer: any;
  private config: RustIndexerConfig;
  private eventHandlers: Map<string, EventHandler<any>> = new Map();
  private transactionHandlers: Map<string, TransactionHandler> = new Map();
  private db: (NodePgDatabase<Record<string, never>> & { $client: Pool }) | null = null;
  private cursorStore: CursorStore | null = null;
  private pool: Pool | null = null;
  private cursorKey: string;
  private isRunning = false;

  constructor(config: RustIndexerConfig) {
    if (!nativeAddon) {
      throw new Error('Native addon not available. Ensure the Rust addon is built.');
    }
    
    this.config = config;
    this.nativeIndexer = new nativeAddon.Indexer();
    this.cursorKey = config.cursorKey || "grpc-indexer";
    
    if (config.databaseUrl) {
      this.setupDatabase(config.databaseUrl);
    }
  }

  private setupDatabase(databaseUrl: string): void {
    const pool = new Pool({ connectionString: databaseUrl });
    const db = drizzle(pool) as NodePgDatabase<Record<string, never>>;
    this.db = Object.assign(db, { $client: pool }) as NodePgDatabase<Record<string, never>> & { $client: Pool };
    this.pool = pool;
    this.cursorStore = new CursorStore(databaseUrl);
  }

  async onEvent<
    TIdl extends AnchorIdl,
    TEventName extends ExtractEventNames<TIdl> = ExtractEventNames<TIdl>,
  >( 
    config: OnEventConfig<TIdl, TEventName>
  ): Promise<() => void> {
    const handlerId = `${config.programId}-${config.eventName}-${Date.now()}`;
    
    const handler: EventHandler<TIdl, TEventName> = {
      id: handlerId,
      programId: config.programId,
      idl: config.idl,
      handler: config.handler,
    };
    
    this.eventHandlers.set(handlerId, handler);

    return () => {
      this.eventHandlers.delete(handlerId);
    };
  }

  async onTransaction(
    config: OnTransactionConfig
  ): Promise<() => void> {
    const handlerId = `transaction-${config.programId}-${Date.now()}`;

    const handler: TransactionHandler = {
      id: handlerId,
      programId: config.programId,
      idl: config.idl,
      handler: config.handler,
    };

    this.transactionHandlers.set(handlerId, handler);

    return () => {
      this.transactionHandlers.delete(handlerId);
    };
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error("Indexer is already running");
    }

    if (!this.db) {
      this.setupDatabase(this.config.databaseUrl);
    }

    let fromSlot: number | undefined = this.config.fromSlot;

    if (!this.db) {
      throw new Error("Database not initialized. Provide databaseUrl when using the gRPC indexer.");
    }

    if (this.cursorStore) {
      await this.cursorStore.connect();
      await this.cursorStore.init();
      const existingCursor = await this.cursorStore.getCursor(this.cursorKey);
      if (existingCursor && existingCursor.last_slot > 0) {
        fromSlot = existingCursor.last_slot + 1;
      }
    }

    const nativeConfig = this.buildConfig();

    if (this.eventHandlers.size > 0) {
      this.nativeIndexer.onEvent(async (...args: unknown[]) => {
        try {
          const payload = (args as unknown[])[0] ?? (args as unknown[])[1] ?? (args as unknown[])[2] ?? null;

          if (payload == null) return;

          let parsed: any;
          if (typeof payload === 'string') {
            parsed = JSON.parse(payload);
          } else {
            parsed = payload;
          }

          if (!parsed) {
            return;
          }

          if (parsed.type === 'event' && parsed.event) {
            await this.handleEvent(parsed.event);
          }
        } catch (error) {
          console.error('Error handling event from native subscription:', error);
        }
      });
    }

    if (this.transactionHandlers.size > 0) {
      this.nativeIndexer.onTransaction(async (...args: unknown[]) => {
        try {
          const payload = (args as unknown[])[0] ?? (args as unknown[])[1] ?? (args as unknown[])[2] ?? null;

          if (payload == null) return;

          let parsed: any;
          if (typeof payload === 'string') {
            parsed = JSON.parse(payload);
          } else {
            parsed = payload;
          }

          if (!parsed) {
            return;
          }

          if (parsed.type === 'transaction' && parsed.event) {
            await this.handleTransaction(parsed.event);
          }
        } catch (error) {
          console.error('Error handling transaction from native subscription:', error);
        }
      });
    }

    this.nativeIndexer.start(nativeConfig);

    this.isRunning = true;
    console.log('🚀 Rust indexer started with gRPC streaming');
  }

  private async handleNativeEvent(rawEvent: any): Promise<void> {
    try {
      const eventType = rawEvent.type;

      if (eventType === 'slot') {
        await this.handleSlotUpdate(rawEvent.event);
        return;
      }

      if (eventType === 'event') {
        await this.handleEvent(rawEvent.event);
        return;
      }

      if (eventType === 'transaction') {
        await this.handleTransaction(rawEvent.event);
        return;
      }

      if (eventType === 'error') {
        console.error('Rust indexer error:', rawEvent.error);
        return;
      }
    } catch (error) {
      console.error('Error handling native event:', error);
    }
  }

  private buildConfig() {
    const allProgramIds = Array.from(
      new Set([
        ...Array.from(this.eventHandlers.values()).map(h => h.programId),
        ...Array.from(this.transactionHandlers.values()).map(h => h.programId),
      ])
    );

    const programFilters = allProgramIds.map(programId => {
      const handlers = [
        ...Array.from(this.transactionHandlers.values()),
        ...Array.from(this.eventHandlers.values()),
      ];
      const handlerForProgram = handlers.find(h => h.programId === programId);

      const filter: Record<string, string> = {
        'program-id': programId,
      };
      if (handlerForProgram?.idl) {
        filter['idl-json'] = JSON.stringify(handlerForProgram.idl);
      }
      return filter;
    });

    const eventNameFilters = Array.from(
      new Set(Array.from(this.eventHandlers.values()).map(h => h.eventName))
    );

    const source: Record<string, unknown> = {
      'endpoint': this.config.grpcEndpoint,
      'subscriber-name': this.config.subscriberName || 'solder-indexer',
    };

    if (this.config.xToken) {
      source['x-token'] = this.config.xToken;
    }

    if (this.config.commitmentLevel) {
      source['commitment-level'] = this.config.commitmentLevel;
    }

    return {
      source,
      buffer: {
        'sources-channel-size': 100,
      },
      pipeline: {
        'enable-transactions': true,
        'event-name-filters': eventNameFilters,
        'program-filters': programFilters,
      },
    };
  }

  private async handleSlotUpdate(slot: any): Promise<void> {
    if (!this.cursorStore) {
      return;
    }

    const status = typeof slot.status === 'string' ? slot.status.toLowerCase() : '';
    if (status !== 'confirmed' && status !== 'finalized') {
      return;
    }

    try {
      const blockIdentifier = slot.parent !== undefined && slot.parent !== null
        ? String(slot.parent)
        : status;

      await this.cursorStore.upsertCursor(this.cursorKey, Number(slot.slot ?? 0), blockIdentifier);
    } catch (error) {
      console.error('Failed to persist cursor from slot update:', error);
    }
  }

  private async handleEvent(event: any): Promise<void> {
    const programId = event.program;
    const parsed = event.parsed;
    
    if (!parsed) {
      return;
    }

    const eventName = parsed.name;

    // Find all handlers that match this programId and eventName
    // (handlers are stored with timestamp in key, so we need to search by programId and eventName)
    const matchingHandlers = Array.from(this.eventHandlers.values()).filter(
      (handler) => handler.programId === programId && handler.eventName === eventName
    );

    if (matchingHandlers.length === 0) {
      return;
    }

    if (!this.db) {
      throw new Error("Database not initialized. Provide databaseUrl when using the gRPC indexer.");
    }

    const eventData = {
      name: eventName,
      contract: programId,
      type: 'event',
      params: parsed.params,
      timestamp: new Date().toISOString(),
      transaction: {
        hash: event.signature || '',
        slot: event.slot || 0,
        blockTime: 0,
      },
      programId,
      eventName: eventName as any,
    };

    await Promise.all(
      matchingHandlers.map((handler) => handler.handler(eventData as any, this.db!))
    );
  }

  private async handleTransaction(transaction: any): Promise<void> {
    const allHandlers = Array.from(this.transactionHandlers.values());

    if (allHandlers.length === 0) {
      return;
    }

    if (!this.db) {
      throw new Error("Database not initialized. Provide databaseUrl when using the gRPC indexer.");
    }

    // Transform transaction to match expected format
    const transactionData = {
      hash: transaction.signature || '',
      slot: transaction.slot || 0,
      blockTime: null,
      blockHash: '',
      data: {
        block_number: transaction.slot || 0,
        block_hash: '',
        block_ts: null,
        txn_hash: transaction.signature || '',
        instructions: transaction.parsed_instructions || [],
        events: transaction.parsed_events || [],
      },
    };

    await allHandlers.map((handler) => handler.handler(transactionData, this.db!));
  }

  stop(): void {
    if (this.isRunning) {
      this.nativeIndexer.stop();
      this.isRunning = false;
      console.log('🛑 Rust indexer stopped');
      if (this.cursorStore) {
        this.cursorStore.close().catch(() => {});
        this.cursorStore = null;
      }
      if (this.pool) {
        this.pool.end().catch(() => {});
        this.pool = null;
      }
      this.db = null;
    }
  }

  getRegisteredProgramIds(): string[] {
    return Array.from(new Set([
      ...Array.from(this.eventHandlers.values()).map(h => h.programId),
      ...Array.from(this.transactionHandlers.values()).map(h => h.programId),
    ]));
  }

  getEventHandlers(): EventHandler<any>[] {
    return Array.from(this.eventHandlers.values());
  }

  getTransactionHandlers(): TransactionHandler[] {
    return Array.from(this.transactionHandlers.values());
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      mode: 'grpc' as const,
      registeredPrograms: this.eventHandlers.size,
      eventHandlers: this.eventHandlers.size,
      transactionHandlers: this.transactionHandlers.size,
    };
  }
}

