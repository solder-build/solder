import { Connection } from "@solana/web3.js";
import { RpcClient } from "../rpc/rpc";
import { EventType, IdlEvent } from "../idl/idl-types";
import { CursorStore } from "./db";
import { Idl } from "@project-serum/anchor";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

export interface IndexerConfig {
  startBlock: number;
  rpcUrl: string;
  databaseUrl?: string; // Postgres connection string
  cursorKey?: string; // namespaced cursor key
  enableUIProgress?: boolean; // enable UI progress
}

export interface RegisteredProgram {
  programId: string;
  eventTypes: string[];
  idl: any; // Anchor IDL object
}

export interface EventHandler<
  TIdl extends Idl = Idl,
  TEventName extends ExtractEventNames<TIdl> = ExtractEventNames<TIdl>,
> {
  id: string;
  programId: string;
  idl: TIdl;
  eventName: string;
  handler: (
    event: IndexerEvent<TIdl, TEventName>,
    db: NodePgDatabase<Record<string, never>> & { $client: Pool },
  ) => Promise<void> | void;
}

export interface OnEventConfig<
  TIdl extends Idl = Idl,
  TEventName extends ExtractEventNames<TIdl> = ExtractEventNames<TIdl>,
> {
  programId: string;
  idl: TIdl;
  eventName: string;
  handler: (
    event: IndexerEvent<TIdl, TEventName>,
    db: NodePgDatabase<Record<string, never>> & { $client: Pool },
  ) => Promise<void> | void;
}

// Type to extract event names from IDL
export type ExtractEventNames<TIdl extends Idl> = TIdl extends {
  events: infer TEvents;
}
  ? TEvents extends readonly any[]
    ? TEvents[number] extends { name: infer TName }
      ? TName
      : never
    : never
  : never;

// Type to get event data from IDL
export type ExtractEventData<
  TIdl extends Idl,
  TEventName extends ExtractEventNames<TIdl>,
> = TIdl extends { events: infer TEvents }
  ? TEvents extends readonly any[]
    ? TEvents[number] extends { name: TEventName; fields: infer TFields }
      ? TFields
      : never
    : never
  : never;

// Type for the complete event object passed to handlers
export interface IndexerEvent<
  TIdl extends Idl = Idl,
  TEventName extends ExtractEventNames<TIdl> = ExtractEventNames<TIdl>,
> {
  name: string;
  contract: string;
  type: string;
  parsed: EventType<TIdl, TEventName>;
  timestamp: string;
  transaction: {
    hash: string;
    slot: number;
    blockTime: number;
  };
  programId: string;
  eventName: TEventName;
}

export class Indexer {
  private readonly rpcClient: RpcClient;
  private registeredPrograms: Map<string, RegisteredProgram> = new Map();
  private eventHandlers: Map<string, EventHandler<any>> = new Map();
  private isRunning: boolean = false;
  private currentSlot: number;
  private cursorStore?: CursorStore;
  private enableUIProgress: boolean = false;
  private cursorKey: string;
  private db:
    | (NodePgDatabase<Record<string, never>> & { $client: Pool })
    | null = null;
  private uiShutdown?: () => void;
  private progressState = {
    requestTimestamps: [] as number[],
    eventStats: new Map<string, { count: number; totalDuration: number; contractAddress: string }>(),
    startSlot: 0,
    latestSlot: 0,
    startTime: 0,
  };

