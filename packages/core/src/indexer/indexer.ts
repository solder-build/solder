import { RpcClient, type BlockTransactionInfo, type BlockInfoResult } from "../rpc/rpc";
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

type BlockProcessingContext = {
  programIds: string[];
  programIdls: Map<string, AnchorIdl>;
  txProgramIds: string[];
  hasEventHandlers: boolean;
  hasTransactionHandlers: boolean;
};

type SignatureState = {
  latestSignature: string | null;
  latestSlot: number | null;
  backfillBefore: string | null;
  backfillSlot: number | null;
  historicalComplete: boolean;
};

export class Indexer {
  private readonly HISTORICAL_CHUNK_SIZE = 50;
  private readonly HISTORICAL_CONCURRENCY = 10;
  private readonly HISTORICAL_HEADROOM = 2;
  private readonly signatureBatchSize: number;
  private readonly useTransactionHistory: boolean;

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
  private signatureState: Map<string, SignatureState> = new Map();

  constructor(config: IndexerConfig) {
    this.rpcClient = new RpcClient({ endpoint: config.rpcUrl ?? "https://api.mainnet-beta.solana.com" });
    this.currentSlot = config.startBlock;
    this.cursorKey = config.cursorKey ?? "default";
    this.enableUIProgress = config.enableUIProgress ?? false;
    this.useTransactionHistory = config.useTransactionHistory ?? true;
    this.signatureBatchSize = config.signatureBatchSize ?? 500;
    if (config.databaseUrl) {
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/postgres",
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

    if (this.useTransactionHistory) {
      await this.processProgramSignatures();
      return;
    }

    if (this.currentSlot < latestSlot - this.HISTORICAL_HEADROOM) {
      await this.processHistoricalRange(this.currentSlot, latestSlot - this.HISTORICAL_HEADROOM);
    }

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
      this.cursorStore.close().catch(() => { });
    }
  }

  /**
   * Process blocks continuously
   */
  private async processBlocks(): Promise<void> {
    while (this.isRunning) {
      try {
        const latestSlot = Number(await this.rpcClient.getSlot());

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

    const context = this.buildBlockProcessingContext();
    if (!context.hasEventHandlers && !context.hasTransactionHandlers) {
      console.log(`No programs registered, skipping block ${slot}`);
      return;
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

      if (!blockInfo) {
        return;
      }

      await this.handleBlockData(slot, blockInfo, context);
    } catch (error) {
      console.error(`Error fetching block ${slot}:`, error);
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

    let lastLatestSlotUpdate = Date.now();
    const LATEST_SLOT_UPDATE_INTERVAL = 5000; // Update latestSlot every 5 seconds

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
          const blockFetchStart = performance.now();
          
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
            const fetchDuration = performance.now() - blockFetchStart;
            console.log(`[processHistoricalRange] Slot ${slot}: fetched in ${fetchDuration.toFixed(2)}ms ${blockInfo ? '✓' : '✗ (no block)'}`);
            return { slot, blockInfo };
          } catch (error) {
            const fetchDuration = performance.now() - blockFetchStart;
            console.error(`[processHistoricalRange] Slot ${slot}: error after ${fetchDuration.toFixed(2)}ms:`, error);
            return { slot, blockInfo: null };
          }
        },
        this.HISTORICAL_CONCURRENCY
      );
      const fetchDuration = performance.now() - fetchStart;

      const validBlocks = fetchedBlocks.filter(r => r.blockInfo !== null);
      const processStart = performance.now();
      
      // Process results in order
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
        this.currentSlot = maxSlot + 1;
      }

      console.log(
        `[processHistoricalRange] Chunk slots ${chunkStart}-${chunkEnd}: ` +
        `fetched ${validBlocks.length}/${slotsToFetch.length} blocks in ${fetchDuration.toFixed(2)}ms, ` +
        `processed in ${processDuration.toFixed(2)}ms (total: ${(fetchDuration + processDuration).toFixed(2)}ms)`
      );

