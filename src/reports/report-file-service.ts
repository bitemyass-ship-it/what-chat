import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Logger } from '../types/whatsapp';
import { parseReportPeriod } from './report-period';
import {
  buildReportsEmployeesDirPath,
  isPathInsideReportsDir
} from './report-paths';

export interface AvailableReport {
  downloadUrl: string;
  employeeCode: string;
  fileName: string;
  period: string;
}

interface ListAvailableReportsOptions {
  logger: Logger;
  reportsDir: string;
}

export const REPORT_FILE_READ_ERROR = 'Failed to read report file';
export const REPORT_FILE_LIST_ERROR = 'Failed to list report files';

const getErrorCode = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
};

export const isMissingReportFileError = (error: unknown): boolean => {
  const code = getErrorCode(error);

  return code === 'ENOENT' || code === 'ENOTDIR';
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unknown error';

const compareString = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
};

const parseReportFileName = (
  employeeCode: string,
  fileName: string
): string | null => {
  const filePrefix = `${employeeCode}-`;

  if (!fileName.startsWith(filePrefix) || !fileName.endsWith('.csv')) {
    return null;
  }

  const period = fileName.slice(filePrefix.length, -'.csv'.length);

  try {
    parseReportPeriod(period);
  } catch {
    return null;
  }

  return period;
};

export const listAvailableReports = async ({
  logger,
  reportsDir
}: ListAvailableReportsOptions): Promise<AvailableReport[]> => {
  const reportsRoot = path.resolve(reportsDir);
  const employeesDir = buildReportsEmployeesDirPath(reportsRoot);
  let employeeEntries: Array<Dirent<string>>;

  try {
    employeeEntries = await fs.readdir(employeesDir, {
      withFileTypes: true
    });
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') {
      return [];
    }

    throw error;
  }

  const reports: AvailableReport[] = [];

  for (const employeeEntry of employeeEntries) {
    if (!employeeEntry.isDirectory()) {
      continue;
    }

    const employeeCode = employeeEntry.name;
    const employeeDir = path.join(employeesDir, employeeCode);

    if (
      !isPathInsideReportsDir({
        reportsDir: reportsRoot,
        targetFilePath: employeeDir
      })
    ) {
      continue;
    }

    let reportEntries: Array<Dirent<string>>;

    try {
      reportEntries = await fs.readdir(employeeDir, {
        withFileTypes: true
      });
    } catch (error) {
      logger.warn('Failed to read employee report directory', {
        employeeCode,
        employeeDir,
        error: getErrorMessage(error)
      });
      continue;
    }

    for (const reportEntry of reportEntries) {
      if (!reportEntry.isFile()) {
        continue;
      }

      const fileName = reportEntry.name;
      const period = parseReportFileName(employeeCode, fileName);

      if (period === null) {
        continue;
      }

      const targetFilePath = path.join(employeeDir, fileName);

      if (
        !isPathInsideReportsDir({
          reportsDir: reportsRoot,
          targetFilePath
        })
      ) {
        continue;
      }

      reports.push({
        downloadUrl: `/reports/${encodeURIComponent(employeeCode)}/${period}`,
        employeeCode,
        fileName,
        period
      });
    }
  }

  return reports.sort((left, right) => {
    const employeeCompare = compareString(left.employeeCode, right.employeeCode);

    if (employeeCompare !== 0) {
      return employeeCompare;
    }

    const periodCompare = compareString(right.period, left.period);

    if (periodCompare !== 0) {
      return periodCompare;
    }

    return compareString(left.fileName, right.fileName);
  });
};
