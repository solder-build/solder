import { RpcClient } from "../rpc/rpc";
import type { BlockTransactionInfo, BlockInfoResult, EventFilterOptions, InstructionFilterOptions } from "../types/block";
import { DecodedEvent, isLegacyIdl } from "../idl/idl";
import { CursorStore } from "./db";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { AnchorIdl } from "../idl/idl-types";
import type {
  ExtractEventNames,
  EventHandler,
  IndexerConfig,
  IndexerEvent,
  IndexerTransaction,
  OnEventConfig,
  OnTransactionConfig,
  RegisteredProgram,
  TransactionHandler,
} from "./types/config.types";
import { parallelMap } from "../utils/async";
import { buildBlockInfoResult } from "../utils/block";
import {
  WebSocketChannel,
  type WebSocketSubscription,
  type BlockNotificationPayload,
  type BlockSubscribeConfig,
} from "./channels/websocket-channel";

type BlockProcessingContext = {
  programIds: string[];
  programIdls: Map<string, AnchorIdl>;
  txProgramIds: string[];
  hasEventHandlers: boolean;
  hasTransactionHandlers: boolean;
};

export class Indexer {
  private readonly HISTORICAL_CHUNK_SIZE = 50;
  private readonly HISTORICAL_CONCURRENCY = 10;
  private readonly HISTORICAL_HEADROOM = 2;

  private readonly rpcClient: RpcClient;
  private registeredPrograms: Map<string, RegisteredProgram> = new Map();
  private eventHandlers: Map<string, EventHandler<any>> = new Map();
  private transactionHandlers: Map<string, TransactionHandler> = new Map();
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

  private websocketChannel?: WebSocketChannel;
  private websocketSubscription?: WebSocketSubscription<BlockNotificationPayload>;
  private wsHealthy = false;
  private wsUrl: string;

