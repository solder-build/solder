import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'node:crypto';
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { CursorStore } from "./db";
import type { OnEventConfig, EventHandler, ExtractEventNames } from "./indexer";
import type {
  AnchorIdl,
  InstructionNames,
  InstructionPayload,
  EventPayload,
  IdlTransaction,
} from "../idl/idl-types";

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

export interface GrpcIndexerConfig {
  mode: 'grpc';
  databaseUrl: string;
  grpcEndpoint: string;
  xToken?: string;
  subscriberName?: string;
  commitmentLevel?: 'processed' | 'confirmed' | 'finalized';
  fromSlot?: number;
  cursorKey?: string;
}

export type GrpcTransaction<TIdl extends AnchorIdl = AnchorIdl> = IdlTransaction<TIdl>;

export interface TransactionHandler<TIdl extends AnchorIdl = AnchorIdl> {
  id: string;
  programId: string;
  idl?: TIdl;
  instructionNames?: string[];
  handler: (
    transaction: GrpcTransaction<TIdl>,
    db: NodePgDatabase<Record<string, never>> & { $client: Pool },
  ) => Promise<void> | void;
}

export interface OnTransactionConfig<
  TIdl extends AnchorIdl = AnchorIdl,
  TInstructionName extends InstructionNames<TIdl> & string = InstructionNames<TIdl> & string,
> {
  programId: string;
  idl?: TIdl;
  instructionNames?: TInstructionName[];
  handler: (
    transaction: GrpcTransaction<TIdl>,
    db: NodePgDatabase<Record<string, never>> & { $client: Pool },
  ) => Promise<void> | void;
}

export class GrpcIndexer {
  private nativeIndexer: any;
  private config: GrpcIndexerConfig;
  private eventHandlers: Map<string, EventHandler<any>> = new Map();
  private transactionHandlers: Map<string, TransactionHandler<any>> = new Map();
  private db: (NodePgDatabase<Record<string, never>> & { $client: Pool }) | null = null;
  private cursorStore: CursorStore | null = null;
  private pool: Pool | null = null;
  private cursorKey: string;
  private isRunning = false;
  private handlerCounter = 0;

  constructor(config: GrpcIndexerConfig) {
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

  private createHandlerId(prefix: string): string {
    const uniquePart = randomUUID
      ? randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `${prefix}-${uniquePart}-${++this.handlerCounter}`;
  }

  async onEvent<
    TIdl extends AnchorIdl,
    TEventName extends ExtractEventNames<TIdl> = ExtractEventNames<TIdl>,
  >( 
    config: OnEventConfig<TIdl, TEventName>
  ): Promise<() => void> {
    const handlerId = this.createHandlerId(`event-${config.programId}`);
    
    const handler: EventHandler<TIdl, TEventName> = {
      id: handlerId,
      programId: config.programId,
      idl: config.idl,
      eventName: config.eventName,
      handler: config.handler,
    };
    
    this.eventHandlers.set(handlerId, handler);

    return () => {
      this.eventHandlers.delete(handlerId);
    };
  }

  async onTransaction<
    TIdl extends AnchorIdl,
    TInstructionName extends InstructionNames<TIdl> & string = InstructionNames<TIdl> & string,
  >(
    config: OnTransactionConfig<TIdl, TInstructionName>
  ): Promise<() => void> {
    const hasFilters =
      config.instructionNames && config.instructionNames.length > 0;

    if (hasFilters && !config.idl) {
      throw new Error(
        'IDL is required when specifying instructionNames or eventNames filters.'
      );
    }

    const handlerId = this.createHandlerId(`transaction-${config.programId}`);

    const handler: TransactionHandler<TIdl> = {
      id: handlerId,
      programId: config.programId,
      idl: config.idl,
      instructionNames: config.instructionNames,
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
      this.nativeIndexer.onEvent(async (err: string, payload: any) => {
        try {
          if (err) {
            console.error('Error handling event from native subscription:', err);
            return;
          }

          let parsed;

          if (typeof payload === 'string') {
            parsed = JSON.parse(payload);
          } else {
            parsed = payload;
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
      this.nativeIndexer.onTransaction(async (err: string, payload: any) => {
        try {
          if (err) {
            console.error('Error handling transaction from native subscription:', err);
            return;
          }

          let parsed;
          
          if (typeof payload === 'string') {
            parsed = JSON.parse(payload);
          } else {
            parsed = payload;
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

  private buildConfig() {
    const eventSubscriptions = Array.from(this.eventHandlers.values()).map(handler => {
      const subscription: Record<string, unknown> = {
        id: handler.id,
        'program-id': handler.programId,
        'event-name': handler.eventName,
      };
      if (handler.idl) {
        subscription['idl-json'] = JSON.stringify(handler.idl);
      }
      return subscription;
    });

    const transactionSubscriptions = Array.from(this.transactionHandlers.values()).map(handler => {
      const subscription: Record<string, unknown> = {
        id: handler.id,
        'program-id': handler.programId,
        'instruction-name-filters': handler.instructionNames ?? [],
      };
      if (handler.idl) {
        subscription['idl-json'] = JSON.stringify(handler.idl);
      }
      return subscription;
    });

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
        'slots': false,
        'enable-transactions': eventSubscriptions.length + transactionSubscriptions.length > 0,
        'event-subscriptions': eventSubscriptions,
        'transaction-subscriptions': transactionSubscriptions,
      },
    };
  }

  private async handleEvent(event: any): Promise<void> {
    const subscriptionId = event.subscription_id ?? event.subscriptionId;

    if (subscriptionId && this.eventHandlers.has(subscriptionId)) {
      if (!this.db) {
        throw new Error("Database not initialized. Provide databaseUrl when using the gRPC indexer.");
      }
      const handler = this.eventHandlers.get(subscriptionId)!;
      await handler.handler(this.normalizeEventPayload(event) as any, this.db!);
      return;
    }
  }

  private normalizeEventPayload(event: any) {
    const parsed = event.parsed ?? {};
    return {
      name: parsed.name,
      contract: event.program,
      type: 'event',
      params: parsed.params,
      timestamp: new Date().toISOString(),
      transaction: {
        hash: event.signature || '',
        slot: event.slot || 0,
        blockTime: 0,
      },
      programId: event.program,
      eventName: parsed.name,
    };
  }

  private async handleTransaction(transaction: any): Promise<void> {
    const allHandlers = Array.from(this.transactionHandlers.values());

    if (allHandlers.length === 0) {
      return;
    }

    if (!this.db) {
      throw new Error("Database not initialized. Provide databaseUrl when using the gRPC indexer.");
    }

    const instructions = (transaction.parsed_instructions ?? []) as InstructionPayload<AnchorIdl>[];
    const events = (transaction.parsed_events ?? []) as EventPayload<AnchorIdl>[];

    // Transform transaction to match expected format
    const transactionData: GrpcTransaction = {
      hash: transaction.signature || '',
      slot: transaction.slot || 0,
      blockTime: null,
      blockHash: '',
      data: {
        block_number: transaction.slot || 0,
        block_hash: '',
        block_ts: null,
        txn_hash: transaction.signature || '',
        instructions,
        events,
      },
    };

    const subscriptionId = transaction.subscription_id ?? transaction.subscriptionId;
    if (subscriptionId && this.transactionHandlers.has(subscriptionId)) {
      await this.transactionHandlers.get(subscriptionId)!.handler(transactionData, this.db!);
      return;
    }

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

