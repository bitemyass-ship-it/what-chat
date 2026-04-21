import path from 'node:path';
import { findProjectRoot } from '../utils/project-root';

const DEFAULT_REPORTS_DIR = 'reports';

interface ResolveReportsDirOptions {
  env?: NodeJS.ProcessEnv;
  projectRoot?: string;
  reportsDir?: string;
}

interface BuildReportTargetFilePathOptions {
  employeeCode: string;
  period: string;
  reportsDir: string;
}

export const resolveReportsDir = ({
  env = process.env,
  projectRoot = findProjectRoot(__dirname),
  reportsDir
}: ResolveReportsDirOptions = {}): string => {
  const configuredPath = reportsDir ?? env.REPORTS_DIR ?? DEFAULT_REPORTS_DIR;
  const normalizedPath = configuredPath.trim() || DEFAULT_REPORTS_DIR;

  if (path.isAbsolute(normalizedPath)) {
    return path.resolve(normalizedPath);
  }

  return path.resolve(projectRoot, normalizedPath);
};

export const buildReportTargetFilePath = ({
  employeeCode,
  period,
  reportsDir
}: BuildReportTargetFilePathOptions): string =>
  path.join(
    reportsDir,
    'employees',
    employeeCode,
    `${employeeCode}-${period}.csv`
  );
