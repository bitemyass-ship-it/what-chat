import fs from 'node:fs/promises';
import type { RequestHandler } from 'express';
import type { EmployeesRepository } from '../database/types';
import type { Logger } from '../types/whatsapp';
import {
  isMissingReportFileError,
  listAvailableReports,
  REPORT_FILE_LIST_ERROR,
  REPORT_FILE_READ_ERROR
} from '../reports/report-file-service';
import {
  assertReportPeriodNotFuture,
  parseReportPeriod
} from '../reports/report-period';
import {
  isPathInsideReportsDir,
  resolveReportTargetFilePath
} from '../reports/report-paths';
import type { ReportExportService } from '../reports/report-export-service';

interface CreateReportsControllerOptions {
  databasePath: string;
  employees: EmployeesRepository;
  exportService: ReportExportService;
  logger: Logger;
  reportsDir: string;
}

interface ReportsController {
  create: RequestHandler;
  download: RequestHandler;
  list: RequestHandler;
}

const getEmployeeCodeParam = (value: unknown): string => {
  if (typeof value !== 'string') {
    throw new Error('employeeCode route parameter is required');
  }

  const employeeCode = value.trim();

  if (employeeCode === '') {
    throw new Error('employeeCode route parameter is required');
  }

  return employeeCode;
};

const getPeriodParam = (value: unknown): string => {
  if (typeof value !== 'string') {
    throw new Error('period route parameter must use YYYYMM format');
  }

  const periodRange = parseReportPeriod(value);

  assertReportPeriodNotFuture(periodRange);

  return periodRange.period;
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unknown error';

const sendBadRequest = (
  response: Parameters<RequestHandler>[1],
  error: unknown
): void => {
  response.status(400).json({
    error: getErrorMessage(error)
  });
};

export const createReportsController = ({
  databasePath,
  employees,
  exportService,
  logger,
  reportsDir
}: CreateReportsControllerOptions): ReportsController => ({
  create: (request, response) => {
    let employeeCode: string;
    let period: string;

    try {
      employeeCode = getEmployeeCodeParam(request.params.employeeCode);
      period = getPeriodParam(request.params.period);
    } catch (error) {
      response.status(400).json({
        error: getErrorMessage(error)
      });
      return;
    }

    try {
      const employee = employees.findByCode(employeeCode);

      if (!employee) {
        response.status(404).json({
          error: `Employee not found: ${employeeCode}`
        });
        return;
      }

      const targetFilePath = resolveReportTargetFilePath({
        employeeCode,
        period,
        reportsDir
      });

      exportService.startExport({
        databasePath,
        employeeCode,
        period,
        reportsDir,
        targetFilePath
      });

      response.status(202).json({
        status: 'accepted'
      });
    } catch (error) {
      logger.error('Failed to start report export', {
        employeeCode,
        error: getErrorMessage(error),
        period
      });
      response.status(500).json({
        error: 'Failed to start report export'
      });
    }
  },

  download: async (request, response) => {
    let employeeCode: string;
    let period: string;
    let targetFilePath: string;

    try {
      employeeCode = getEmployeeCodeParam(request.params.employeeCode);
      period = getPeriodParam(request.params.period);
      targetFilePath = resolveReportTargetFilePath({
        employeeCode,
        period,
        reportsDir
      });
    } catch (error) {
      sendBadRequest(response, error);
      return;
    }

    if (
      !isPathInsideReportsDir({
        reportsDir,
        targetFilePath
      })
    ) {
      response.status(400).json({
        error: 'Invalid report path'
      });
      return;
    }

    const employee = employees.findByCode(employeeCode);

    if (!employee) {
      response.status(404).json({
        error: `Employee not found: ${employeeCode}`
      });
      return;
    }

    let fileContents: Buffer;

    try {
      fileContents = await fs.readFile(targetFilePath);
    } catch (error) {
      if (isMissingReportFileError(error)) {
        response.status(404).json({
          error: `Report not found: ${employeeCode} ${period}`
        });
        return;
      }

      logger.error(REPORT_FILE_READ_ERROR, {
        employeeCode,
        error: getErrorMessage(error),
        period,
        targetFilePath
      });
      response.status(500).json({
        error: REPORT_FILE_READ_ERROR
      });
      return;
    }

    const fileName = `${employeeCode}-${period}.csv`;

    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    response.setHeader('Content-Length', String(fileContents.byteLength));
    response.status(200);
    response.end(fileContents);
  },

  list: async (_request, response) => {
    try {
      const reports = await listAvailableReports({
        logger,
        reportsDir
      });

      response.status(200).json(reports);
    } catch (error) {
      logger.error(REPORT_FILE_LIST_ERROR, {
        error: getErrorMessage(error),
        reportsDir
      });
      response.status(500).json({
        error: REPORT_FILE_LIST_ERROR
      });
    }
  }
});
