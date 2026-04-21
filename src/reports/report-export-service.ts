import {
  spawn,
  type SpawnOptions
} from 'node:child_process';
import path from 'node:path';
import type { Logger } from '../types/whatsapp';

export interface StartReportExportInput {
  databasePath: string;
  employeeCode: string;
  period: string;
  reportsDir: string;
  targetFilePath: string;
}

export interface ReportExportStartResult {
  alreadyRunning: boolean;
  status: 'accepted';
}

export interface ReportExportService {
  startExport(input: StartReportExportInput): ReportExportStartResult;
}

export interface ReportExportChildProcess {
  pid?: number;
  once(
    event: 'close',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void
  ): this;
  once(event: 'error', listener: (error: Error) => void): this;
  unref(): void;
}

export type SpawnReportExportWorker = (
  input: StartReportExportInput
) => ReportExportChildProcess;

interface CreateReportExportServiceOptions {
  logger: Logger;
  spawnWorker?: SpawnReportExportWorker;
}

const buildJobKey = (employeeCode: string, period: string): string =>
  `${employeeCode}:${period}`;

const resolveDefaultWorkerScriptPath = (): string => {
  const extension = path.extname(__filename);

  return path.join(
    __dirname,
    `report-export-worker${extension === '.ts' ? '.ts' : '.js'}`
  );
};

const buildWorkerProcessArgs = (input: StartReportExportInput): string[] => [
  '--employeeCode',
  input.employeeCode,
  '--period',
  input.period,
  '--databasePath',
  input.databasePath,
  '--reportsDir',
  input.reportsDir,
  '--targetFilePath',
  input.targetFilePath
];

const createDefaultSpawnWorker = (): SpawnReportExportWorker => {
  const workerScriptPath = resolveDefaultWorkerScriptPath();

  return (input) => {
    const workerArgs = buildWorkerProcessArgs(input);
    const nodeArgs = workerScriptPath.endsWith('.ts')
      ? ['-r', 'ts-node/register', workerScriptPath, ...workerArgs]
      : [workerScriptPath, ...workerArgs];
    const spawnOptions: SpawnOptions = {
      stdio: ['ignore', 'inherit', 'inherit']
    };

    return spawn(process.execPath, nodeArgs, spawnOptions);
  };
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unknown error';

export const createReportExportService = ({
  logger,
  spawnWorker = createDefaultSpawnWorker()
}: CreateReportExportServiceOptions): ReportExportService => {
  const activeJobs = new Set<string>();

  return {
    startExport(input: StartReportExportInput): ReportExportStartResult {
      const jobKey = buildJobKey(input.employeeCode, input.period);

      if (activeJobs.has(jobKey)) {
        logger.info('Report export already running', {
          employeeCode: input.employeeCode,
          period: input.period,
          targetFilePath: input.targetFilePath
        });
        return {
          alreadyRunning: true,
          status: 'accepted'
        };
      }

      activeJobs.add(jobKey);

      let child: ReportExportChildProcess;

      try {
        child = spawnWorker(input);
      } catch (error) {
        activeJobs.delete(jobKey);
        throw error;
      }

      const clearActiveJob = (): void => {
        activeJobs.delete(jobKey);
      };

      child.once('error', (error) => {
        clearActiveJob();
        logger.error('Report export worker failed to start', {
          employeeCode: input.employeeCode,
          error: getErrorMessage(error),
          period: input.period,
          targetFilePath: input.targetFilePath
        });
      });
      child.once('close', (code, signal) => {
        clearActiveJob();

        if (code === 0) {
          logger.info('Report export worker finished', {
            employeeCode: input.employeeCode,
            period: input.period,
            targetFilePath: input.targetFilePath
          });
          return;
        }

        logger.error('Report export worker exited with failure', {
          code,
          employeeCode: input.employeeCode,
          period: input.period,
          signal,
          targetFilePath: input.targetFilePath
        });
      });
      child.unref();

      logger.info('Report export worker started', {
        employeeCode: input.employeeCode,
        period: input.period,
        pid: child.pid,
        targetFilePath: input.targetFilePath
      });

      return {
        alreadyRunning: false,
        status: 'accepted'
      };
    }
  };
};
