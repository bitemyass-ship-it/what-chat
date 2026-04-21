import type { RequestHandler } from 'express';
import type { EmployeesRepository } from '../database/types';
import type { Logger } from '../types/whatsapp';
import {
  assertReportPeriodNotFuture,
  parseReportPeriod
} from '../reports/report-period';
import { buildReportTargetFilePath } from '../reports/report-paths';
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

      const targetFilePath = buildReportTargetFilePath({
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
  }
});
