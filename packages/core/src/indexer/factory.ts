import { Indexer, IndexerConfig } from "./indexer";
import { RustIndexer } from "./rust-indexer";

export interface RpcIndexerConfig {
    mode: 'rpc';
    startBlock: number;
    rpcUrl: string;
    databaseUrl: string;
    cursorKey?: string;
    enableUIProgress?: boolean;
}

export interface GrpcIndexerConfig {
    mode: 'grpc';
    databaseUrl: string;
    grpcEndpoint: string;
    xToken: string;
    startBlock: number | "latest";
    subscriberName?: string;
    commitmentLevel?: 'processed' | 'confirmed' | 'finalized';
    cursorKey?: string;
}

export type UnifiedIndexerConfig = RpcIndexerConfig | GrpcIndexerConfig;
  
/**
 * Factory function to create the appropriate indexer based on mode
 * @param config Unified configuration for indexer
 * @returns Either Indexer (RPC mode) or RustIndexer (gRPC mode)
 */
export function createIndexer(config: UnifiedIndexerConfig): Indexer | RustIndexer {
  if (config.mode === 'grpc') {
    // TypeScript knows this is GrpcIndexerConfig
    return new RustIndexer(config);
  } else {
    // TypeScript knows this is RpcIndexerConfig
    return new Indexer(config);
  }
}

/**
 * Convenience function to create an RPC indexer with minimal config
 */
export function createRpcIndexer(config: Omit<RpcIndexerConfig, 'mode'>): Indexer {
  return createIndexer({ mode: 'rpc', ...config }) as Indexer;
}

/**
 * Convenience function to create a gRPC indexer with minimal config
 */
export function createGrpcIndexer(config: Omit<GrpcIndexerConfig, 'mode'>): RustIndexer {
  return createIndexer({ mode: 'grpc', ...config }) as RustIndexer;
}
