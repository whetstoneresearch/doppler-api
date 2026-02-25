import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { SUITE_DEFS } from './test-suites.mjs';

const ROOT = process.cwd();
const RESULTS_DIR = path.join(ROOT, '.test-results');
const SUMMARY_FILE = path.join(RESULTS_DIR, 'summary.json');
const VITEST_BIN = path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');
const LIVE_READINESS_ERROR_MARKER = 'LIVE_TEST_READINESS_CHECK_FAILED';

const args = process.argv.slice(2);
const argSet = new Set(args);
const liveOnly = argSet.has('--live-only');
const withLive = argSet.has('--with-live');
const verboseLiveOutput =
  argSet.has('--verbose') ||
  process.env.npm_config_verbose === 'true' ||
  process.env.npm_config_loglevel === 'verbose';
const suiteFilterArg = args.find((arg) => arg.startsWith('--suite='));
const suiteFilter = suiteFilterArg
  ? new Set(
      suiteFilterArg
        .split('=')[1]
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
    )
  : null;

const divider = (label = '') => {
  const line = '='.repeat(96);
  return label ? `${line}\n${label}\n${line}` : line;
};

const section = (label) => {
  const line = '-'.repeat(96);
  return `${line}\n${label}\n${line}`;
};

const pad = (value, width) => String(value).padEnd(width, ' ');
const padLeft = (value, width) => String(value).padStart(width, ' ');

