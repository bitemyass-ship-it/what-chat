import fs from 'node:fs';
import path from 'node:path';

export const findProjectRoot = (startDirectory: string): string => {
  let currentDirectory = path.resolve(startDirectory);

  while (true) {
    if (fs.existsSync(path.join(currentDirectory, 'package.json'))) {
      return currentDirectory;
    }

    const parentDirectory = path.dirname(currentDirectory);

    if (parentDirectory === currentDirectory) {
      return currentDirectory;
    }

    currentDirectory = parentDirectory;
  }
};
