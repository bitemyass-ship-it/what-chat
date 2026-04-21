import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  formatReportCsvDocument,
  type ReportCsvRowInput
} from './report-csv';
import { parseReportPeriod } from './report-period';

export interface ReportExportWorkerOptions {
  databasePath: string;
  employeeCode: string;
  logger?: ReportExportWorkerLogger;
  period: string;
  reportsDir: string;
  targetFilePath: string;
}

interface ReportExportWorkerLogger {
  info(message: string, meta?: Record<string, unknown>): void;
}

interface ReportExportRow {
  body: string | null;
  call_media_type: string | null;
  call_status: string | null;
  chat_phone_number: string;
  direction: string;
  message_id: number;
  message_type: string;
  timestamp: number;
}

const NORMALIZED_MESSAGE_TIMESTAMP_SQL = `
  CASE
    WHEN ABS(m.timestamp) >= 10000000000 THEN m.timestamp
    ELSE m.timestamp * 1000
  END
`;

const EXPORT_QUERY = `
  WITH report_rows AS (
    SELECT
      m.timestamp,
      ${NORMALIZED_MESSAGE_TIMESTAMP_SQL} AS normalized_timestamp_ms,
      COALESCE(NULLIF(c.phone_number, ''), c.chat_id) AS chat_phone_number,
      m.direction,
      m.body,
      m.message_type,
      m.call_status,
      m.call_media_type,
      m.id AS message_id
    FROM messages m
    INNER JOIN employees e ON e.id = m.employee_id
    INNER JOIN chats c ON c.id = m.chat_record_id
    WHERE e.code = ?
      AND m.timestamp IS NOT NULL
  )
  SELECT
    timestamp,
    chat_phone_number,
    direction,
    body,
    message_type,
    call_status,
    call_media_type,
    message_id
  FROM report_rows
  WHERE normalized_timestamp_ms >= ?
    AND normalized_timestamp_ms < ?
  ORDER BY
    chat_phone_number ASC,
    normalized_timestamp_ms ASC,
    message_id ASC
`;

const requireNonEmpty = (value: string, fieldName: string): string => {
  const normalizedValue = value.trim();

  if (normalizedValue === '') {
    throw new Error(`${fieldName} is required`);
  }

  return normalizedValue;
};

const asReportExportRow = (row: unknown): ReportExportRow => row as ReportExportRow;

const mapExportRowToCsvRow = (row: ReportExportRow): ReportCsvRowInput => ({
  body: row.body ?? '',
  callMediaType: row.call_media_type,
  callStatus: row.call_status,
  chatPhoneNumber: row.chat_phone_number,
  direction: row.direction,
  messageType: row.message_type,
  timestamp: row.timestamp
});

export const exportEmployeeMonthlyReport = ({
  databasePath,
  employeeCode,
  logger,
  period,
  reportsDir,
  targetFilePath
}: ReportExportWorkerOptions): number => {
  const normalizedEmployeeCode = requireNonEmpty(employeeCode, 'employeeCode');

  requireNonEmpty(databasePath, 'databasePath');
  requireNonEmpty(reportsDir, 'reportsDir');
  requireNonEmpty(targetFilePath, 'targetFilePath');

  const periodRange = parseReportPeriod(period);
  const startedAt = new Date();
  const startedAtMs = startedAt.getTime();
  const database = new DatabaseSync(databasePath);

  try {
    const rows = database
      .prepare(EXPORT_QUERY)
      .all(
        normalizedEmployeeCode,
        periodRange.startTimestamp * 1_000,
        periodRange.endTimestamp * 1_000
      )
      .map((row) => mapExportRowToCsvRow(asReportExportRow(row)));

    fs.mkdirSync(path.dirname(targetFilePath), {
      recursive: true
    });
    fs.writeFileSync(targetFilePath, formatReportCsvDocument(rows), {
      encoding: 'utf8',
      flag: 'w'
    });

    const finishedAt = new Date();

    logger?.info('Report export completed', {
      databasePath,
      durationMs: finishedAt.getTime() - startedAtMs,
      employeeCode: normalizedEmployeeCode,
      finishedAt: finishedAt.toISOString(),
      period: periodRange.period,
      rowCount: rows.length,
      startedAt: startedAt.toISOString(),
      targetFilePath
    });

    return rows.length;
  } finally {
    database.close();
  }
};

const parseCliArgs = (argv: string[]): ReportExportWorkerOptions => {
  const values = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const currentArg = argv[index];

    if (!currentArg?.startsWith('--')) {
      continue;
    }

    const equalsIndex = currentArg.indexOf('=');

    if (equalsIndex !== -1) {
      values.set(currentArg.slice(2, equalsIndex), currentArg.slice(equalsIndex + 1));
      continue;
    }

    const nextArg = argv[index + 1];

    if (typeof nextArg !== 'string' || nextArg.startsWith('--')) {
      throw new Error(`Missing value for ${currentArg}`);
    }

    values.set(currentArg.slice(2), nextArg);
    index += 1;
  }

  const getRequiredValue = (name: keyof ReportExportWorkerOptions): string => {
    const value = values.get(name);

    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`${name} argument is required`);
    }

    return value;
  };

  return {
    databasePath: getRequiredValue('databasePath'),
    employeeCode: getRequiredValue('employeeCode'),
    period: getRequiredValue('period'),
    reportsDir: getRequiredValue('reportsDir'),
    targetFilePath: getRequiredValue('targetFilePath')
  };
};

export const runReportExportWorkerCli = (
  argv: string[] = process.argv.slice(2)
): void => {
  try {
    exportEmployeeMonthlyReport({
      ...parseCliArgs(argv),
      logger: console
    });
  } catch (error) {
    console.error(
      'Report export failed',
      error instanceof Error ? error.stack ?? error.message : String(error)
    );
    process.exitCode = 1;
  }
};

if (require.main === module) {
  runReportExportWorkerCli();
}
