export { Indexer } from "./indexer";

export type {
  IndexerConfig,
  WebsocketConfig,
  RegisteredProgram,
  EventHandler,
  OnEventConfig,
  ExtractEventNames,
  ExtractEventData,
  IndexerEvent,
  IndexerTransaction,
  TransactionHandler,
  OnTransactionConfig as RpcOnTransactionConfig,
} from "./types/config.types";

export {
  GrpcIndexer,
  type GrpcIndexerConfig,
  type OnTransactionConfig,
  type GrpcTransaction,
} from "./grpc-indexer";

export {
  createGrpcIndexer,
  createIndexer,
  type UnifiedIndexerConfig,
  createRpcIndexer,
} from "./factory";
