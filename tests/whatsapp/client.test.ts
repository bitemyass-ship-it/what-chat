jest.mock('whatsapp-web.js', () => ({
  Client: jest.fn(),
  LocalAuth: jest.fn()
}));

import fs from 'node:fs';
import path from 'node:path';
import { Client, LocalAuth } from 'whatsapp-web.js';
import {
  createWhatsappClientFactory,
  resolveSessionBasePath,
  resolveSessionStoragePath
} from '../../src/whatsapp/client';
import type { Logger } from '../../src/types/whatsapp';

describe('createWhatsappClientFactory', () => {
  const MockedClient = Client as unknown as jest.Mock;
  const MockedLocalAuth = LocalAuth as unknown as jest.Mock;
  let mkdirSyncSpy: jest.SpiedFunction<typeof fs.mkdirSync>;

  beforeEach(() => {
    jest.clearAllMocks();
    mkdirSyncSpy = jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
  });

  afterEach(() => {
    mkdirSyncSpy.mockRestore();
  });

  it('should create a client with correct config', () => {
    const projectRoot = '/app/root';
    const clientInstance = { initialize: jest.fn(), on: jest.fn() };
    const authStrategy = { strategy: 'local-auth' };
    const logger: Logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    MockedLocalAuth.mockImplementation(() => authStrategy);
    MockedClient.mockImplementation(() => clientInstance);

    const factory = createWhatsappClientFactory({
      logger,
      projectRoot
    });

    const client = factory.create('employee-1');

    expect(client).toBe(clientInstance);
    expect(MockedLocalAuth).toHaveBeenCalledWith({
      clientId: 'employee-1',
      dataPath: path.resolve(projectRoot, 'sessions')
    });
    expect(MockedClient).toHaveBeenCalledWith(
      expect.objectContaining({
        authStrategy,
        puppeteer: expect.objectContaining({
          headless: true,
          args: expect.arrayContaining(['--no-sandbox', '--disable-setuid-sandbox'])
        })
      })
    );
  });

  it('should use LocalAuth with unique clientId', () => {
    const projectRoot = '/app/root';
    const logger: Logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    MockedLocalAuth.mockImplementation(() => ({}));
    MockedClient.mockImplementation(() => ({
      initialize: jest.fn(),
      on: jest.fn()
    }));

    const factory = createWhatsappClientFactory({
      logger,
      projectRoot
    });

    factory.create('employee-1');
    factory.create('employee-2');

    expect(MockedLocalAuth).toHaveBeenNthCalledWith(1, {
      clientId: 'employee-1',
      dataPath: path.resolve(projectRoot, 'sessions')
    });
    expect(MockedLocalAuth).toHaveBeenNthCalledWith(2, {
      clientId: 'employee-2',
      dataPath: path.resolve(projectRoot, 'sessions')
    });
  });

  it('should derive LocalAuth config from an explicit session storage path override', () => {
    const logger: Logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    MockedClient.mockImplementation(() => ({
      initialize: jest.fn(),
      on: jest.fn()
    }));

    const factory = createWhatsappClientFactory({
      logger,
      projectRoot: '/app/root'
    });

    factory.create('380991112233', {
      sessionStoragePath: '/persisted/custom-auth-dir'
    });

    expect(MockedLocalAuth).not.toHaveBeenCalled();
    const authStrategy = MockedClient.mock.calls[0]?.[0]?.authStrategy as {
      beforeBrowserInitialized(): Promise<void>;
      setup(client: {
        options: {
          puppeteer: {
            args: string[];
            headless: boolean;
            userDataDir?: string;
          };
        };
      }): void;
    };
    const clientOptions = {
      options: {
        puppeteer: {
          args: [],
          headless: true,
          userDataDir: undefined as string | undefined
        }
      }
    };

    authStrategy.setup(clientOptions);

    return expect(authStrategy.beforeBrowserInitialized()).resolves.toBeUndefined().then(() => {
      expect(clientOptions.options.puppeteer.userDataDir).toBe(
        path.resolve('/persisted/custom-auth-dir')
      );
      expect(mkdirSyncSpy).toHaveBeenCalledWith(
        path.resolve('/persisted/custom-auth-dir'),
        {
          recursive: true
        }
      );
    });
  });

  it('should resolve a stable absolute session path from project root by default', () => {
    expect(resolveSessionBasePath({ projectRoot: '/app/root' })).toBe(
      path.resolve('/app/root', 'sessions')
    );
  });

  it('should resolve a stable absolute session path from the environment when configured', () => {
    expect(
      resolveSessionBasePath({
        env: {
          WHATSAPP_SESSION_DIR: 'custom-sessions'
        },
        projectRoot: '/app/root'
      })
    ).toBe(path.resolve('/app/root', 'custom-sessions'));
  });

  it('should require an explicit absolute session directory in production', () => {
    expect(() =>
      resolveSessionBasePath({
        env: {
          NODE_ENV: 'production'
        },
        projectRoot: '/app/root'
      })
    ).toThrow('WHATSAPP_SESSION_DIR is required for first-mode production');

    expect(() =>
      resolveSessionBasePath({
        env: {
          NODE_ENV: 'production',
          WHATSAPP_SESSION_DIR: 'sessions'
        },
        projectRoot: '/app/root'
      })
    ).toThrow(
      'WHATSAPP_SESSION_DIR must be an absolute path for first-mode production'
    );
  });

  it('should reject a session directory inside the repository checkout in production', () => {
    expect(() =>
      resolveSessionBasePath({
        env: {
          NODE_ENV: 'production',
          WHATSAPP_SESSION_DIR: '/app/root/sessions'
        },
        projectRoot: '/app/root'
      })
    ).toThrow(
      'WHATSAPP_SESSION_DIR must point outside the repository checkout for first-mode production'
    );
  });

  it('should accept an absolute persistent session directory outside the repository in production', () => {
    expect(
      resolveSessionBasePath({
        env: {
          NODE_ENV: 'production',
          WHATSAPP_SESSION_DIR: '/var/lib/whatsapp-monitor/sessions'
        },
        projectRoot: '/app/root'
      })
    ).toBe('/var/lib/whatsapp-monitor/sessions');
  });

  it('should resolve the concrete LocalAuth storage directory for a session key', () => {
    expect(
      resolveSessionStoragePath({
        projectRoot: '/app/root',
        sessionKey: '380991112233'
      })
    ).toBe(path.resolve('/app/root', 'sessions', 'session-380991112233'));
  });
});
