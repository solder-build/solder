import pc from 'picocolors';
import { patchWriteStreams } from './patch';

export type ProgressEventStat = {
  eventName: string;
  count: number;
  averageDuration: number;
  contractAddress: string;
};

export type ProgressUiState = {
  chain: string;
  status: string;
  block: number;
  rps: number;
  percent: number;
  eta: number; // seconds
  mode: 'historical' | 'live' | 'realtime';
  events: ProgressEventStat[];
  health: {
    database: boolean;
    ws: boolean;
    rpc: boolean;
  };
};

const buildProgressBar = (current: number, end: number, width = 40): string => {
  const fraction = Math.max(0, Math.min(1, current / end));
  const count = Math.min(Math.floor(width * fraction), width);
  // Use more visible characters: filled blocks and dashes
  return '█'.repeat(count) + '─'.repeat(width - count);
};

const formatEta = (seconds: number): string => {
  if (!isFinite(seconds) || seconds < 0) return '--';
  
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, '0')}m ${secs.toString().padStart(2, '0')}s`;
  } else {
    return `${minutes}m ${secs.toString().padStart(2, '0')}s`;
  }
};

const formatPercentage = (value: number): string => `${(value * 100).toFixed(1)}%`;

const buildTable = (
  rows: { [key: string]: any }[],
  columns: {
    title: string;
    key: string;
    align: 'left' | 'right';
    format?: (value: any, row: { [key: string]: any }) => string | number;
    maxWidth?: number;
  }[]
): string[] => {
  if (rows.length === 0) {
    return ['Waiting to start...'];
  }

  const DEFAULT_MAX_COLUMN_WIDTH = 24;
  const columnWidths = columns.map((column) => {
    const formattedRows = rows.map((row) => {
      const value = column.format ? column.format(row[column.key], row) : row[column.key];
      return value !== undefined ? String(value) : '';
    });

    const maxWidth = Math.max(
      ...formattedRows.map((val) => val.toString().length),
      column.title.length
    );
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
          return col.align === 'right'
            ? strValue.padStart(width, ' ')
            : strValue.padEnd(width, ' ');
        })
        .join(' │ '),
      ' │',
    ].join('');
  });

  return [headerRow, separator, ...dataRows];
};

export function renderProgressUi(state: ProgressUiState): string[] {
  const lines: string[] = [];

  lines.push('');
  lines.push(pc.bold('Syncing...'));
  lines.push('');
  lines.push(
    '│ Chain    │ Status            │ Block     │ RPC (req/s) │\n' +
    '├──────────┼───────────────────┼───────────┼─────────────┤'
  );
  const statusColor = state.status === 'Running' ? pc.greenBright : 
                     state.status === 'Stopped' ? pc.redBright : 
                     state.status === 'Paused' ? pc.yellowBright : 
                     pc.white;
  
  const coloredStatus = statusColor(state.status);
  const statusPadded = coloredStatus + ' '.repeat(17 - state.status.length);
  
  lines.push(
    `│ ${state.chain.padEnd(8)} │ ${statusPadded} │ ${String(state.block).padStart(
      8
    )} │ ${state.rps.toFixed(1).padStart(11)} │`
  );
  lines.push('');
  lines.push(pc.bold('Indexing'));
  lines.push('');
  lines.push(
    ...buildTable(state.events, [
      { title: 'Event', key: 'eventName', align: 'left', maxWidth: 80 },
      { title: 'Contract', key: 'contractAddress', align: 'right', maxWidth: 16 },
      { title: 'Count', key: 'count', align: 'right' },
      {
        title: 'Duration (ms)',
        key: 'averageDuration',
        align: 'right',
        format: (v) => (v > 0 ? (v < 0.001 ? '<0.001' : v.toFixed(3)) : '-'),
      },
    ])
  );
  lines.push('');
  let progressLabel = pc.bold('Progress');
  if (state.mode) {
    progressLabel += ` (${
      state.mode === 'historical' ? pc.yellowBright('historical') : pc.greenBright('live')
    })`;
  }
  lines.push(progressLabel);
  lines.push('');
  const progressBar = buildProgressBar(state.percent, 1, 40);
  let progressText = `${progressBar} ${formatPercentage(state.percent)}`;
  if (state.eta !== undefined && state.eta !== 0) {
    progressText += ` (${formatEta(state.eta)} eta)`;
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
      ' │'
  );
  lines.push('');

  return lines;
}

export function setupProgressUi(getState: () => ProgressUiState) {
  const { refresh, shutdown } = patchWriteStreams({
    getLines: () => renderProgressUi(getState()),
  });
  const interval = setInterval(refresh, 100);
  return () => {
    clearInterval(interval);
    shutdown();
  };
}
