import { Router } from 'express';
import { createReportsController } from '../controllers/reports-controller';
import type { EmployeesRepository } from '../database/types';
import type { ReportExportService } from '../reports/report-export-service';
import type { Logger } from '../types/whatsapp';

interface CreateReportsRouterOptions {
  databasePath: string;
  employees: EmployeesRepository;
  exportService: ReportExportService;
  logger: Logger;
  reportsDir: string;
}

export const createReportsRouter = ({
  databasePath,
  employees,
  exportService,
  logger,
  reportsDir
}: CreateReportsRouterOptions): Router => {
  const controller = createReportsController({
    databasePath,
    employees,
    exportService,
    logger,
    reportsDir
  });
  const router = Router();

  router.post('/reports/:employeeCode/:period', controller.create);

  return router;
};