const formatMs = (ms) => {
  if (!Number.isFinite(ms) || ms < 0) return '-';
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

const relPath = (targetPath) => path.relative(ROOT, targetPath) || targetPath;
const vitestNoisePatterns = [
  /^\s*Test Files\s+\d+/,
  /^\s*Tests?\s+\d+/,
  /^\s*Start at\s+/,
  /^\s*Duration\s+/,
  /^JSON report written to /,
  /^stdout \| /,
  /^stderr \| /,
  /^\s*FAIL\s+tests\//,
  /^\s*Error:\s+/,
  /^\s*Caused by:/,
  /^\s*Serialized Error:/,
  /^\s*URL:\s+/,
  /^\s*Request body:\s+/,
  /^\s*Details:\s+/,
  /^\s*Version:\s+/,
  /^\s*❯\s.*:\d+:\d+\s*$/,
  /^\s*❯\s(Object|fn|request|withRetry|attemptRetry|withTimeout)/,
  /^\s*⎯/,
  /^\s*\d+\|/,
  /^\s*\|\s*\^/,
];

const conciseLiveNoisePatterns = [
  /^\s*❯\s+tests\/live\//,
  /^\s*[×✓]\s+live create verification\s*>/,
  /^\s*→\s/,
  /^\s*AssertionError:/,
  /^\s*ContractFunctionExecutionError:/,
  /^\s*IntegerOutOfRangeError:/,
];

const shouldSuppressVitestLine = (line, conciseLive = false) => {
  if (line.includes(LIVE_READINESS_ERROR_MARKER)) {
    return false;
  }
  const trimmed = line.trimStart();
  if (vitestNoisePatterns.some((pattern) => pattern.test(trimmed))) {
    return true;
  }
  if (conciseLive && conciseLiveNoisePatterns.some((pattern) => pattern.test(trimmed))) {
    return true;
  }
  return false;
};

const renderTable = ({ columns, rows, rightAlign = [] }) => {
  const widths = columns.map((column, index) => {
    const bodyMax = Math.max(...rows.map((row) => String(row[index] ?? '').length), 0);
    return Math.max(column.length, bodyMax);
  });

  const renderCell = (value, index) =>
    rightAlign.includes(index) ? padLeft(value, widths[index]) : pad(value, widths[index]);
  const renderRow = (row) => row.map((value, index) => renderCell(value, index)).join(' | ');
  const separator = widths.map((w) => '-'.repeat(w)).join('-+-');

  console.log(renderRow(columns));
  console.log(separator);
  for (const row of rows) {
    console.log(renderRow(row));
  }
};

const computeRangeDuration = (items) => {
  const starts = items.map((item) => Number(item.startTime)).filter(Number.isFinite);
  const ends = items.map((item) => Number(item.endTime)).filter(Number.isFinite);
  if (!starts.length || !ends.length) return 0;
  return Math.max(...ends) - Math.min(...starts);
};

const resolveSelectedSuites = () => {
  if (suiteFilter) {
    return SUITE_DEFS.filter((suite) => suiteFilter.has(suite.id));
  }
  if (liveOnly) {
    return SUITE_DEFS.filter((suite) => suite.id === 'live');
  }
  if (withLive) {
    return [...SUITE_DEFS];
  }
  return SUITE_DEFS.filter((suite) => suite.defaultSelected);
};

const selectedSuites = resolveSelectedSuites();

if (selectedSuites.length === 0) {
  console.error('No suites selected. Use --suite=<id1,id2>, --with-live, or --live-only.');
  process.exit(1);
}

const formatStatus = (status) => {
  if (status === 'PASS') return 'PASS';
  if (status === 'FAIL') return 'FAIL';
  if (status === 'SKIPPED') return 'SKIPPED';
  return status || 'UNKNOWN';
};

const parseFileResult = (testFile) => {
  const assertions = testFile.assertionResults ?? [];
  const tests = assertions.length;
  const passed = assertions.filter((a) => a.status === 'passed').length;
  const failed = assertions.filter((a) => a.status === 'failed').length;
  const skipped = assertions.filter(
    (a) => a.status === 'pending' || a.status === 'skipped' || a.status === 'todo',
  ).length;
  const status = failed > 0 ? 'FAIL' : tests === 0 ? 'SKIPPED' : 'PASS';
  const duration = formatMs(
    Number.isFinite(Number(testFile.startTime)) && Number.isFinite(Number(testFile.endTime))
      ? Number(testFile.endTime) - Number(testFile.startTime)
      : 0,
  );
  return {
    file: relPath(testFile.name),
    status,
    tests,
    passed,
    failed,
    skipped,
    duration,
  };
};

const runSuite = async (suite, index, total) => {
  const conciseLiveOutput = suite.id === 'live' && !verboseLiveOutput;
  const outputFile = path.join(RESULTS_DIR, `${suite.id}.json`);
  await fs.rm(outputFile, { force: true });

  console.log(`\n${section(`Suite ${index}/${total}: ${suite.title} (${suite.id})`)}`);
  console.log(`Description : ${suite.description}`);
  console.log(`Patterns    : ${suite.patterns.join(', ')}`);

  const cmdArgs = [
    VITEST_BIN,
    'run',
    ...suite.patterns,
    '--reporter=default',
    '--reporter=json',
    `--outputFile=${outputFile}`,
  ];
  console.log(`Command     : node ${relPath(VITEST_BIN)} run ${suite.patterns.join(' ')}`);
  console.log(
    `Progress    : ${
      conciseLiveOutput
        ? 'launch summary + suite summary (use --verbose for full details)'
        : 'streaming live vitest output'
    }`,
  );

  const runStarted = Date.now();
  const execution = await new Promise((resolve) => {
    const spinnerFrames = ['|', '/', '-', '\\'];
    let spinnerTimer = null;
    let spinnerFrame = 0;
    const spinnerStarted = Date.now();
    const clearSpinnerLine = () => {
      if (spinnerTimer && process.stdout.isTTY) {
        process.stdout.write('\r\x1b[K');
      }
    };
    const startSpinner = () => {
      if (!process.stdout.isTTY) return;
      spinnerTimer = setInterval(() => {
        const elapsedSec = ((Date.now() - spinnerStarted) / 1000).toFixed(1);
        const frame = spinnerFrames[spinnerFrame % spinnerFrames.length];
        spinnerFrame += 1;
        process.stdout.write(
          `\r[${frame}] Running ${suite.id} suite (${index}/${total}) ${elapsedSec}s`,
        );
      }, 120);
    };
    const stopSpinner = () => {
      if (spinnerTimer) {
        clearInterval(spinnerTimer);
        spinnerTimer = null;
      }
      if (process.stdout.isTTY) {
        process.stdout.write('\r\x1b[K');
      }
    };

    startSpinner();

    const child = spawn(process.execPath, cmdArgs, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        LIVE_TEST_VERBOSE:
          suite.id === 'live' && verboseLiveOutput
            ? 'true'
            : (process.env.LIVE_TEST_VERBOSE ?? 'false'),
      },
    });

    let stdout = '';
    let stderr = '';
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let lastStdoutBlank = false;
    let lastStderrBlank = false;

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      stdoutBuffer += text;
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!shouldSuppressVitestLine(line, conciseLiveOutput)) {
          clearSpinnerLine();
          const isBlank = line.trim().length === 0;
          if (!(isBlank && lastStdoutBlank)) {
            process.stdout.write(`${line}\n`);
          }
          lastStdoutBlank = isBlank;
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      stderrBuffer += text;
      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!shouldSuppressVitestLine(line, conciseLiveOutput)) {
          clearSpinnerLine();
          const isBlank = line.trim().length === 0;
          if (!(isBlank && lastStderrBlank)) {
            process.stderr.write(`${line}\n`);
          }
          lastStderrBlank = isBlank;
        }
      }
    });

    child.on('close', (code) => {
      stopSpinner();
      if (stdoutBuffer && !shouldSuppressVitestLine(stdoutBuffer, conciseLiveOutput)) {
        const isBlank = stdoutBuffer.trim().length === 0;
        if (!(isBlank && lastStdoutBlank)) {
          process.stdout.write(stdoutBuffer);
        }
      }
      if (stderrBuffer) {
        if (!shouldSuppressVitestLine(stderrBuffer, conciseLiveOutput)) {
          const isBlank = stderrBuffer.trim().length === 0;
          if (!(isBlank && lastStderrBlank)) {
            process.stderr.write(stderrBuffer);
          }
        }
      }
      resolve({
        code: code ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        wallMs: Date.now() - runStarted,
      });
    });
  });

  let report = null;
  try {
    const raw = await fs.readFile(outputFile, 'utf8');
    report = JSON.parse(raw);
  } catch {
    report = null;
  }

  if (!report) {
    console.log(`Result      : FAIL (${formatMs(execution.wallMs)})`);
    if (execution.stderr) {
      console.log('Stderr      :');
      console.log(execution.stderr);
    }
    return {
      id: suite.id,
      title: suite.title,
      status: 'FAIL',
      files: 0,
      tests: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      durationMs: execution.wallMs,
      failedDetails: ['Vitest JSON report was not produced.'],
      fileRows: [],
      stderr: execution.stderr,
    };
  }

  const fileResults = Array.isArray(report.testResults)
    ? report.testResults.map(parseFileResult)
    : [];
  const files = fileResults.length;
  const tests = Number(report.numTotalTests ?? 0);
  const passed = Number(report.numPassedTests ?? 0);
  const failed = Number(report.numFailedTests ?? 0);
  const skipped = Number(report.numPendingTests ?? 0) + Number(report.numTodoTests ?? 0);
  const durationMs = computeRangeDuration(report.testResults ?? []) || execution.wallMs;
  const success = execution.code === 0 && Boolean(report.success);

  const failedDetails = [];
  for (const testFile of report.testResults ?? []) {
    if (testFile.status !== 'failed') continue;
    for (const assertion of testFile.assertionResults ?? []) {
      if (assertion.status !== 'failed') continue;
      const summary = (assertion.failureMessages?.[0] || '')
        .split('\n')
        .map((line) => line.trim())
        .find(Boolean);
      failedDetails.push(
        `${relPath(testFile.name)} :: ${assertion.fullName}${summary ? ` -> ${summary}` : ''}`,
      );
    }
  }

  console.log(`Result      : ${success ? 'PASS' : 'FAIL'} (${formatMs(durationMs)})`);

  if (!success && fileResults.length > 0 && !conciseLiveOutput) {
    console.log('\nFailing Files');
    renderTable({
      columns: ['File', 'Status', 'Tests', 'Passed', 'Failed', 'Duration'],
      rows: fileResults
        .filter((item) => item.status === 'FAIL')
        .map((item) => [
          item.file,
          item.status,
          item.tests,
          item.passed,
          item.failed,
          item.duration,
        ]),
      rightAlign: [2, 3, 4],
    });
  }

  const readinessFailures = failedDetails.filter((detail) =>
    detail.includes(LIVE_READINESS_ERROR_MARKER),
  );

  if (readinessFailures.length > 0) {
    console.log('\nLive Readiness');
    for (const detail of readinessFailures) {
      const readable = detail
        .replace(`${LIVE_READINESS_ERROR_MARKER}]`, ']')
        .replace(`${LIVE_READINESS_ERROR_MARKER}:`, '')
        .replace(LIVE_READINESS_ERROR_MARKER, '')
        .trim();
      console.log(`- ${readable}`);
    }
  } else if (!success && failedDetails.length > 0 && !conciseLiveOutput) {
    console.log('\nFailures');
    for (const detail of failedDetails.slice(0, 20)) {
      console.log(`- ${detail}`);
    }
    if (failedDetails.length > 20) {
      console.log(`- ... and ${failedDetails.length - 20} more`);
    }
  }

  return {
    id: suite.id,
    title: suite.title,
    status: success ? 'PASS' : 'FAIL',
    files,
    tests,
    passed,
    failed,
    skipped,
    durationMs,
    failedDetails,
    fileRows: fileResults,
    stderr: execution.stderr,
  };
};

