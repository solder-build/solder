let ansi: any;

export function patchWriteStreams({ getLines }: { getLines: () => string[] }) {
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;

  let isWriting = false;
  let previousLineCount = 0;

  let terminalWidth = 80;
  const getTerminalWidth = async () => {
    const { default: terminalSize } = await import('terminal-size');
    return terminalSize().columns;
  };

  (async () => {
    const mod = await import('ansi-escapes');
    ansi = mod.default || mod;
    terminalWidth = await getTerminalWidth();
  })();

  const calculateLineCount = (lines: string[]): number => {
    let count = 0;
    for (const line of lines) {
      const visibleLength = line.replace(ansiEscapeRegex, '').length;
      count += Math.max(1, Math.ceil(visibleLength / terminalWidth));
    }
    return count;
  };

  const clearAndWriteLines = (lines: string[]) => {
    if (isWriting && !lines) return;
    const wasAlreadyWriting = isWriting;
    if (!wasAlreadyWriting) isWriting = true;
    try {
      const text = [...lines, ''].join('\n');
      const newLineCount = calculateLineCount(lines);
      if (previousLineCount > 0) {
        originalStdoutWrite.call(process.stdout, ansi.cursorUp(previousLineCount));
      }
      originalStdoutWrite.call(process.stdout, ansi.eraseDown);
      originalStdoutWrite.call(process.stdout, text);
      previousLineCount = newLineCount;
    } finally {
      if (!wasAlreadyWriting) isWriting = false;
    }
  };

  const handleOutput = function (
    this: NodeJS.WriteStream,
    buffer: string | Uint8Array,
    encoding?: BufferEncoding,
    cb?: (err?: Error | null) => void
  ) {
    const originalWrite = this === process.stderr ? originalStderrWrite : originalStdoutWrite;
    if (isWriting) {
      return originalWrite.apply(this, [buffer, encoding, cb]);
    }
    if (previousLineCount > 0) {
      originalStdoutWrite.call(process.stdout, ansi.cursorUp(previousLineCount) + ansi.eraseDown);
      previousLineCount = 0;
    }
    const result = originalWrite.apply(this, [buffer, encoding, cb]);
    const lines = getLines();
    clearAndWriteLines(lines);
    return result;
  };
  process.stdout.write = handleOutput as typeof process.stdout.write;
  process.stderr.write = handleOutput as typeof process.stderr.write;

  const resizeListener = async () => {
    terminalWidth = await getTerminalWidth();
    if (previousLineCount > 0) {
      originalStdoutWrite.call(process.stdout, ansi.cursorUp(previousLineCount) + ansi.eraseDown);
      previousLineCount = 0;
    }
    const lines = getLines();
    clearAndWriteLines(lines);
  };
  process.stdout.on('resize', resizeListener);

  const shutdown = () => {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    if (previousLineCount > 0) {
      originalStdoutWrite.call(process.stdout, ansi.cursorUp(previousLineCount) + ansi.eraseDown);
    }
    process.stdout.removeListener('resize', resizeListener);
  };

  return {
    refresh: () => {
      const lines = getLines();
      clearAndWriteLines(lines);
    },
    shutdown,
  };
}

const ansiEscapeRegex = new RegExp(
  [
    '[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)',
    '(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))',
  ].join('|'),
  'g'
);
