import { Indexer } from "./indexer";
import { GrpcIndexer } from "./grpc-indexer";
import { GrpcIndexerConfig } from "./grpc-indexer";
import { IndexerConfig } from "../indexer";


export type UnifiedIndexerConfig = { mode: 'rpc' } & IndexerConfig | { mode: 'grpc' } & GrpcIndexerConfig;
  
/**
 * Factory function to create the appropriate indexer based on mode
 * @param config Unified configuration for indexer
 * @returns Either Indexer (RPC mode) or RustIndexer (gRPC mode)
 */
export function createIndexer(config: UnifiedIndexerConfig): Indexer | GrpcIndexer {
  if (config.mode === 'grpc') {
    // TypeScript knows this is GrpcIndexerConfig
    return new GrpcIndexer(config);
  } else {
    // TypeScript knows this is RpcIndexerConfig
    return new Indexer(config);
  }
}

/**
 * Convenience function to create an RPC indexer with minimal config
 */
export function createRpcIndexer(config: IndexerConfig): Indexer {
  return createIndexer({ mode: 'rpc', ...config }) as Indexer;
}

/**
 * Convenience function to create a gRPC indexer with minimal config
 */
export function createGrpcIndexer(config: Omit<GrpcIndexerConfig, 'mode'>): GrpcIndexer {
  return createIndexer({ mode: 'grpc', ...config }) as GrpcIndexer;
}
