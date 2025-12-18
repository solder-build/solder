import pc from 'picocolors';
import { patchWriteStreams } from './patch';

export type ProgressEventStat = {
  eventName: string;
  count: number;
  averageDuration: number;
  contractAddress: string;
};

export type ProgressUiState = {
  status: string;
  block: number;
  rps: number;
  percent: number;
  eta: number; // seconds
  mode: 'historical' | 'live' | 'realtime';
  events: ProgressEventStat[];
  streams: {
    historical: {
      slot: number;
      targetSlot: number;
      rps: number;
    };
    realtime: {
      slot: number | null;
      connected: boolean;
    };
  };
  health: {
    database: boolean;
    ws: boolean;
    rpc: boolean;
  };
};

export type ProgressState = {
  requestTimestamps: number[];
  eventStats: Map<string, { count: number; totalDuration: number; contractAddress: string }>;
  startSlot: number;
  latestSlot: number;
  startTime: number;
  historicalSlot: number;
};

export type ProgressUiSource = {
  isRunning: boolean;
  currentSlot: number;
  hasDatabase: boolean;
  wsHealthy: boolean;
  websocketActive: boolean;
};

export class ProgressUiController {
  private state: ProgressState = {
    requestTimestamps: [],
    eventStats: new Map(),
    startSlot: 0,
    latestSlot: 0,
    startTime: 0,
    historicalSlot: 0,
  };
  private realtimeSlot: number | null = null;

  constructor() {}

  initialize(startSlot: number, latestSlot: number): void {
    this.state.startSlot = startSlot;
    this.state.latestSlot = latestSlot;
    this.state.startTime = Date.now();
    this.state.historicalSlot = startSlot;
  }

  updateLatestSlot(latestSlot: number): void {
    this.state.latestSlot = latestSlot;
  }

  recordRequest(timestamp: number = Date.now()): void {
    this.state.requestTimestamps.push(timestamp);
    if (this.state.requestTimestamps.length > 100) {
      this.state.requestTimestamps.shift();
    }
  }

  recordEvent(programId: string, eventName: string, durationMs: number): void {
    const key = `${programId}-${eventName}`;
    const existing = this.state.eventStats.get(key);
    if (existing) {
      existing.count++;
      existing.totalDuration += durationMs;
    } else {
      this.state.eventStats.set(key, {
        count: 1,
        totalDuration: durationMs,
        contractAddress: programId.slice(0, 16),
      });
    }
  }

  recordHistoricalSlot(slot: number): void {
    this.state.historicalSlot = slot;
  }

  recordRealtimeSlot(slot: number): void {
    this.realtimeSlot = slot;
  }

  buildState(source: ProgressUiSource): ProgressUiState {
    const now = Date.now();
    const rps = this.calculateRPS(now);
    const currentHistoricalSlot = this.state.historicalSlot ?? source.currentSlot;
    const percent = this.calculateProgress(currentHistoricalSlot);
    const eta = this.calculateETA(rps, percent, currentHistoricalSlot);
    const websocketConnected = source.websocketActive ? source.wsHealthy : false;

    return {
      status: source.isRunning ? 'Running' : 'Stopped',
      block: currentHistoricalSlot,
      rps,
      percent,
      eta,
      mode: currentHistoricalSlot >= this.state.latestSlot ? 'live' : 'historical',
      events: Array.from(this.state.eventStats.entries()).map(([name, stats]) => ({
        eventName: name,
        count: stats.count,
        averageDuration: stats.count > 0 ? stats.totalDuration / stats.count : 0,
        contractAddress: stats.contractAddress,
      })),
      streams: {
        historical: {
          slot: currentHistoricalSlot,
          targetSlot: this.state.latestSlot,
          rps,
        },
        realtime: {
          slot: this.realtimeSlot,
          connected: websocketConnected,
        },
      },
      health: {
        database: source.hasDatabase,
        ws: websocketConnected,
        rpc: true,
      },
    };
  }

  private calculateRPS(now: number): number {
    const recentRequests = this.state.requestTimestamps.filter((ts) => now - ts < 10_000);
    return recentRequests.length / 10;
  }

  private calculateProgress(currentSlot: number): number {
    if (this.state.latestSlot === 0) return 0;
    const total = this.state.latestSlot - this.state.startSlot;
    const current = currentSlot - this.state.startSlot;

    if (total > 1_000_000 && current > 100) {
      const timeElapsed = Date.now() - this.state.startTime;
      const estimatedTotalTime = timeElapsed * (total / current);
      return Math.min(0.99, timeElapsed / estimatedTotalTime);
    }

    return Math.min(1, current / Math.max(total, 1));
  }

  private calculateETA(rps: number, progress: number, currentSlot: number): number {
    if (rps === 0 || progress >= 1) return 0;
    const remaining = this.state.latestSlot - currentSlot;
    return remaining / rps;
  }

  static setup(getState: () => ProgressUiState): () => void {
    const { refresh, shutdown } = patchWriteStreams({
      getLines: () => ProgressUiController.render(getState()),
    });
    const interval = setInterval(refresh, 100);
    return () => {
      clearInterval(interval);
      shutdown();
    };
  }

