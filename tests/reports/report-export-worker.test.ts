import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDatabase } from '../../src/database/database';
import type { Database } from '../../src/database/types';
import {
  formatReportEventTime,
  REPORT_CSV_HEADER
} from '../../src/reports/report-csv';
import { exportEmployeeMonthlyReport } from '../../src/reports/report-export-worker';
import { buildReportTargetFilePath } from '../../src/reports/report-paths';
import type { Logger } from '../../src/types/whatsapp';

const createLogger = (): Logger => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
});

const localTimestamp = (
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number
): number =>
  Math.floor(new Date(year, monthIndex, day, hour, minute, 0, 0).getTime() / 1_000);

const localTimestampMs = (
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number
): number => new Date(year, monthIndex, day, hour, minute, 0, 0).getTime();

describe('report export worker', () => {
  let database: Database | undefined;
  let tempDir: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'what-chat-report-'));
  });

  afterEach(() => {
    database?.close();
    database = undefined;

    if (tempDir) {
      fs.rmSync(tempDir, {
        force: true,
        recursive: true
      });
      tempDir = undefined;
    }
  });

  const createFileDatabase = (): string => {
    const databasePath = path.join(tempDir as string, 'data.sqlite');

    database = createDatabase({
      databasePath,
      logger: createLogger()
    });

    return databasePath;
  };

  it('should export selected employee month messages into a new report directory', () => {
    const databasePath = createFileDatabase();
    const reportsDir = path.join(tempDir as string, 'missing', 'reports');
    const targetFilePath = buildReportTargetFilePath({
      employeeCode: 'anna',
      period: '202605',
      reportsDir
    });
    const mayOne = localTimestamp(2026, 4, 1, 9, 0);
    const mayThreeEarlier = localTimestamp(2026, 4, 3, 10, 30);
    const mayThreeLater = localTimestamp(2026, 4, 3, 11, 0);
    const mayFour = localTimestamp(2026, 4, 4, 8, 15);

    database?.employees.create({ code: 'anna' });
    database?.employees.create({ code: 'bob' });
    database?.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '050@lid'
    });
    database?.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '100@c.us',
      isPhoneNumberVerified: true,
      phoneNumber: '100'
    });
    database?.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '200@c.us',
      isPhoneNumberVerified: true,
      phoneNumber: '200'
    });
    database?.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '300@c.us',
      isPhoneNumberVerified: true,
      phoneNumber: '300'
    });
    database?.chats.upsertByEmployeeCode({
      employeeCode: 'bob',
      chatId: '100@c.us',
      isPhoneNumberVerified: true,
      phoneNumber: '100'
    });

    database?.messages.upsertByEmployeeCode({
      body: 'fallback chat id',
      chatId: '050@lid',
      direction: 'incoming',
      employeeCode: 'anna',
      externalMessageId: 'anna-fallback',
      sourceChatId: '050@lid',
      timestamp: mayFour
    });
    database?.messages.upsertByEmployeeCode({
      body: 'later same chat',
      chatId: '100@c.us',
      direction: 'outgoing',
      employeeCode: 'anna',
      externalMessageId: 'anna-later',
      sourceChatId: '100@c.us',
      timestamp: mayThreeLater
    });
    database?.messages.upsertByEmployeeCode({
      body: 'earlier same chat',
      chatId: '100@c.us',
      direction: 'incoming',
      employeeCode: 'anna',
      externalMessageId: 'anna-earlier',
      sourceChatId: '100@c.us',
      timestamp: mayThreeEarlier
    });
    database?.messages.upsertByEmployeeCode({
      body: 'Missed call',
      callMediaType: 'voice',
      callStatus: 'missed',
      chatId: '200@c.us',
      direction: 'incoming',
      employeeCode: 'anna',
      externalMessageId: 'anna-call',
      messageType: 'call',
      sourceChatId: '200@c.us',
      timestamp: mayOne
    });
    database?.messages.upsertByEmployeeCode({
      body: 'wrong employee',
      chatId: '100@c.us',
      direction: 'incoming',
      employeeCode: 'bob',
      externalMessageId: 'bob-may',
      sourceChatId: '100@c.us',
      timestamp: mayOne
    });
    database?.messages.upsertByEmployeeCode({
      body: 'april',
      chatId: '100@c.us',
      direction: 'incoming',
      employeeCode: 'anna',
      externalMessageId: 'anna-april',
      sourceChatId: '100@c.us',
      timestamp: localTimestamp(2026, 3, 30, 23, 59)
    });
    database?.messages.upsertByEmployeeCode({
      body: 'june',
      chatId: '100@c.us',
      direction: 'incoming',
      employeeCode: 'anna',
      externalMessageId: 'anna-june',
      sourceChatId: '100@c.us',
      timestamp: localTimestamp(2026, 5, 1, 0, 0)
    });
    database?.messages.upsertByEmployeeCode({
      body: 'no timestamp',
      chatId: '100@c.us',
      direction: 'system',
      employeeCode: 'anna',
      externalMessageId: 'anna-null',
      sourceChatId: '100@c.us',
      timestamp: null
    });

    database?.close();

    const exportedRows = exportEmployeeMonthlyReport({
      databasePath,
      employeeCode: 'anna',
      period: '202605',
      reportsDir,
      targetFilePath
    });

    expect(exportedRows).toBe(4);
    expect(fs.existsSync(targetFilePath)).toBe(true);

    const contents = fs.readFileSync(targetFilePath, 'utf8');
    const lines = contents.slice(1).trimEnd().split('\n');

    expect(contents.charCodeAt(0)).toBe(0xfeff);
    expect(lines).toEqual([
      REPORT_CSV_HEADER,
      `${formatReportEventTime(mayFour)};050@lid;incoming;fallback chat id;chat;`,
      `${formatReportEventTime(mayThreeEarlier)};100;incoming;earlier same chat;chat;`,
      `${formatReportEventTime(mayThreeLater)};100;outgoing;later same chat;chat;`,
      `${formatReportEventTime(mayOne)};200;incoming;Missed call;call;missed voice`
    ]);
  });

  it('should export March 2026 messages stored as millisecond timestamps', () => {
    const databasePath = createFileDatabase();
    const reportsDir = path.join(tempDir as string, 'reports');
    const targetFilePath = buildReportTargetFilePath({
      employeeCode: 'dev-inactive',
      period: '202603',
      reportsDir
    });
    const logger = createLogger();
    const marchOne = localTimestampMs(2026, 2, 1, 9, 0);
    const marchTenSeconds = localTimestamp(2026, 2, 10, 12, 0);
    const marchFifteen = localTimestampMs(2026, 2, 15, 18, 45);

    database?.employees.create({ code: 'dev-inactive' });
    database?.chats.upsertByEmployeeCode({
      employeeCode: 'dev-inactive',
      chatId: '100@c.us',
      isPhoneNumberVerified: true,
      phoneNumber: '100'
    });
    database?.chats.upsertByEmployeeCode({
      employeeCode: 'dev-inactive',
      chatId: '200@c.us',
      isPhoneNumberVerified: true,
      phoneNumber: '200'
    });
    database?.messages.upsertByEmployeeCode({
      body: 'february ms',
      chatId: '100@c.us',
      direction: 'incoming',
      employeeCode: 'dev-inactive',
      externalMessageId: 'february-ms',
      sourceChatId: '100@c.us',
      timestamp: localTimestampMs(2026, 1, 28, 23, 59)
    });
    database?.messages.upsertByEmployeeCode({
      body: 'march ms one',
      chatId: '100@c.us',
      direction: 'incoming',
      employeeCode: 'dev-inactive',
      externalMessageId: 'march-ms-one',
      sourceChatId: '100@c.us',
      timestamp: marchOne
    });
    database?.messages.upsertByEmployeeCode({
      body: 'march ms two',
      chatId: '200@c.us',
      direction: 'outgoing',
      employeeCode: 'dev-inactive',
      externalMessageId: 'march-ms-two',
      sourceChatId: '200@c.us',
      timestamp: marchFifteen
    });
    database?.messages.upsertByEmployeeCode({
      body: 'march seconds',
      chatId: '100@c.us',
      direction: 'incoming',
      employeeCode: 'dev-inactive',
      externalMessageId: 'march-seconds',
      sourceChatId: '100@c.us',
      timestamp: marchTenSeconds
    });
    database?.messages.upsertByEmployeeCode({
      body: 'april ms',
      chatId: '100@c.us',
      direction: 'incoming',
      employeeCode: 'dev-inactive',
      externalMessageId: 'april-ms',
      sourceChatId: '100@c.us',
      timestamp: localTimestampMs(2026, 3, 1, 0, 0)
    });

    database?.close();

    const exportedRows = exportEmployeeMonthlyReport({
      databasePath,
      employeeCode: 'dev-inactive',
      logger,
      period: '202603',
      reportsDir,
      targetFilePath
    });
    const contents = fs.readFileSync(targetFilePath, 'utf8');
    const lines = contents.slice(1).trimEnd().split('\n');

    expect(exportedRows).toBe(3);
    expect(lines).toEqual([
      REPORT_CSV_HEADER,
      `${formatReportEventTime(marchOne)};100;incoming;march ms one;chat;`,
      `${formatReportEventTime(marchTenSeconds)};100;incoming;march seconds;chat;`,
      `${formatReportEventTime(marchFifteen)};200;outgoing;march ms two;chat;`
    ]);
    expect(logger.info).toHaveBeenCalledWith(
      'Report export completed',
      expect.objectContaining({
        databasePath,
        employeeCode: 'dev-inactive',
        period: '202603',
        rowCount: 3,
        targetFilePath
      })
    );
  });

  it('should log successful empty exports with rowCount zero', () => {
    const databasePath = createFileDatabase();
    const reportsDir = path.join(tempDir as string, 'reports');
    const targetFilePath = buildReportTargetFilePath({
      employeeCode: 'anna',
      period: '202603',
      reportsDir
    });
    const logger = createLogger();

    database?.employees.create({ code: 'anna' });
    database?.close();

    const exportedRows = exportEmployeeMonthlyReport({
      databasePath,
      employeeCode: 'anna',
      logger,
      period: '202603',
      reportsDir,
      targetFilePath
    });
    const contents = fs.readFileSync(targetFilePath, 'utf8');

    expect(exportedRows).toBe(0);
    expect(contents.slice(1)).toBe(`${REPORT_CSV_HEADER}\n`);
    expect(logger.info).toHaveBeenCalledWith(
      'Report export completed',
      expect.objectContaining({
        databasePath,
        durationMs: expect.any(Number),
        employeeCode: 'anna',
        finishedAt: expect.any(String),
        period: '202603',
        rowCount: 0,
        startedAt: expect.any(String),
        targetFilePath
      })
    );
  });

  it('should overwrite an existing report file', () => {
    const databasePath = createFileDatabase();
    const reportsDir = path.join(tempDir as string, 'reports');
    const targetFilePath = buildReportTargetFilePath({
      employeeCode: 'anna',
      period: '202605',
      reportsDir
    });

    database?.employees.create({ code: 'anna' });
    database?.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '100@c.us',
      isPhoneNumberVerified: true,
      phoneNumber: '100'
    });
    database?.messages.upsertByEmployeeCode({
      body: 'fresh',
      chatId: '100@c.us',
      direction: 'incoming',
      employeeCode: 'anna',
      externalMessageId: 'anna-fresh',
      sourceChatId: '100@c.us',
      timestamp: localTimestamp(2026, 4, 1, 9, 0)
    });
    fs.mkdirSync(path.dirname(targetFilePath), {
      recursive: true
    });
    fs.writeFileSync(targetFilePath, 'old contents', 'utf8');

    database?.close();

    exportEmployeeMonthlyReport({
      databasePath,
      employeeCode: 'anna',
      period: '202605',
      reportsDir,
      targetFilePath
    });

    const contents = fs.readFileSync(targetFilePath, 'utf8');

    expect(contents).not.toContain('old contents');
    expect(contents).toContain('fresh');
  });
});
