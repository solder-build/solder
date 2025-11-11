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

export class RustIndexer {
  private nativeIndexer: any;
  private config: RustIndexerConfig;
  private eventHandlers: Map<string, EventHandler<any>> = new Map();
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
      eventName: config.eventName,
      handler: config.handler,
    };
    
    this.eventHandlers.set(handlerId, handler);

    return () => {
      this.eventHandlers.delete(handlerId);
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

    const programFilters = Array.from(
      new Set(Array.from(this.eventHandlers.values()).map(h => h.programId))
    ).map(programId => {
      const handler = Array.from(this.eventHandlers.values()).find(h => h.programId === programId);
      const filter: Record<string, string> = {
        'program-id': programId,
      };
      if (handler?.idl) {
        filter['idl-json'] = JSON.stringify(handler.idl);
      }
      return filter;
    });

    const eventNameFilters = Array.from(
      new Set(Array.from(this.eventHandlers.values()).map(h => h.eventName))
    );

    const vixenSource: Record<string, unknown> = {
      endpoint: this.config.grpcEndpoint,
      'subscriber-name': this.config.subscriberName || 'solder-indexer',
    };

    if (this.config.xToken) {
      vixenSource['x-token'] = this.config.xToken;
    }

    if (this.config.commitmentLevel) {
      vixenSource['commitment-level'] = this.config.commitmentLevel;
    }

    const nativeConfig = {
      source: vixenSource,
      buffer: {
        'sources-channel-size': 100,
      },
      pipeline: {
        slots: false,
        'enable-accounts': false,
        'event-name-filters': eventNameFilters,
        'program-filters': programFilters,
      },
    };

    console.log('Launching gRPC indexer with native config:', JSON.stringify(nativeConfig, null, 2));

    this.nativeIndexer.start(nativeConfig, async (...args: unknown[]) => {
      const payload = (args as unknown[])[0] ?? (args as unknown[])[1] ?? (args as unknown[])[2] ?? null;

      if (payload == null) return;

      let parsedEvent: any;
      if (typeof payload === 'string') {
        try {
          parsedEvent = JSON.parse(payload);
        } catch (error) {
          console.error('Error parsing event JSON:', error);
          return;
        }
      } else {
        parsedEvent = payload;
      }

      await this.handleNativeEvent(parsedEvent);
    });

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

      if (eventType === 'error') {
        console.error('Rust indexer error:', rawEvent.error);
        return;
      }
    } catch (error) {
      console.error('Error handling native event:', error);
    }
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
    const decoded = event.decoded;
    
    if (!decoded) {
      return;
    }

    const eventName = decoded.name;

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
      parsed: decoded.parsed,
      timestamp: new Date().toISOString(),
      transaction: {
        hash: event.signature || '',
        slot: event.slot || 0,
        blockTime: 0,
      },
      programId,
      eventName: eventName as any,
    };

    // Call all matching handlers
    await Promise.all(
      matchingHandlers.map((handler) => handler.handler(eventData as any, this.db!))
    );
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
    return Array.from(new Set(Array.from(this.eventHandlers.values()).map(h => h.programId)));
  }

  getEventHandlers(): EventHandler<any>[] {
    return Array.from(this.eventHandlers.values());
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      mode: 'grpc' as const,
      registeredPrograms: this.eventHandlers.size,
      eventHandlers: this.eventHandlers.size,
    };
  }
}

