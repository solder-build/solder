import { Connection } from "@solana/web3.js";
import { RpcClient } from "../rpc/rpc.js";
import { EventType } from "../idl/idl-types.js";

export interface IndexerConfig {
  startBlock: number;
  rpcUrl: string;
}

export interface RegisteredProgram {
  programId: string;
  eventTypes: string[];
}

export class Indexer {
  private readonly rpcClient: RpcClient;
  private registeredPrograms: Map<string, RegisteredProgram> = new Map();
  private isRunning: boolean = false;
  private currentSlot: number;

  constructor(config: IndexerConfig) {
    this.rpcClient = new RpcClient({ endpoint: config.rpcUrl });
    this.currentSlot = config.startBlock;
  }

  /**
   * Register a program ID with specific event types to monitor
   */
  registerProgram(programId: string, eventTypes: string[]): void {
    this.registeredPrograms.set(programId, {
      programId,
      eventTypes
    });
    console.log(`Registered program ${programId} with event types:`, eventTypes);
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
   * Start the indexer to process blocks from the configured start block
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log("Indexer is already running");
      return;
    }

    this.isRunning = true;
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
    console.log("Indexer stopped");
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
          await new Promise(resolve => setTimeout(resolve, 1000));
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
    const programIds = this.getRegisteredProgramIds();
    
    if (programIds.length === 0) {
      console.log(`No programs registered, skipping block ${slot}`);
      return;
    }

    try {
      const blockData = await this.rpcClient.getBlockWithEvents(slot, { programIds });
      
      if (!blockData) {
        console.log(`No block data found for slot ${slot}`);
        return;
      }

      console.log(`Processing block ${slot} with ${blockData.transactions.length} transactions`);

      for (const transaction of blockData.transactions) {
        for (const event of transaction.events) {
          await this.handleEvent(event, transaction);
        }
      }
    } catch (error) {
      console.error(`Error fetching block ${slot}:`, error);
    }
  }

  /**
   * Handle a decoded event
   */
  private async handleEvent(eventInfo: { index: number; programId: string; event: any }, transaction: any): Promise<void> {
    const { programId, event } = eventInfo;
    const registeredProgram = this.registeredPrograms.get(programId);
    
    if (!registeredProgram) {
      return;
    }

    // Check if this event type is registered for monitoring
    if (event.name && registeredProgram.eventTypes.includes(event.name)) {
      console.log(`Event detected: ${event.name} from program ${programId}`);
      console.log(`Transaction: ${transaction.txn_hash}`);
      console.log(`Event data:`, event.parsed);
      
      // Here you would typically store the event data to a database
      // For now, we just log it as requested
    }
  }

  /**
   * Get current indexer status
   */
  getStatus(): { isRunning: boolean; currentSlot: number; registeredPrograms: number } {
    return {
      isRunning: this.isRunning,
      currentSlot: this.currentSlot,
      registeredPrograms: this.registeredPrograms.size
    };
  }
}