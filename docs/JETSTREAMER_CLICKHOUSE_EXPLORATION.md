# JetStreamer + ClickHouse Exploration Results

## Overview

This document captures exploration findings on **JetStreamer** (high-performance Solana data source) and **ClickHouse** (analytical database) and their potential integration with the Solder framework.

## JetStreamer Exploration

### What is JetStreamer?

**JetStreamer** is a high-performance Solana indexing and data processing tool developed by Anza (formerly Solana Labs). It's designed for real-time indexing, research, and historical backfilling of Solana blockchain data.

### Key Findings

#### 1. Performance Characteristics

- **Throughput**: Capable of processing **2.7+ million transactions per second**
- **Data Source**: Provides both historical backfill and real-time streaming
- **Efficiency**: Uses compact index format for fast historical data access
- **Scalability**: Designed to handle full Solana mainnet data

#### 2. Architecture & Components

From the Carbon framework integration (found in `third_party/carbon/datasources/jetstreamer-datasource/`):

**Core Components:**
- `JetstreamerDatasource`: Main data source adapter
- `JetstreamerRange`: Supports slot ranges or epoch-based queries
  - `Slot(from, to)`: Query by slot range
  - `Epoch(epoch)`: Query by epoch number
- `JetstreamerFilter`: Transaction filtering capabilities
  - Program ID filtering
  - Account filtering
  - Custom transaction filters

**Integration Pattern:**
```rust
let jetstreamer = JetstreamerDatasource::new_with_old_faithful_mainnet(
    JetstreamerRange::Slot(367_200_000, 367_631_999),
    JetstreamerFilter {
        transaction_filter: TransactionFilter::ProgramId("..."),
    },
);
```

#### 3. Data Access Patterns

**Historical Backfill:**
- Uses compact index format stored in archives
- Environment variables for configuration:
  - `JETSTREAMER_COMPACT_INDEX_BASE_URL`: Archive URL
  - `JETSTREAMER_NETWORK`: Network identifier
- Supports slot ranges and epoch-based queries

**Real-Time Streaming:**
- Firehose pattern for live transaction streaming
- Built-in filtering at the datasource level
- Efficient transaction routing

#### 4. Built-in ClickHouse Integration

**Key Discovery**: JetStreamer has **native ClickHouse integration** built-in.

**Components:**
- `JetstreamerRunner`: Can spawn ClickHouse server instances
- Cargo aliases for ClickHouse management:
  - `cargo clickhouse-server`: Launches ClickHouse server
  - `cargo clickhouse-client`: Connects to ClickHouse instance

**Integration Benefits:**
- Direct data pipeline from JetStreamer → ClickHouse
- Optimized for analytical workloads
- Real-time data ingestion capabilities

### Technical Details Discovered

#### Carbon Framework Integration

The Carbon framework (found in `third_party/carbon/`) provides a reference implementation:

**Location**: `third_party/carbon/datasources/jetstreamer-datasource/`

**Dependencies**:
- `jetstreamer-firehose = "0.2.0"`: Core JetStreamer client library

**Metrics Tracked**:
- `jetstreamer_blocks_sent`
- `jetstreamer_transactions_filtered_in/out`
- `jetstreamer_internal_slots_processed`
- `jetstreamer_internal_blocks_processed`
- `jetstreamer_internal_transactions_processed`

#### Example Usage Pattern

```rust
// From carbon/examples/jetstreamer/src/main.rs
let jetstreamer = JetstreamerDatasource::new_with_old_faithful_mainnet(
    JetstreamerRange::Slot(367_200_000, 367_631_999),
    JetstreamerFilter {
        transaction_filter: TransactionFilter::ProgramId(
            "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        ),
    },
);

// Pipeline configuration
let pipeline = Pipeline::new()
    .datasource(jetstreamer)
    .decoder(decoder)
    .build();
```

## JetStreamer + ClickHouse Integration

### How They Work Together

**Discovery**: JetStreamer has **built-in ClickHouse integration** through the `JetstreamerRunner` component.

**Integration Flow:**
```
JetStreamer → Processes Solana Data → Writes to ClickHouse
```

**Key Components:**
1. **JetStreamer**: High-performance data source
2. **ClickHouse Server**: Spawned/managed by JetStreamer
3. **Data Pipeline**: Direct ingestion from blockchain to analytics DB

### Integration Benefits

#### 1. Performance
- **Fast Ingestion**: 2.7M+ txs/sec → ClickHouse
- **Efficient Storage**: Columnar format + compression
- **Fast Queries**: Sub-second analytics on billions of rows

#### 2. Architecture
- **Single Pipeline**: JetStreamer handles both data source and ClickHouse setup
- **Managed Infrastructure**: ClickHouse server can be spawned automatically
- **Optimized Path**: Direct data flow without intermediate steps

#### 3. Developer Experience
- **Simple Setup**: Cargo aliases for ClickHouse management
- **Integrated Tools**: Built-in client for data inspection
- **Unified Workflow**: One toolchain for indexing and analytics

### Technical Integration Details

#### JetStreamerRunner Component

**Capabilities:**
- Spawns ClickHouse server instances
- Manages ClickHouse lifecycle
- Provides client access

**Commands:**
```bash
cargo clickhouse-server  # Launch ClickHouse server
cargo clickhouse-client  # Connect to ClickHouse instance
```

## Key Learnings & Insights

### 1. Performance Gap

**Finding**: Current RPC-based approach has significant performance limitations
- Rate limiting (100 req/sec)
- Sequential processing
- Network overhead

**JetStreamer Advantage**: 
- Higher throughput
- Parallel processing
- Optimized data format

### 2. Storage Optimization

**Finding**: PostgreSQL row-based storage not optimal for analytics
- Full table scans for aggregations
- Limited compression
- Expensive for time-series queries

**ClickHouse Advantage**:
- Columnar storage (read only needed columns)
- 10-100x compression
- Built-in time-series functions

### 3. Architecture Pattern

**Finding**: Separation of concerns improves scalability
- **PostgreSQL**: Transactional state, APIs, correctness
- **ClickHouse**: Analytics, aggregations, dashboards

**Benefit**: Each database optimized for its use case

### 4. Integration Complexity

**Finding**: JetStreamer + ClickHouse integration is already built
- No need to build custom integration
- Managed infrastructure available
- Production-ready components

**Consideration**: Need to adapt for TypeScript/Node.js (JetStreamer is Rust-based)

## Technical Challenges Identified

### 1. Language Barrier

**Challenge**: JetStreamer is Rust-based, Solder is TypeScript

**Potential Solutions**:
- Use JetStreamer via HTTP API (if available)
- Create Node.js bindings (napi-rs)
- Use Carbon framework as reference
- Build TypeScript wrapper around Rust binary

## References & Resources

### JetStreamer
- **GitHub**: https://github.com/anza-xyz/jetstreamer
- **Carbon Integration**: `third_party/carbon/datasources/jetstreamer-datasource/`
- **Example**: `third_party/carbon/examples/jetstreamer/`

### ClickHouse
- **Documentation**: https://clickhouse.com/docs
- **NATS Integration**: https://clickhouse.com/docs/integrations/nats
- **Node.js Client**: Various npm packages available

### Related Projects
- **Carbon Framework**: Reference implementation using JetStreamer

## Conclusion

### Key Takeaways

1. **JetStreamer** offers 10-100x performance improvement for historical backfilling
2. **ClickHouse** provides optimal storage and query performance for analytics
3. **Built-in Integration** exists between JetStreamer and ClickHouse
4. **Language Barrier** is the main technical challenge (Rust → TypeScript)