      // Periodically refresh latestSlot to keep progress calculations accurate
      const now = Date.now();
      if (now - lastLatestSlotUpdate >= LATEST_SLOT_UPDATE_INTERVAL) {
        try {
          const latestSlot = Number(await this.rpcClient.getSlot());
          this.progressState.latestSlot = latestSlot;
          lastLatestSlotUpdate = now;
        } catch (error) {
          console.error("Error updating latest slot:", error);
        }
      }
    }

    // Ensure currentSlot is set to the next slot after the range
    this.currentSlot = toSlot + 1;
    
    // Final update of latestSlot before transitioning to real-time sync
    try {
      const latestSlot = Number(await this.rpcClient.getSlot());
      this.progressState.latestSlot = latestSlot;
    } catch (error) {
      console.error("Error updating latest slot:", error);
    }
  }

  private getAllHandlerProgramIds(context: BlockProcessingContext): string[] {
    const set = new Set<string>();
    context.programIds.forEach((id) => set.add(id));
    context.txProgramIds.forEach((id) => set.add(id));
    return Array.from(set);
  }

  private async processProgramSignatures(): Promise<void> {
    const context = this.buildBlockProcessingContext();
    if (!context.hasEventHandlers && !context.hasTransactionHandlers) {
      console.log("No handlers registered; nothing to process.");
      this.isRunning = false;
      return;
    }

    await this.loadSignatureState(context);
    await this.processHistoricalSignatures(context);
    await this.processLiveSignatures(context);
  }

  private async loadSignatureState(context: BlockProcessingContext): Promise<void> {
    const programIds = this.getAllHandlerProgramIds(context);
    for (const programId of programIds) {
      const existing: SignatureState = this.signatureState.get(programId) ?? {
        latestSignature: null,
        latestSlot: null,
        backfillBefore: null,
        backfillSlot: null,
        historicalComplete: false,
      };

      if (this.cursorStore) {
        const record = await this.cursorStore.getSignatureCursor(this.cursorKey, programId);
        if (record) {
          this.signatureState.set(programId, {
            latestSignature: record.latest_signature,
            latestSlot: record.latest_slot,
            backfillBefore: record.backfill_before,
            backfillSlot: record.backfill_slot,
            historicalComplete: record.backfill_before === null && record.backfill_slot !== null,
          });
          continue;
        }
      }

      this.signatureState.set(programId, existing);
    }
  }

  private async processHistoricalSignatures(context: BlockProcessingContext): Promise<void> {
    const programIds = this.getAllHandlerProgramIds(context);
    const minSlot = this.progressState.startSlot;
    let hasMore = true;

    console.log(
      `[signatures] Historical backfill start (minSlot=${minSlot}, batch=${this.signatureBatchSize})`,
    );

    while (this.isRunning && hasMore) {
      hasMore = false;

      for (const programId of programIds) {
        const state = this.signatureState.get(programId);
        if (!state || state.historicalComplete) continue;

        this.trackRequestTimestamp();
        const fetchStart = performance.now();
        const signatures = await this.rpcClient.getSignaturesForAddress(programId, {
          limit: this.signatureBatchSize,
          before: state.backfillBefore ?? undefined,
        });
        const fetchDuration = performance.now() - fetchStart;

        if (!signatures.length) {
          state.historicalComplete = true;
          console.log(`[signatures][historical] ${programId}: no more signatures, marking complete`);
          await this.persistSignatureState(programId, state);
          continue;
        }

        const eligible = signatures.filter((sig) => sig.slot >= minSlot);
        if (eligible.length === 0) {
          state.historicalComplete = true;
          console.log(
            `[signatures][historical] ${programId}: reached minSlot boundary (${minSlot}), marking complete`,
          );
          await this.persistSignatureState(programId, state);
          continue;
        }

        const ordered = eligible.reverse(); // process oldest -> newest for stable ordering
        for (const sig of ordered) {
          await this.processSignature(programId, sig.signature, sig.slot, context);
          state.latestSignature = sig.signature;
          state.latestSlot = sig.slot;
          this.currentSlot = Math.max(this.currentSlot, sig.slot + 1);
          this.progressState.latestSlot = Math.max(this.progressState.latestSlot, sig.slot);
        }

        const oldest = signatures[signatures.length - 1]!;
        state.backfillBefore = oldest.signature;
        state.backfillSlot = oldest.slot;
        if (oldest.slot < minSlot) {
          state.historicalComplete = true;
        }

        hasMore = signatures.length === this.signatureBatchSize;
        console.log(
          `[signatures][historical] ${programId}: processed ${ordered.length}/${signatures.length} eligible (fetched in ${fetchDuration.toFixed(
            2,
          )}ms) nextBefore=${state.backfillBefore ?? "n/a"} hasMore=${hasMore}`,
        );
        await this.persistSignatureState(programId, state);
      }
    }
  }

  private async processLiveSignatures(context: BlockProcessingContext): Promise<void> {
    const programIds = this.getAllHandlerProgramIds(context);

    console.log(
      `[signatures] Live polling start (batch=${this.signatureBatchSize})`,
    );

    while (this.isRunning) {
      for (const programId of programIds) {
        const state = this.signatureState.get(programId);
        if (!state) continue;

        const newSignatures = await this.fetchNewSignatures(programId, state.latestSignature);
        if (newSignatures.length === 0) {
          continue;
        }

        const ordered = newSignatures.reverse();
        for (const sig of ordered) {
          await this.processSignature(programId, sig.signature, sig.slot, context);
          state.latestSignature = sig.signature;
          state.latestSlot = sig.slot;
          this.currentSlot = Math.max(this.currentSlot, sig.slot + 1);
          this.progressState.latestSlot = Math.max(this.progressState.latestSlot, sig.slot);
        }

        console.log(
          `[signatures][live] ${programId}: processed ${ordered.length} new signatures (latestSlot=${state.latestSlot ?? "n/a"})`,
        );

        await this.persistSignatureState(programId, state);
      }

      try {
        const latestSlot = Number(await this.rpcClient.getSlot());
        this.progressState.latestSlot = Math.max(this.progressState.latestSlot, latestSlot);
      } catch (error) {
        console.error("Error updating latest slot:", error);
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  private async fetchNewSignatures(programId: string, latestSignature: string | null): Promise<Array<{ signature: string; slot: number }>> {
    const collected: Array<{ signature: string; slot: number }> = [];
    let before: string | undefined;
    const limit = this.signatureBatchSize;

    while (true) {
      this.trackRequestTimestamp();
      const batch = await this.rpcClient.getSignaturesForAddress(programId, {
        limit,
        before,
      });

      if (!batch.length) break;

      if (!latestSignature) {
        collected.push(...batch.map((b) => ({ signature: b.signature, slot: b.slot })));
        if (batch.length < limit) break;
        const tail = batch[batch.length - 1];
        if (tail) {
          before = tail.signature;
        }
        continue;
      }

      const idx = batch.findIndex((b) => b.signature === latestSignature);
      if (idx === -1) {
        collected.push(...batch.map((b) => ({ signature: b.signature, slot: b.slot })));
        if (batch.length < limit) break;
        const tail = batch[batch.length - 1];
        if (tail) {
          before = tail.signature;
        }
        continue;
      }

      if (idx > 0) {
        collected.push(
          ...batch.slice(0, idx).map((b) => ({ signature: b.signature, slot: b.slot }))
        );
      }
      break;
    }

    return collected;
  }

  private async processSignature(
    programId: string,
    signature: string,
    slot: number,
    context: BlockProcessingContext,
  ): Promise<void> {
    this.trackRequestTimestamp();
    const start = performance.now();

    const blockInfo = await this.rpcClient.getTransactionInfo(signature, {
      includeEvents: context.hasEventHandlers,
      includeInstructions: context.hasTransactionHandlers,
      eventFilter: context.hasEventHandlers
        ? { programIds: context.programIds, programIdls: context.programIdls }
        : undefined,
      instructionFilter: context.hasTransactionHandlers
        ? { programIds: context.txProgramIds, programIdls: context.programIdls }
        : undefined,
    });

    if (!blockInfo) {
      console.log(`[signatures][txn] ${programId}: skip ${signature} (no block info)`);
      return;
    }

    const wrapped: BlockInfoResult = {
      block_number: blockInfo.block_number,
      block_hash: blockInfo.block_hash,
      block_time: blockInfo.block_ts,
      transactions: [blockInfo],
    };

    try {
      await this.handleBlockData(slot, wrapped, context);
      const duration = performance.now() - start;
      console.log(
        `[signatures][txn] ${programId}: processed ${signature} slot=${slot} ` +
        `events=${blockInfo.events.length} instr=${blockInfo.instructions.length} ` +
        `in ${duration.toFixed(2)}ms`,
      );
    } catch (error) {
      console.error(`[signature] Error processing ${programId} ${signature}:`, error);
    }
  }

  private async persistSignatureState(programId: string, state: SignatureState): Promise<void> {
    if (!this.cursorStore) return;
    await this.cursorStore.upsertSignatureCursor({
      cursorKey: this.cursorKey,
      programId,
      latestSignature: state.latestSignature,
      latestSlot: state.latestSlot,
      backfillBefore: state.backfillBefore,
      backfillSlot: state.backfillSlot,
    });
  }

  private trackRequestTimestamp(): void {
    this.progressState.requestTimestamps.push(Date.now());
    if (this.progressState.requestTimestamps.length > 100) {
      this.progressState.requestTimestamps.shift();
    }
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