const aggregate = (results) =>
  results.reduce(
    (acc, result) => ({
      files: acc.files + result.files,
      tests: acc.tests + result.tests,
      passed: acc.passed + result.passed,
      failed: acc.failed + result.failed,
      skipped: acc.skipped + result.skipped,
      durationMs: acc.durationMs + result.durationMs,
    }),
    { files: 0, tests: 0, passed: 0, failed: 0, skipped: 0, durationMs: 0 },
  );

const statusById = (results) => {
  const map = new Map(results.map((result) => [result.id, result.status]));
  return (id) => map.get(id) ?? 'NOT RUN';
};

const main = async () => {
  await fs.mkdir(RESULTS_DIR, { recursive: true });

  console.log(divider('Doppler Launch API Test Runner'));
  console.log(`Started At        : ${new Date().toISOString()}`);
  console.log(`Node Version      : ${process.version}`);
  console.log(
    `Mode              : ${
      suiteFilter
        ? `custom (--suite=${[...suiteFilter].join(',')})`
        : liveOnly
          ? 'live-only'
          : withLive
            ? 'all (unit+integration+live)'
            : 'default (unit+integration)'
    }`,
  );
  console.log(`LIVE_TEST_ENABLE  : ${process.env.LIVE_TEST_ENABLE ?? 'unset'}`);
  console.log(`LIVE_TEST_VERBOSE : ${verboseLiveOutput ? 'true (from --verbose)' : 'false'}`);
  console.log(`Suites            : ${selectedSuites.map((suite) => suite.id).join(', ')}`);

  const results = [];
  for (let index = 0; index < selectedSuites.length; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    const result = await runSuite(selectedSuites[index], index + 1, selectedSuites.length);
    results.push(result);
  }

  const totals = aggregate(results);
  const failedSuites = results.filter((result) => result.status === 'FAIL');

  console.log(`\n${divider('Suite Summary')}`);
  renderTable({
    columns: ['Suite', 'Status', 'Files', 'Tests', 'Passed', 'Failed', 'Skipped', 'Duration'],
    rows: [
      ...results.map((result) => [
        result.id,
        formatStatus(result.status),
        result.files,
        result.tests,
        result.passed,
        result.failed,
        result.skipped,
        formatMs(result.durationMs),
      ]),
      [
        'total',
        failedSuites.length === 0 ? 'PASS' : 'FAIL',
        totals.files,
        totals.tests,
        totals.passed,
        totals.failed,
        totals.skipped,
        formatMs(totals.durationMs),
      ],
    ],
    rightAlign: [2, 3, 4, 5, 6],
  });

  console.log(`\n${section('Confidence Signals')}`);
  const getStatus = statusById(results);
  const confidenceRows = [
    ['Core logic and validation (unit)', getStatus('unit')],
    ['Route behavior and module wiring (integration)', getStatus('integration')],
    ['Onchain create + chain verification (live)', getStatus('live')],
  ];
  renderTable({
    columns: ['Verification Area', 'Status'],
    rows: confidenceRows,
  });

  const summaryPayload = {
    startedAt: new Date().toISOString(),
    mode: suiteFilter
      ? `custom:${[...suiteFilter].join(',')}`
      : liveOnly
        ? 'live-only'
        : withLive
          ? 'all'
          : 'default',
    liveTestEnable: process.env.LIVE_TEST_ENABLE ?? null,
    suites: results,
    totals,
    success: failedSuites.length === 0,
  };
  await fs.writeFile(SUMMARY_FILE, `${JSON.stringify(summaryPayload, null, 2)}\n`, 'utf8');
  console.log(`\nSummary JSON written to ${relPath(SUMMARY_FILE)}`);

  if (failedSuites.length > 0) {
    console.log(`\n${divider('Overall Result: FAILED')}`);
    process.exit(1);
  }

  console.log(`\n${divider('Overall Result: PASSED')}`);
};

main().catch((error) => {
  console.error('\nRunner crashed unexpectedly:', error);
  process.exit(1);
});
