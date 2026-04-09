import { deserializeEmployee, type Employee } from '@/lib/employee-record';

export const CREATE_USER_NAME_REQUIRED_ERROR = 'Name is required';
export const CREATE_USER_GENERIC_ERROR = 'Unable to create user right now';
export const DELETE_USER_GENERIC_ERROR = 'Unable to delete user right now';
export const INVALID_EMPLOYEE_RESPONSE_ERROR = 'Employee API returned invalid data';
export const DELETE_USER_CONFIRMATION_TOKEN = 'DELETE';

export interface CreateUserPayload {
  displayName: string;
}

export type CreateUserResult =
  | {
      kind: 'success';
      employee: Employee;
    }
  | {
      kind: 'error';
      message: string;
    };

export type DeleteUserResult =
  | {
      kind: 'success';
    }
  | {
      kind: 'error';
      message: string;
    };

const parseApiErrorMessage = async (
  response: Response,
  fallbackMessage: string
): Promise<string> => {
  const payload = await response.text();

  if (payload.trim() === '') {
    return fallbackMessage;
  }

  try {
    const parsedPayload = JSON.parse(payload) as { error?: unknown };

    if (
      typeof parsedPayload.error === 'string' &&
      parsedPayload.error.trim() !== ''
    ) {
      return parsedPayload.error.trim();
    }
  } catch {
    return payload.trim() || fallbackMessage;
  }

  return fallbackMessage;
};

export const buildCreateUserPayload = (
  displayName: string
): CreateUserPayload | null => {
  const normalizedDisplayName = displayName.trim();

  if (normalizedDisplayName === '') {
    return null;
  }

  return {
    displayName: normalizedDisplayName
  };
};

export const isDeleteConfirmationValid = (value: string): boolean =>
  value.trim().toUpperCase() === DELETE_USER_CONFIRMATION_TOKEN;

export const resolveCreateUserResponse = async (
  response: Response
): Promise<CreateUserResult> => {
  if (response.status === 201) {
    try {
      const payload = await response.json();
      const employee = deserializeEmployee(payload);

      if (!employee) {
        return {
          kind: 'error',
          message: INVALID_EMPLOYEE_RESPONSE_ERROR
        };
      }

      return {
        kind: 'success',
        employee
      };
    } catch {
      return {
        kind: 'error',
        message: INVALID_EMPLOYEE_RESPONSE_ERROR
      };
    }
  }

  if (response.status === 500 || response.status === 502) {
    return {
      kind: 'error',
      message: CREATE_USER_GENERIC_ERROR
    };
  }

  return {
    kind: 'error',
    message: await parseApiErrorMessage(response, 'Failed to create user')
  };
};

export const resolveDeleteUserResponse = async (
  response: Response
): Promise<DeleteUserResult> => {
  if (response.status === 204 || response.status === 404) {
    return {
      kind: 'success'
    };
  }

  if (response.status === 500 || response.status === 502) {
    return {
      kind: 'error',
      message: DELETE_USER_GENERIC_ERROR
    };
  }

  if (response.ok) {
    return {
      kind: 'error',
      message: INVALID_EMPLOYEE_RESPONSE_ERROR
    };
  }

  return {
    kind: 'error',
    message: await parseApiErrorMessage(response, 'Failed to delete user')
  };
};