  constructor(config: IndexerConfig) {
    this.rpcClient = new RpcClient({ endpoint: config.rpcUrl });
    this.currentSlot = config.startBlock;
    this.cursorKey = config.cursorKey ?? "default";
    this.enableUIProgress = config.enableUIProgress ?? false;
    if (config.databaseUrl) {
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
      });
      this.cursorStore = new CursorStore(config.databaseUrl);
      this.db = drizzle({ client: pool });
    }
  }

  /**
   * Register a program ID with specific event types to monitor
   * @param programId The program ID to monitor
   * @param eventTypes Array of event names to filter for
   * @param idl The Anchor IDL object for this program
   */
  registerProgram(programId: string, eventTypes: string[], idl: any): void {
    // Validate that the IDL contains the requested event types
    this.validateEventTypes(idl, eventTypes);

    this.registeredPrograms.set(programId, {
      programId,
      eventTypes,
      idl,
    });
    console.log(
      `Registered program ${programId} with event types:`,
      eventTypes,
    );
  }

  /**
   * Validate that the IDL contains the requested event types
   */
  private validateEventTypes(idl: any, eventTypes: string[]): void {
    if (!idl || !idl.events) {
      throw new Error("IDL must contain events array");
    }

    const availableEvents = idl.events.map((event: any) => event.name);
    const missingEvents = eventTypes.filter(
      (eventType) => !availableEvents.includes(eventType),
    );

    if (missingEvents.length > 0) {
      throw new Error(
        `IDL does not contain events: ${missingEvents.join(", ")}. Available events: ${availableEvents.join(", ")}`,
      );
    }
  }

  /**
   * Get all registered program IDs
   */
  getRegisteredProgramIds(): string[] {
    return Array.from(this.registeredPrograms.keys());
  }

  /**
   * Get registered event types for a specific program
   */
  getEventTypesForProgram(programId: string): string[] {
    const program = this.registeredPrograms.get(programId);
    return program?.eventTypes || [];
  }

  /**
   * Register an event handler for a specific program and event
   * @param config Configuration for the event handler
   * @returns A function to remove the event handler
   */
  public async onEvent<
    TIdl extends Idl,
    TEventName extends ExtractEventNames<TIdl> = ExtractEventNames<TIdl>,
  >(config: OnEventConfig<TIdl, TEventName>): Promise<() => void> {
    const handlerId = `${config.programId}-${config.eventName}-${Date.now()}`;

    const eventHandler: EventHandler<TIdl, TEventName> = {
      id: handlerId,
      programId: config.programId,
      idl: config.idl,
      eventName: config.eventName,
      handler: config.handler,
    };

    this.eventHandlers.set(handlerId, eventHandler);

    if (!this.registeredPrograms.has(config.programId)) {
      this.registerProgram(config.programId, [config.eventName], config.idl);
    } else {
      // Add the event type to existing program if not already included
      const existingProgram = this.registeredPrograms.get(config.programId);
      if (
        existingProgram &&
        !existingProgram.eventTypes.includes(config.eventName)
      ) {
        existingProgram.eventTypes.push(config.eventName);
        console.log(
          `Added event type ${config.eventName} to existing program ${config.programId}`,
        );
      }
    }

    console.log(
      `Registered event handler for ${config.eventName} on program ${config.programId}`,
    );

    return () => {
      this.eventHandlers.delete(handlerId);
      console.log(
        `Removed event handler for ${config.eventName} on program ${config.programId}`,
      );
    };
  }

  /**
   * Get all registered event handlers
   */
  getEventHandlers(): EventHandler<any>[] {
    return Array.from(this.eventHandlers.values());
  }

  /**
   * Remove all event handlers for a specific program
   */
  removeEventHandlersForProgram(programId: string): void {
    const handlersToRemove = Array.from(this.eventHandlers.entries())
      .filter(([_, handler]) => handler.programId === programId)
      .map(([id, _]) => id);

    handlersToRemove.forEach((id) => this.eventHandlers.delete(id));
    console.log(
      `Removed ${handlersToRemove.length} event handlers for program ${programId}`,
    );
  }

  /**
   * Start the indexer to process blocks from the configured start block
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log("Indexer is already running");
      return;
    }

    this.isRunning = true;
    
    // Initialize progress state
    this.progressState.startSlot = this.currentSlot;
    this.progressState.startTime = Date.now();
    this.progressState.latestSlot = await this.rpcClient.getSlot();
    
    // Setup UI if enabled
    if (this.enableUIProgress) {
      const { setupProgressUi } = await import('../ui/progress.js');
      this.uiShutdown = setupProgressUi(() => this.getProgressUiState());
    }
    
    // Initialize cursor store if available
    if (this.cursorStore) {
      await this.cursorStore.connect();
      await this.cursorStore.init();
      const existing = await this.cursorStore.getCursor(this.cursorKey);
      if (existing && existing.last_slot > 0) {
        this.currentSlot = existing.last_slot + 1; // resume from next slot
      }
    }

    console.log(`Starting indexer from block ${this.currentSlot}`);
    console.log(`Monitoring programs:`, this.getRegisteredProgramIds());

    try {
      await this.processBlocks();
    } catch (error) {
      console.error("Indexer error:", error);
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Stop the indexer
   */
  stop(): void {
    this.isRunning = false;
    
    // Shutdown UI if it was enabled
    if (this.uiShutdown) {
      this.uiShutdown();
      this.uiShutdown = undefined;
    }
    
    console.log("Indexer stopped");
    if (this.cursorStore) {
      this.cursorStore.close().catch(() => {});
    }
  }

  /**
   * Process blocks continuously
   */
  private async processBlocks(): Promise<void> {
    while (this.isRunning) {
      try {
        const latestSlot = await this.rpcClient.getSlot();

        if (this.currentSlot <= latestSlot) {
          await this.processBlock(this.currentSlot);
          this.currentSlot++;
        } else {
          // Wait a bit before checking for new blocks
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error(`Error processing block ${this.currentSlot}:`, error);
        // Continue with next block
        this.currentSlot++;
      }
    }
  }

  /**
   * Process a single block for registered programs and events
   */
  private async processBlock(slot: number): Promise<void> {
    // Track request for RPS calculation
    this.progressState.requestTimestamps.push(Date.now());
    if (this.progressState.requestTimestamps.length > 100) {
      this.progressState.requestTimestamps.shift(); // keep last 100
    }
    
    const programIds = this.getRegisteredProgramIds();

    if (programIds.length === 0) {
      console.log(`No programs registered, skipping block ${slot}`);
      return;
    }

    try {
      // Create program IDL mapping
      const programIdls = new Map<string, Idl>();
      this.registeredPrograms.forEach((program, programId) => {
        programIdls.set(programId, program.idl);
      });

      const blockData = await this.rpcClient.getBlockWithEvents(slot, {
        programIds,
        programIdls,
      });

      if (!blockData) {
        console.log(`No block data found for slot ${slot}`);
        return;
      }

      console.log(
        `Processing block ${slot} with ${blockData.transactions.length} transactions`,
      );

      for (const transaction of blockData.transactions) {
        for (const eventInfo of transaction.events) {
          const startTime = performance.now();
          await this.handleEvent(eventInfo, transaction);
          
          // Track event stats
          const duration = performance.now() - startTime;
          const key = `${eventInfo.programId}-${eventInfo.event.name}`;
          const existing = this.progressState.eventStats.get(key);
          if (existing) {
            existing.count++;
            existing.totalDuration += duration;
          } else {
            this.progressState.eventStats.set(key, {
              count: 1,
              totalDuration: duration,
              contractAddress: eventInfo.programId.slice(0, 16),
            });
          }
        }
      }

      if (this.cursorStore && blockData.block_hash) {
        await this.cursorStore.upsertCursor(
          this.cursorKey,
          slot,
          blockData.block_hash,
        );
      }
    } catch (error) {
      console.error(`Error fetching block ${slot}:`, error);
    }
  }

  /**
   * Handle a decoded event
   */
  private async handleEvent(
    eventInfo: { index: number; programId: string; event: any },
    transaction: any,
  ): Promise<void> {
    const { programId, event } = eventInfo;
    const registeredProgram = this.registeredPrograms.get(programId);

    if (!registeredProgram) {
      return;
    }

    // Check if this event type is registered for monitoring
    if (event.name && registeredProgram.eventTypes.includes(event.name)) {
      // console.log(`Event detected: ${event.name} from program ${programId}`);
      // Parse event with the provided IDL for better type safety
      const parsedEvent = this.parseEventWithIdl(event, registeredProgram.idl);

      // Call all registered event handlers for this contract and event
      await this.callEventHandlers(
        programId,
        event.name,
        parsedEvent,
        transaction,
      );
    }
  }

  /**
   * Call all registered event handlers for a specific program and event
   */
  private async callEventHandlers(
    programId: string,
    eventName: string,
    parsedEvent: any,
    transaction: any,
  ): Promise<void> {
    const relevantHandlers = Array.from(this.eventHandlers.values()).filter(
      (handler) =>
        handler.programId === programId && handler.eventName === eventName,
    );

    for (const handler of relevantHandlers) {
      try {
        // Create event object with additional context
        const eventData = {
          ...parsedEvent,
          programId,
          eventName,
        };
        if (!this.db) {
          throw new Error("Database not initialized");
        }
        await handler.handler(eventData, this.db);
      } catch (error) {
        console.error(
          `Error in event handler for ${eventName} on ${programId}:`,
          error,
        );
      }
    }
  }

  /**
   * Parse event data using the provided IDL for better type safety
   */
  private parseEventWithIdl(event: any, idl: Idl): any {
    try {
      // Find the event definition in the IDL
      if (!idl.events) {
        console.warn(`No events defined in IDL`);
        return event.parsed;
      }
      const eventDefinition = idl.events.find(
        (e: IdlEvent) => e.name === event.name,
      );
      if (!eventDefinition) {
        console.warn(`Event definition not found in IDL for ${event.name}`);
        return event.parsed;
      }

      // Return the parsed event with IDL context
      return {
        name: event.name,
        contract: event.contract,
        type: event.type,
        parsed: event.parsed,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error(`Error parsing event with IDL:`, error);
      return event.parsed;
    }
  }

  /**
   * Get current indexer status
   */
  getStatus(): {
    isRunning: boolean;
    currentSlot: number;
    registeredPrograms: number;
    eventHandlers: number;
  } {
    return {
      isRunning: this.isRunning,
      currentSlot: this.currentSlot,
      registeredPrograms: this.registeredPrograms.size,
      eventHandlers: this.eventHandlers.size,
    };
  }

  private getProgressUiState(): any {
    const now = Date.now();
    const rps = this.calculateRPS(now);
    const progress = this.calculateProgress();
    const eta = this.calculateETA(rps, progress);
    
    return {
      chain: 'Solana',
      status: this.isRunning ? 'Running' : 'Stopped',
      block: this.currentSlot,
      rps,
      percent: progress,
      eta,
      mode: this.currentSlot >= this.progressState.latestSlot ? 'live' : 'historical',
      events: Array.from(this.progressState.eventStats.entries()).map(([name, stats]) => ({
        eventName: name,
        count: stats.count,
        averageDuration: stats.count > 0 ? stats.totalDuration / stats.count : 0,
        contractAddress: stats.contractAddress,
      })),
      health: {
        database: this.db !== null,
        ws: false,
        rpc: true,
      },
    };
  }

  private calculateRPS(now: number): number {
    const recentRequests = this.progressState.requestTimestamps.filter(
      ts => now - ts < 10000 // last 10 seconds
    );
    return recentRequests.length / 10;
  }

  private calculateProgress(): number {
    if (this.progressState.latestSlot === 0) return 0;
    const total = this.progressState.latestSlot - this.progressState.startSlot;
    const current = this.currentSlot - this.progressState.startSlot;
    
    // If we're doing historical sync and have processed a reasonable amount,
    // show some progress even if it's very small
    if (total > 1000000 && current > 100) {
      // For very large historical syncs, show progress based on time elapsed
      const timeElapsed = Date.now() - this.progressState.startTime;
      const estimatedTotalTime = timeElapsed * (total / current);
      return Math.min(0.99, timeElapsed / estimatedTotalTime);
    }
    
    return Math.min(1, current / total);
  }

  private calculateETA(rps: number, progress: number): number {
    if (rps === 0 || progress >= 1) return 0;
    const remaining = this.progressState.latestSlot - this.currentSlot;
    return remaining / rps;
  }
}