  constructor(config: IndexerConfig) {
    const {
      rpcUrl = "https://api.mainnet-beta.solana.com",
      startBlock,
      cursorKey = "default",
      enableUIProgress = false,
      databaseUrl,
      wsUrl,
    } = config;

    this.rpcClient = new RpcClient({ endpoint: rpcUrl });
    this.currentSlot = startBlock;
    this.cursorKey = cursorKey;
    this.enableUIProgress = enableUIProgress;
    this.wsUrl = wsUrl;

    const pool = new Pool({
      connectionString: databaseUrl,
    });

    this.cursorStore = new CursorStore(databaseUrl);
    this.db = drizzle({ client: pool });
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
    if (!idl) {
      throw new Error("IDL is required");
    }

    // Check if it's a legacy IDL format
    const isLegacy = isLegacyIdl(idl);

    if (isLegacy) {
      // Legacy IDL validation
      if (!idl.events || !Array.isArray(idl.events)) {
        throw new Error("Legacy IDL must contain events array");
      }
    } else {
      // Current IDL validation
      if (!idl.events || !Array.isArray(idl.events)) {
        throw new Error("IDL must contain events array");
      }
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
    TIdl extends AnchorIdl,
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
   * Register a transaction handler to receive all transactions
   * @param config Configuration for the transaction handler
   * @returns A function to remove the transaction handler
   */
  public async onTransaction<TIdl extends AnchorIdl>(
    config: OnTransactionConfig<TIdl>,
  ): Promise<() => void> {
    const handlerId = `transaction-${config.programId}-${Date.now()}`;

    const transactionHandler: TransactionHandler<TIdl> = {
      id: handlerId,
      programId: config.programId,
      idl: config.idl,
      instructionNames: config.instructionNames,
      handler: config.handler,
    };

    this.transactionHandlers.set(handlerId, transactionHandler);

    console.log(`Registered transaction handler for program ${config.programId}`);

    return () => {
      this.transactionHandlers.delete(handlerId);
      console.log(`Removed transaction handler for program ${config.programId}`);
    };
  }

  /**
   * Get all registered transaction handlers
   */
  getTransactionHandlers(): TransactionHandler[] {
    return Array.from(this.transactionHandlers.values());
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
    const latestSlot = Number(await this.rpcClient.getSlot());
    this.progressState.startSlot = this.currentSlot;
    this.progressState.startTime = Date.now();
    this.progressState.latestSlot = latestSlot;

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
    if (this.transactionHandlers.size > 0) {
      console.log(
        `Monitoring all transactions (${this.transactionHandlers.size} handler(s))`,
      );
    }

    await this.initializeRealtimeSync().catch((error) => {
      console.error("Failed to initialize websocket channel, falling back to HTTP polling:", error);
      return null;
    });

    const historicalTarget = Math.max(latestSlot - 1, this.currentSlot - 1);

    try {
      if (this.currentSlot <= historicalTarget) {
        await this.processHistoricalRange(this.currentSlot, historicalTarget);
      }
    } catch (error) {
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

    if (this.websocketSubscription) {
      this.websocketSubscription.removeAllListeners();
      this.websocketSubscription.unsubscribe().catch(() => {});
      this.websocketSubscription = undefined;
    }

    if (this.websocketChannel) {
      this.websocketChannel.disconnect();
      this.websocketChannel.removeAllListeners();
      this.websocketChannel = undefined;
    }

    this.wsHealthy = false;

    console.log("Indexer stopped");
    if (this.cursorStore) {
      this.cursorStore.close().catch(() => { });
    }
  }

  /**
   * Process a single block for registered programs and events
   */
  private async processBlock(payload: BlockNotificationPayload): Promise<void> {
    const context = this.buildBlockProcessingContext();
    const slot = payload.value.slot ?? payload.context.slot;

    if (
      slot === undefined ||
      slot === null ||
      !payload.value.block ||
      (!context.hasEventHandlers && !context.hasTransactionHandlers)
    ) {
      return;
    }

    const includeEvents = context.hasEventHandlers;
    const includeInstructions = context.hasTransactionHandlers;
    const eventFilter: EventFilterOptions | undefined = includeEvents
      ? { programIds: context.programIds, programIdls: context.programIdls }
      : undefined;
    const instructionFilter: InstructionFilterOptions | undefined = includeInstructions
      ? { programIds: context.txProgramIds, programIdls: context.programIdls }
      : undefined;

    try {
      const blockInfo = buildBlockInfoResult({
        block: payload.value.block,
        slot,
        blockHash: payload.value.block.blockhash ?? "",
        blockTime: payload.value.block.blockTime ?? null,
        includeEvents,
        includeInstructions,
        eventFilter,
        instructionFilter,
      });

      await this.handleBlockData(slot, blockInfo, context);
      this.currentSlot = Math.max(this.currentSlot, slot + 1);
    } catch (error) {
      console.error("[Indexer] Failed to process websocket block:", error);
    }
  }

  private buildBlockProcessingContext(): BlockProcessingContext {
    const programIds = this.getRegisteredProgramIds();
    const programIdls = new Map<string, AnchorIdl>();
    this.registeredPrograms.forEach((program, programId) => {
      programIdls.set(programId, program.idl);
    });

    const txProgramIds = new Set<string>();
    this.transactionHandlers.forEach((handler) => {
      txProgramIds.add(handler.programId);
      if (handler.idl) {
        programIdls.set(handler.programId, handler.idl as AnchorIdl);
      }
    });

    return {
      programIds,
      programIdls,
      txProgramIds: Array.from(txProgramIds),
      hasEventHandlers: programIds.length > 0,
      hasTransactionHandlers: this.transactionHandlers.size > 0,
    };
  }

  private async handleBlockData(
    slot: number,
    blockInfo: BlockInfoResult,
    context: BlockProcessingContext,
  ): Promise<void> {
    const { hasEventHandlers, hasTransactionHandlers } = context;

    if (hasEventHandlers) {
      for (const transaction of blockInfo.transactions) {
        if (!transaction.events?.length) continue;
        for (const eventInfo of transaction.events) {
          const startTime = performance.now();
          await this.handleEvent(eventInfo, transaction);
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
    }

    if (hasTransactionHandlers) {
      for (const transaction of blockInfo.transactions) {
        if (!transaction.instructions?.length) continue;
        await this.handleTransaction(transaction);
      }
    }

    if (this.cursorStore && blockInfo.block_hash) {
      await this.cursorStore.upsertCursor(
        this.cursorKey,
        slot,
        blockInfo.block_hash,
      );
    }
  }

  private async processHistoricalRange(fromSlot: number, toSlot: number): Promise<void> {
    if (fromSlot > toSlot) {
      return;
    }

    const context = this.buildBlockProcessingContext();
    if (!context.hasEventHandlers && !context.hasTransactionHandlers) {
      this.currentSlot = toSlot + 1;
      return;
    }

    for (let chunkStart = fromSlot; chunkStart <= toSlot; chunkStart += this.HISTORICAL_CHUNK_SIZE) {
      const chunkEnd = Math.min(chunkStart + this.HISTORICAL_CHUNK_SIZE - 1, toSlot);
      const slotsToFetch: number[] = [];
      for (let slot = chunkStart; slot <= chunkEnd; slot++) {
        slotsToFetch.push(slot);
      }

      const fetchStart = performance.now();
      const fetchedBlocks = await parallelMap(
        slotsToFetch,
        async (slot) => {          
          // Track RPC request for progress tracking (per block fetch)
          this.progressState.requestTimestamps.push(Date.now());
          if (this.progressState.requestTimestamps.length > 100) {
            this.progressState.requestTimestamps.shift(); // keep last 100
          }

          try {
            const blockInfo = await this.rpcClient.getBlockInfo(slot, {
              includeEvents: context.hasEventHandlers,
              includeInstructions: context.hasTransactionHandlers,
              eventFilter: context.hasEventHandlers
                ? { programIds: context.programIds, programIdls: context.programIdls }
                : undefined,
              instructionFilter: context.hasTransactionHandlers
                ? { programIds: context.txProgramIds, programIdls: context.programIdls }
                : undefined,
            });

            return { slot, blockInfo };
          } catch (error) {
            return { slot, blockInfo: null };
          }
        },
        this.HISTORICAL_CONCURRENCY
      );
      const fetchDuration = performance.now() - fetchStart;

      const validBlocks = fetchedBlocks.filter(r => r.blockInfo !== null);
      const processStart = performance.now();
      
      let maxSlot = 0;
      for (const { slot, blockInfo } of fetchedBlocks) {
        if (blockInfo) {
          await this.handleBlockData(slot, blockInfo, context);
        }
        maxSlot = Math.max(maxSlot, slot);
      }
      const processDuration = performance.now() - processStart;

      // Update currentSlot after processing chunk
      if (maxSlot > 0) {
        this.currentSlot = Math.max(this.currentSlot, maxSlot + 1);
      }

      console.log(
        `[processHistoricalRange] Chunk slots ${chunkStart}-${chunkEnd}: ` +
        `fetched ${validBlocks.length}/${slotsToFetch.length} blocks in ${fetchDuration.toFixed(2)}ms, ` +
        `processed in ${processDuration.toFixed(2)}ms (total: ${(fetchDuration + processDuration).toFixed(2)}ms)`
      );
    }

    this.currentSlot = Math.max(this.currentSlot, toSlot + 1);
  }

  /**
   * Handle a transaction with instructions for transaction handlers
   */
  private async handleTransaction(
    transaction: BlockTransactionInfo,
  ): Promise<void> {
    if (!transaction.instructions || transaction.instructions.length === 0) {
      return;
    }

    if (!transaction.txn_hash) {
      return;
    }

    const allHandlers = Array.from(this.transactionHandlers.values());

    if (allHandlers.length === 0) {
      return;
    }

    const transactionData: IndexerTransaction = {
      hash: transaction.txn_hash,
      slot: transaction.block_number,
      blockTime: transaction.block_ts,
      blockHash: transaction.block_hash,
      instructions: transaction.instructions,
    };

    // Call all transaction handlers
    for (const handler of allHandlers) {
      try {
        // Filter by programId first
        const hasProgramMatch = transaction.instructions.some(
          (instr) => instr.programId === handler.programId,
        );

        if (!hasProgramMatch) {
          continue;
        }

        if (handler.instructionNames && handler.instructionNames.length > 0) {
          const instructionNames = transaction.instructions
            .filter((instr) => instr.programId === handler.programId)
            .map((instr) => (instr.parsed as { name: string }).name);
          const hasNameMatch = handler.instructionNames.some((name) =>
            instructionNames.includes(name),
          );
          if (!hasNameMatch) {
            continue;
          }
        }

        if (!this.db) {
          throw new Error("Database not initialized");
        }
        await handler.handler(transactionData, this.db);
      } catch (error) {
        console.error(`Error in transaction handler:`, error);
      }
    }
  }

  /**
   * Handle a decoded event
   */
  private async handleEvent(
    eventInfo: { index: number; programId: string; event: DecodedEvent },
    transaction: BlockTransactionInfo,
  ): Promise<void> {

    const { programId, event } = eventInfo;
    const registeredProgram = this.registeredPrograms.get(programId);

    if (!registeredProgram) {
      return;
    }

    // Check if this event type is registered for monitoring
    if (event.name && registeredProgram.eventTypes.includes(event.name)) {
      await this.callEventHandlers(
        programId,
        event.name,
        event,
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
    parsedEvent: DecodedEvent,
    transaction: BlockTransactionInfo,
  ): Promise<void> {

    const relevantHandlers = Array.from(this.eventHandlers.values()).filter(
      (handler) =>
        handler.programId === programId && handler.eventName === eventName,
    );

    for (const handler of relevantHandlers) {
      try {
        const eventTimestamp = transaction.block_ts
          ? new Date(transaction.block_ts * 1000).toISOString()
          : new Date().toISOString();

        const eventData: IndexerEvent<AnchorIdl, string> = {
          params: parsedEvent.data as IndexerEvent<AnchorIdl, string>["params"],
          timestamp: eventTimestamp,
          transaction: {
            hash: transaction.txn_hash ?? transaction.block_hash,
            slot: transaction.block_number,
            blockTime: transaction.block_ts ?? 0,
          },
          programId,
          eventName,
        };

        if (!this.db) {
          throw new Error("Database not initialized");
        }
        await handler.handler(eventData as any, this.db);
      } catch (error) {
        console.error(
          `Error in event handler for ${eventName} on ${programId}:`,
          error,
        );
      }
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

  private async initializeRealtimeSync(): Promise<void> {
    if (!this.wsUrl) {
      return;
    }

    this.websocketChannel = new WebSocketChannel({
      nodeUrl: this.wsUrl,
      autoReconnect: true,
      maxBufferSize: 1000,
      requestTimeout: 60_000,
    });

    this.websocketChannel.on("open", () => {
      this.wsHealthy = true;
    });

    this.websocketChannel.on("close", () => {
      this.wsHealthy = false;
    });

    this.websocketChannel.on("error", (error) => {
      console.error("[WebSocketChannel] error:", error);
    });

    await this.websocketChannel.waitForConnection();

    this.websocketSubscription = await this.websocketChannel.subscribeNewHeads({
      commitment: "finalized",
      filter: { mentionsAccountOrProgram: this.getRegisteredProgramIds().join(",") },
      showRewards: false,
      encoding: "jsonParsed",
      transactionDetails: "full",
      maxSupportedTransactionVersion: 0,
    });

    const onData = (payload: BlockNotificationPayload) => {
      if (!payload.context.slot) {
        return;
      }
      this.processBlock(payload);
    };

    const onError = (error: Error) => {
      console.error("[WebSocketSubscription] error:", error);
    };

    const onClose = () => {
      console.warn("[WebSocketSubscription] closed");
    };

    this.websocketSubscription?.on("data", onData);
    this.websocketSubscription?.on("error", onError);
    this.websocketSubscription?.on("close", onClose);
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
        ws: this.websocketChannel ? this.wsHealthy : true,
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
