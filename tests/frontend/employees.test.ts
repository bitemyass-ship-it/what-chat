import {
  formatEmployeeDate,
  getEmployees,
  normalizeEmployeesPayload,
  resolveEmployeesApiBaseUrl
} from '../../frontend/src/lib/employees';

describe('frontend employees lib', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;
  const authOptions = {
    authPassword: '0000'
  };
  let consoleErrorSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env = {
      ...originalEnv
    };
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it('should use the development localhost fallback when API URL is not configured', () => {
    delete process.env.EMPLOYEES_API_BASE_URL;
    process.env.NODE_ENV = 'development';

    expect(resolveEmployeesApiBaseUrl()).toBe('http://localhost:3050');
  });

  it('should require explicit API configuration in production', () => {
    delete process.env.EMPLOYEES_API_BASE_URL;
    process.env.NODE_ENV = 'production';

    expect(resolveEmployeesApiBaseUrl()).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Employee API base URL is missing in production',
      {}
    );
  });

  it('should trim and validate configured API URLs', () => {
    process.env.EMPLOYEES_API_BASE_URL = '  http://api.example.com:3000///  ';

    expect(resolveEmployeesApiBaseUrl()).toBe('http://api.example.com:3000');
  });

  it('should return an error when the employee payload is not an array', async () => {
    global.fetch = jest.fn(async () =>
      new Response(JSON.stringify({ employees: [] }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      })
    ) as typeof fetch;

    await expect(getEmployees(authOptions)).resolves.toEqual({
      employees: [],
      error: 'Employee API returned invalid data',
      unauthorized: false,
      warning: null
    });
  });

  it('should keep valid employees, safely normalize bad dates and flag partial data', async () => {
    global.fetch = jest.fn(async () =>
      new Response(
        JSON.stringify([
          {
            id: 1,
            code: 'anna',
            displayName: 'Anna',
            phoneNumber: '380991112233',
            isActive: true,
            sessionDir: null,
            createdAt: 'invalid-date',
            updatedAt: '2026-03-29 10:00:00'
          },
          {
            id: 'broken',
            code: '',
            isActive: 'yes'
          }
        ]),
        {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        }
      )
    ) as typeof fetch;

    await expect(getEmployees(authOptions)).resolves.toEqual({
      employees: [
        expect.objectContaining({
          id: 1,
          code: 'anna',
          createdAtLabel: 'Unknown date'
        })
      ],
      error: null,
      unauthorized: false,
      warning: 'Some employee records could not be displayed'
    });
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'Employee API returned malformed employee records',
      {
        skippedEmployees: 1
      }
    );
  });

  it('should treat an array with only invalid employees as an API error', async () => {
    global.fetch = jest.fn(async () =>
      new Response(
        JSON.stringify([
          {
            id: 'broken',
            code: '',
            isActive: 'yes'
          }
        ]),
        {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        }
      )
    ) as typeof fetch;

    await expect(getEmployees(authOptions)).resolves.toEqual({
      employees: [],
      error: 'Employee API returned invalid data',
      unauthorized: false,
      warning: null
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Employee API returned only invalid employee records',
      {
        apiBaseUrl: 'http://localhost:3050',
        totalRecords: 1
      }
    );
  });

  it('should not leak raw network errors to the UI', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:3050');
    }) as typeof fetch;

    await expect(getEmployees(authOptions)).resolves.toEqual({
      employees: [],
      error: 'Unable to reach employee API',
      unauthorized: false,
      warning: null
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith('Employee API request failed', {
      apiBaseUrl: 'http://localhost:3050',
      error: 'connect ECONNREFUSED 127.0.0.1:3050'
    });
  });

  it('should surface timeouts as a stable unavailable error', async () => {
    const timeoutError = new Error('The operation was aborted');
    timeoutError.name = 'TimeoutError';

    global.fetch = jest.fn(async () => {
      throw timeoutError;
    }) as typeof fetch;

    await expect(getEmployees(authOptions)).resolves.toEqual({
      employees: [],
      error: 'Employee API is unavailable right now',
      unauthorized: false,
      warning: null
    });
  });

  it('should parse sqlite timestamps as UTC when formatting employee dates', () => {
    expect(formatEmployeeDate('2026-03-29 23:59:59')).toBe('29 Mar 2026');
  });

  it('should reject non-array payloads before JSX can crash on them', () => {
    expect(normalizeEmployeesPayload({})).toBeNull();
  });
});
