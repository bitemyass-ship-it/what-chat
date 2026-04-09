import fs from 'node:fs';
import path from 'node:path';
import { findProjectRoot } from './project-root';

const ENV_FILE_NAMES = ['.env', '.env.local'];

interface RequirePersistentProductionPathOptions {
  env?: NodeJS.ProcessEnv;
  pathValue: string | undefined;
  projectRoot?: string;
  variableName: string;
}

interface LoadEnvironmentOptions {
  env?: NodeJS.ProcessEnv;
  projectRoot?: string;
}

const parseLine = (line: string): [string, string] | null => {
  const trimmedLine = line.trim();

  if (trimmedLine === '' || trimmedLine.startsWith('#')) {
    return null;
  }

  const separatorIndex = trimmedLine.indexOf('=');

  if (separatorIndex === -1) {
    return null;
  }

  const key = trimmedLine.slice(0, separatorIndex).trim();
  const rawValue = trimmedLine.slice(separatorIndex + 1).trim();
  const value = rawValue.replace(/^['"]|['"]$/g, '');

  if (key === '') {
    return null;
  }

  return [key, value];
};

export const loadEnvironment = ({
  env = process.env,
  projectRoot = findProjectRoot(__dirname)
}: LoadEnvironmentOptions = {}): void => {
  const lockedKeys = new Set(Object.keys(env));

  for (const fileName of ENV_FILE_NAMES) {
    const filePath = path.join(projectRoot, fileName);

    if (!fs.existsSync(filePath)) {
      continue;
    }

    const contents = fs.readFileSync(filePath, 'utf8');

    for (const line of contents.split(/\r?\n/u)) {
      const entry = parseLine(line);

      if (!entry) {
        continue;
      }

      const [key, value] = entry;

      if (lockedKeys.has(key)) {
        continue;
      }

      env[key] = value;
    }
  }
};

const isPathInsideDirectory = (
  candidatePath: string,
  directoryPath: string
): boolean => {
  const relativePath = path.relative(directoryPath, candidatePath);

  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  );
};

export const requirePersistentProductionPath = ({
  env = process.env,
  pathValue,
  projectRoot = findProjectRoot(__dirname),
  variableName
}: RequirePersistentProductionPathOptions): string => {
  if (env.NODE_ENV !== 'production') {
    return pathValue?.trim() ?? '';
  }

  if (typeof pathValue !== 'string' || pathValue.trim() === '') {
    throw new Error(`${variableName} is required for first-mode production`);
  }

  const trimmedPath = pathValue.trim();

  if (trimmedPath === ':memory:') {
    throw new Error(
      `${variableName} must not use an in-memory path for first-mode production`
    );
  }

  if (!path.isAbsolute(trimmedPath)) {
    throw new Error(
      `${variableName} must be an absolute path for first-mode production`
    );
  }

  const normalizedPath = path.resolve(trimmedPath);
  const normalizedProjectRoot = path.resolve(projectRoot);

  if (isPathInsideDirectory(normalizedPath, normalizedProjectRoot)) {
    throw new Error(
      `${variableName} must point outside the repository checkout for first-mode production`
    );
  }

  return normalizedPath;
};

export const requireAuthPassword = (env: NodeJS.ProcessEnv = process.env): string => {
  const authPassword = env.AUTH_PASSWORD;

  if (typeof authPassword !== 'string' || authPassword.trim() === '') {
    throw new Error('AUTH_PASSWORD is required');
  }

  return authPassword;
};
