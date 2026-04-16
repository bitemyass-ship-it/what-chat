import fs from 'node:fs';
import path from 'node:path';
import { Client, LocalAuth } from 'whatsapp-web.js';
import type { Logger, WhatsappClientFactory, WhatsappSessionClient } from '../types/whatsapp';
import { requirePersistentProductionPath } from '../utils/env';
import { findProjectRoot } from '../utils/project-root';

interface LocalAuthOptions {
  clientId?: string;
  dataPath: string;
}

interface ClientOptions {
  authStrategy: unknown;
  puppeteer: {
    args: string[];
    headless: boolean;
    userDataDir?: string;
  };
}

interface ClientConstructor {
  new (options: ClientOptions): WhatsappSessionClient;
}

interface LocalAuthConstructor {
  new (options: LocalAuthOptions): unknown;
}

interface CreateWhatsappClientFactoryOptions {
  Client?: ClientConstructor;
  LocalAuth?: LocalAuthConstructor;
  env?: NodeJS.ProcessEnv;
  logger: Logger;
  projectRoot?: string;
  sessionBasePath?: string;
}

interface CreateWhatsappClientOptions {
  sessionStoragePath?: string | null;
}

interface AuthStrategy {
  afterAuthReady(): Promise<void>;
  afterBrowserInitialized(): Promise<void>;
  beforeBrowserInitialized(): Promise<void>;
  destroy(): Promise<void>;
  disconnect(): Promise<void>;
  getAuthEventPayload(): Promise<unknown>;
  logout(): Promise<void>;
  onAuthenticationNeeded(): Promise<{
    failed: boolean;
    failureEventPayload: unknown;
    restart: boolean;
  }>;
  setup(client: { options: ClientOptions }): void;
}

const DEFAULT_PUPPETEER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-sync',
  '--disable-default-apps',
  '--disable-gpu',
  '--mute-audio',
  '--no-first-run',
  '--no-zygote'
];
const DEFAULT_SESSION_DIRECTORY = 'sessions';
const DEFAULT_RM_MAX_RETRIES = 4;

interface ResolveSessionBasePathOptions {
  env?: NodeJS.ProcessEnv;
  projectRoot?: string;
  sessionBasePath?: string;
}

export const resolveSessionBasePath = ({
  env = process.env,
  projectRoot = findProjectRoot(__dirname),
  sessionBasePath
}: ResolveSessionBasePathOptions = {}): string => {
  const configuredPath = sessionBasePath ?? env.WHATSAPP_SESSION_DIR;

  if (env.NODE_ENV === 'production') {
    return requirePersistentProductionPath({
      env,
      pathValue: configuredPath,
      projectRoot,
      variableName: 'WHATSAPP_SESSION_DIR'
    });
  }

  const fallbackPath = configuredPath ?? DEFAULT_SESSION_DIRECTORY;

  if (path.isAbsolute(fallbackPath)) {
    return fallbackPath;
  }

  return path.resolve(projectRoot, fallbackPath);
};

export const resolveSessionStoragePath = ({
  env,
  projectRoot,
  sessionBasePath,
  sessionKey
}: ResolveSessionBasePathOptions & {
  sessionKey: string;
}): string =>
  path.resolve(
    resolveSessionBasePath({
      env,
      projectRoot,
      sessionBasePath
    }),
    `session-${sessionKey}`
  );

class FixedPathAuthStrategy implements AuthStrategy {
  private client?: { options: ClientOptions };

  constructor(
    private readonly userDataDir: string
  ) {}

  setup(client: { options: ClientOptions }): void {
    this.client = client;
  }

  async beforeBrowserInitialized(): Promise<void> {
    const client = this.client;

    if (!client) {
      throw new Error('WhatsApp client auth strategy is not initialized');
    }

    const puppeteerOptions = client.options.puppeteer;

    if (
      'userDataDir' in puppeteerOptions &&
      typeof puppeteerOptions.userDataDir === 'string' &&
      path.resolve(puppeteerOptions.userDataDir) !== this.userDataDir
    ) {
      throw new Error('LocalAuth is not compatible with a user-supplied userDataDir.');
    }

    fs.mkdirSync(this.userDataDir, { recursive: true });

    client.options.puppeteer = {
      ...puppeteerOptions,
      userDataDir: this.userDataDir
    };
  }

  async afterBrowserInitialized(): Promise<void> {}

  async onAuthenticationNeeded(): Promise<{
    failed: boolean;
    failureEventPayload: unknown;
    restart: boolean;
  }> {
    return {
      failed: false,
      failureEventPayload: undefined,
      restart: false
    };
  }

  async getAuthEventPayload(): Promise<unknown> {
    return undefined;
  }

  async afterAuthReady(): Promise<void> {}

  async disconnect(): Promise<void> {}

  async destroy(): Promise<void> {}

  async logout(): Promise<void> {
    await fs.promises.rm(this.userDataDir, {
      force: true,
      maxRetries: DEFAULT_RM_MAX_RETRIES,
      recursive: true
    });
  }
}

const resolveLocalAuthOptions = ({
  env,
  projectRoot,
  sessionBasePath,
  sessionKey
}: ResolveSessionBasePathOptions &
  CreateWhatsappClientOptions & {
    sessionKey: string;
  }): LocalAuthOptions => {
  return {
    clientId: sessionKey,
    dataPath: resolveSessionBasePath({
      env,
      projectRoot,
      sessionBasePath
    })
  };
};

export const createWhatsappClientFactory = ({
  Client: WhatsappClient = Client as unknown as ClientConstructor,
  LocalAuth: WhatsappLocalAuth = LocalAuth as unknown as LocalAuthConstructor,
  env,
  logger,
  projectRoot,
  sessionBasePath
}: CreateWhatsappClientFactoryOptions): WhatsappClientFactory => ({
  create(
    sessionKey: string,
    options?: CreateWhatsappClientOptions
  ): WhatsappSessionClient {
    const normalizedSessionStoragePath =
      typeof options?.sessionStoragePath === 'string' &&
      options.sessionStoragePath.trim() !== ''
        ? path.resolve(options.sessionStoragePath.trim())
        : null;

    logger.info('Creating WhatsApp client', {
      sessionKey,
      sessionStoragePath: normalizedSessionStoragePath
    });
    const authStrategy: AuthStrategy | unknown = normalizedSessionStoragePath
      ? new FixedPathAuthStrategy(normalizedSessionStoragePath)
      : new WhatsappLocalAuth(
          resolveLocalAuthOptions({
            env,
            projectRoot,
            sessionBasePath,
            sessionKey,
            sessionStoragePath: options?.sessionStoragePath
          })
        );
    const sessionDirectoryToCreate = normalizedSessionStoragePath
      ? normalizedSessionStoragePath
      : resolveSessionBasePath({
          env,
          projectRoot,
          sessionBasePath
        });

    try {
      fs.mkdirSync(sessionDirectoryToCreate, { recursive: true });
    } catch (error) {
      logger.warn('Unable to pre-create WhatsApp session directory', {
        error: error instanceof Error ? error.message : 'Unknown error',
        sessionBasePath: sessionDirectoryToCreate
      });
    }

    logger.info('WhatsApp client Puppeteer config resolved', {
      sessionKey,
      headless: true,
      args: DEFAULT_PUPPETEER_ARGS
    });

    return new WhatsappClient({
      authStrategy,
      puppeteer: {
        args: DEFAULT_PUPPETEER_ARGS,
        headless: true
      }
    });
  }
});
