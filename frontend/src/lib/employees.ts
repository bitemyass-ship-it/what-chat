import {
  deserializeEmployee,
  type Employee
} from './employee-record';
import {
  fetchAuthenticatedBackend,
  resolveEmployeesApiBaseUrl
} from './backend-api';

export type { Employee } from './employee-record';
export { formatEmployeeDate, parseEmployeeTimestamp } from './employee-record';
export { resolveEmployeesApiBaseUrl } from './backend-api';

export interface EmployeesResult {
  employees: Employee[];
  error: string | null;
  unauthorized: boolean;
  warning: string | null;
}

export interface EmployeeDetailResult {
  employee: Employee | null;
  error: string | null;
  notFound: boolean;
  unauthorized: boolean;
}

const EMPLOYEE_API_TIMEOUT_MS = 5_000;

interface NormalizedEmployeesPayload {
  employees: Employee[];
  invalidRecords: number;
  totalRecords: number;
}

const asPublicError = (message: string): EmployeesResult => ({
  employees: [],
  error: message,
  unauthorized: false,
  warning: null
});

const logEmployeeApiError = (
  message: string,
  meta?: Record<string, unknown>
): void => {
  console.error(message, meta ?? {});
};

export const normalizeEmployeesPayload = (
  payload: unknown
): NormalizedEmployeesPayload | null => {
  if (!Array.isArray(payload)) {
    return null;
  }

  const employees = payload
    .map((item) => deserializeEmployee(item))
    .filter((employee): employee is Employee => employee !== null);
  const invalidRecords = payload.length - employees.length;

  if (invalidRecords > 0) {
    console.warn('Employee API returned malformed employee records', {
      skippedEmployees: invalidRecords
    });
  }

  return {
    employees,
    invalidRecords,
    totalRecords: payload.length
  };
};

interface AuthenticatedEmployeesRequestOptions {
  apiBaseUrl?: string | null;
  authPassword: string | null;
  fetchImpl?: typeof fetch;
}

export const getEmployees = async ({
  apiBaseUrl = resolveEmployeesApiBaseUrl(),
  authPassword,
  fetchImpl = fetch
}: AuthenticatedEmployeesRequestOptions): Promise<EmployeesResult> => {
  try {
    const response = await fetchAuthenticatedBackend({
      apiBaseUrl,
      authPassword,
      fetchImpl,
      method: 'GET',
      path: '/employees',
      timeoutMs: EMPLOYEE_API_TIMEOUT_MS
    });

    if (response === 'config_error') {
      return asPublicError('Employee API is not configured');
    }

    if (response === 'unauthorized' || response.status === 401) {
      return {
        employees: [],
        error: null,
        unauthorized: true,
        warning: null
      };
    }

    if (!response.ok) {
      logEmployeeApiError('Employee API returned non-success status', {
        apiBaseUrl,
        status: response.status
      });
      return asPublicError('Unable to load employees right now');
    }

    const payload = await response.json();
    const normalizedPayload = normalizeEmployeesPayload(payload);

    if (!normalizedPayload) {
      logEmployeeApiError('Employee API returned invalid payload', {
        apiBaseUrl,
        payloadType: Array.isArray(payload) ? 'array' : typeof payload
      });
      return asPublicError('Employee API returned invalid data');
    }

    if (
      normalizedPayload.totalRecords > 0 &&
      normalizedPayload.invalidRecords === normalizedPayload.totalRecords
    ) {
      logEmployeeApiError('Employee API returned only invalid employee records', {
        apiBaseUrl,
        totalRecords: normalizedPayload.totalRecords
      });
      return asPublicError('Employee API returned invalid data');
    }

    return {
      employees: normalizedPayload.employees,
      error: null,
      unauthorized: false,
      warning:
        normalizedPayload.invalidRecords > 0
          ? 'Some employee records could not be displayed'
          : null
    };
  } catch (error) {
    logEmployeeApiError('Employee API request failed', {
      apiBaseUrl,
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    if (error instanceof SyntaxError) {
      return asPublicError('Employee API returned invalid data');
    }

    if (
      error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'TimeoutError')
    ) {
      return asPublicError('Employee API is unavailable right now');
    }

    return asPublicError('Unable to reach employee API');
  }
};

export const getEmployeeByCode = async (
  code: string,
  {
    apiBaseUrl = resolveEmployeesApiBaseUrl(),
    authPassword,
    fetchImpl = fetch
  }: AuthenticatedEmployeesRequestOptions
): Promise<EmployeeDetailResult> => {
  try {
    const response = await fetchAuthenticatedBackend({
      apiBaseUrl,
      authPassword,
      fetchImpl,
      method: 'GET',
      path: `/employees/${encodeURIComponent(code)}`,
      timeoutMs: EMPLOYEE_API_TIMEOUT_MS
    });

    if (response === 'config_error') {
      return {
        employee: null,
        error: 'Employee API is not configured',
        notFound: false,
        unauthorized: false
      };
    }

    if (response === 'unauthorized' || response.status === 401) {
      return {
        employee: null,
        error: null,
        notFound: false,
        unauthorized: true
      };
    }

    if (response.status === 404) {
      return {
        employee: null,
        error: null,
        notFound: true,
        unauthorized: false
      };
    }

    if (!response.ok) {
      logEmployeeApiError('Employee detail API returned non-success status', {
        apiBaseUrl,
        code,
        status: response.status
      });

      return {
        employee: null,
        error: 'Unable to load employee right now',
        notFound: false,
        unauthorized: false
      };
    }

    const payload = await response.json();
    const employee = deserializeEmployee(payload);

    if (!employee) {
      logEmployeeApiError('Employee detail API returned invalid payload', {
        apiBaseUrl,
        code,
        payloadType: Array.isArray(payload) ? 'array' : typeof payload
      });

      return {
        employee: null,
        error: 'Employee API returned invalid data',
        notFound: false,
        unauthorized: false
      };
    }

    return {
      employee,
      error: null,
      notFound: false,
      unauthorized: false
    };
  } catch (error) {
    logEmployeeApiError('Employee detail API request failed', {
      apiBaseUrl,
      code,
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    if (error instanceof SyntaxError) {
      return {
        employee: null,
        error: 'Employee API returned invalid data',
        notFound: false,
        unauthorized: false
      };
    }

    if (
      error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'TimeoutError')
    ) {
      return {
        employee: null,
        error: 'Employee API is unavailable right now',
        notFound: false,
        unauthorized: false
      };
    }

    return {
      employee: null,
      error: 'Unable to reach employee API',
      notFound: false,
      unauthorized: false
    };
  }
};