  static render(state: ProgressUiState): string[] {
    const lines: string[] = [];

    lines.push('');
    lines.push(pc.bold('Indexing'));
    lines.push('');
    lines.push(
      ...ProgressUiController.buildTable(state.events, [
        { title: 'Event', key: 'eventName', align: 'left', maxWidth: 80 },
        { title: 'Contract', key: 'contractAddress', align: 'right', maxWidth: 16 },
        { title: 'Count', key: 'count', align: 'right' },
        {
          title: 'Duration (ms)',
          key: 'averageDuration',
          align: 'right',
          format: (v) => (v > 0 ? (v < 0.001 ? '<0.001' : v.toFixed(3)) : '-'),
        },
      ]),
    );
    lines.push('');
    lines.push(pc.bold('Pipelines'));
    lines.push('');
    const pipelineRows = [
      {
        pipeline: 'Historical RPC',
        status: state.mode === 'historical' ? pc.yellowBright('Syncing') : pc.greenBright('Live'),
        slot: state.streams.historical.slot,
        detail: `${ProgressUiController.formatPercentage(state.percent)} @ ${state.streams.historical.rps.toFixed(1)} rps`,
      },
      {
        pipeline: 'Realtime WebSocket',
        status: state.streams.realtime.connected ? pc.greenBright('Connected') : pc.redBright('Disconnected'),
        slot: state.streams.realtime.slot ?? '-',
        detail: state.streams.realtime.connected ? 'streaming' : 'waiting',
      },
    ];
    lines.push(
      ...ProgressUiController.buildTable(pipelineRows, [
        { title: 'Pipeline', key: 'pipeline', align: 'left', maxWidth: 32 },
        { title: 'Status', key: 'status', align: 'left', maxWidth: 32 },
        { title: 'Slot', key: 'slot', align: 'right' },
        { title: 'Details', key: 'detail', align: 'left', maxWidth: 32 },
      ]),
    );
    lines.push('');
    let progressLabel = pc.bold('Progress');
    if (state.mode) {
      progressLabel += ` (${state.mode === 'historical' ? pc.yellowBright('historical') : pc.greenBright('live')})`;
    }
    lines.push(progressLabel);
    lines.push('');
    const progressBar = ProgressUiController.buildProgressBar(state.percent, 1, 40);
    let progressText = `${progressBar} ${ProgressUiController.formatPercentage(state.percent)}`;
    if (state.eta !== undefined && state.eta !== 0) {
      progressText += ` (${ProgressUiController.formatEta(state.eta)} eta)`;
    }
    lines.push(progressText);
    lines.push('');

    lines.push('');
    lines.push(pc.bold('Health'));
    lines.push('');
    lines.push(
      '│ Database │ ' +
        (state.health.database ? pc.greenBright('✓') : pc.redBright('✗')) +
        ' │\n' +
        '│ RPC      │ ' +
        (state.health.rpc ? pc.greenBright('✓') : pc.redBright('✗')) +
        ' │\n' +
        '│ WebSocket│ ' +
        (state.health.ws ? pc.greenBright('✓') : pc.redBright('✗')) +
        ' │',
    );
    lines.push('');

    return lines;
  }

  private static buildProgressBar(current: number, end: number, width = 40): string {
    const fraction = Math.max(0, Math.min(1, current / end));
    const count = Math.min(Math.floor(width * fraction), width);
    return '█'.repeat(count) + '─'.repeat(width - count);
  }

  private static formatEta(seconds: number): string {
    if (!isFinite(seconds) || seconds < 0) return '--';
    const totalMinutes = Math.floor(seconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const secs = Math.floor(seconds % 60);
    return hours > 0
      ? `${hours}h ${minutes.toString().padStart(2, '0')}m ${secs.toString().padStart(2, '0')}s`
      : `${minutes}m ${secs.toString().padStart(2, '0')}s`;
  }

  private static formatPercentage(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
  }

  private static buildTable(
    rows: { [key: string]: any }[],
    columns: {
      title: string;
      key: string;
      align: 'left' | 'right';
      format?: (value: any, row: { [key: string]: any }) => string | number;
      maxWidth?: number;
    }[],
  ): string[] {
    if (rows.length === 0) {
      return ['Waiting to start...'];
    }

    const DEFAULT_MAX_COLUMN_WIDTH = 24;
    const stripAnsi = (value: string): string => value.replace(/\x1B\[[0-9;]*m/g, '');
    const padValue = (value: string, width: number, align: 'left' | 'right'): string => {
      const visibleLength = stripAnsi(value).length;
      const padLength = Math.max(width - visibleLength, 0);
      return align === 'right'
        ? `${' '.repeat(padLength)}${value}`
        : `${value}${' '.repeat(padLength)}`;
    };
    const columnWidths = columns.map((column) => {
      const formattedRows = rows.map((row) => {
        const value = column.format ? column.format(row[column.key], row) : row[column.key];
        const strValue = value !== undefined ? String(value) : '';
        return stripAnsi(strValue);
      });

      const maxWidth = Math.max(...formattedRows.map((val) => val.length), column.title.length);
      return Math.min(maxWidth, column.maxWidth ?? DEFAULT_MAX_COLUMN_WIDTH);
    });

    const headerRow = [
      '│ ',
      columns
        .map((col, i) => {
          const width = columnWidths[i] ?? 0;
          return col.title.padEnd(width, ' ').padStart(col.align === 'right' ? width : width, ' ');
        })
        .join(' │ '),
      ' │',
    ].join('');

    const separator = ['├─', columnWidths.map((w) => '─'.repeat(w)).join('─┼─'), '─┤'].join('');

    const dataRows = rows.map((row) => {
      return [
        '│ ',
        columns
          .map((col, i) => {
            const width = columnWidths[i] ?? 0;
            const value = col.format ? col.format(row[col.key], row) : row[col.key];
            const strValue = value !== undefined ? String(value) : '';
            return padValue(strValue, width, col.align);
          })
          .join(' │ '),
        ' │',
      ].join('');
    });

    return [headerRow, separator, ...dataRows];
  }
}


