export const REPORT_CSV_HEADER =
  'event_time;chat_phone_number;direction;body;message_type;call_info';

export interface ReportCsvRowInput {
  body: string | null;
  callMediaType: string | null;
  callStatus: string | null;
  chatPhoneNumber: string;
  direction: string;
  messageType: string;
  timestamp: number;
}

const padTwoDigits = (value: number): string => String(value).padStart(2, '0');
const SPREADSHEET_FORMULA_PREFIX_PATTERN = /^[=+\-@]/u;

const toTimestampMilliseconds = (timestamp: number): number => {
  const normalizedTimestamp = Math.trunc(timestamp);

  return Math.abs(normalizedTimestamp) >= 10_000_000_000
    ? normalizedTimestamp
    : normalizedTimestamp * 1_000;
};

export const formatReportEventTime = (timestamp: number): string => {
  const date = new Date(toTimestampMilliseconds(timestamp));

  return [
    `${date.getFullYear()}-${padTwoDigits(date.getMonth() + 1)}-${padTwoDigits(date.getDate())}`,
    `${padTwoDigits(date.getHours())}:${padTwoDigits(date.getMinutes())}`
  ].join(' ');
};

export const formatCallInfo = (
  callStatus: string | null,
  callMediaType: string | null
): string =>
  [callStatus, callMediaType]
    .filter((value): value is string => typeof value === 'string' && value !== '')
    .join(' ');

export const escapeCsvValue = (value: string | null | undefined): string => {
  const normalizedValue = value ?? '';

  if (!/[;"\n\r]/u.test(normalizedValue)) {
    return normalizedValue;
  }

  return `"${normalizedValue.replace(/"/gu, '""')}"`;
};

export const sanitizeSpreadsheetTextValue = (
  value: string | null | undefined
): string => {
  const normalizedValue = value ?? '';

  return SPREADSHEET_FORMULA_PREFIX_PATTERN.test(normalizedValue)
    ? `'${normalizedValue}`
    : normalizedValue;
};

export const formatReportCsvLine = (row: ReportCsvRowInput): string =>
  [
    formatReportEventTime(row.timestamp),
    row.chatPhoneNumber,
    row.direction,
    sanitizeSpreadsheetTextValue(row.body),
    row.messageType,
    formatCallInfo(row.callStatus, row.callMediaType)
  ]
    .map(escapeCsvValue)
    .join(';');

export const formatReportCsvDocument = (rows: ReportCsvRowInput[]): string =>
  `\uFEFF${[REPORT_CSV_HEADER, ...rows.map(formatReportCsvLine)].join('\n')}\n`;
