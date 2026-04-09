export interface Employee {
  id: number;
  code: string;
  displayName: string | null;
  phoneNumber: string | null;
  isActive: boolean;
  sessionDir: string | null;
  createdAt: string | null;
  createdAtLabel: string;
  updatedAt: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const normalizeNullableText = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalizedValue = value.trim();
  return normalizedValue === '' ? null : normalizedValue;
};

export const parseEmployeeTimestamp = (value: string | null): Date | null => {
  if (!value) {
    return null;
  }

  const normalizedValue = value.trim();

  if (normalizedValue === '') {
    return null;
  }

  let candidate = normalizedValue;

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(normalizedValue)) {
    candidate = `${normalizedValue.replace(' ', 'T')}Z`;
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/u.test(normalizedValue)) {
    candidate = `${normalizedValue}Z`;
  }

  const parsedDate = new Date(candidate);

  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return parsedDate;
};

export const formatEmployeeDate = (value: string | null): string => {
  const parsedDate = parseEmployeeTimestamp(value);

  if (!parsedDate) {
    return 'Unknown date';
  }

  return new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    timeZone: 'UTC'
  }).format(parsedDate);
};

export const deserializeEmployee = (value: unknown): Employee | null => {
  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.id !== 'number' || !Number.isFinite(value.id)) {
    return null;
  }

  if (typeof value.code !== 'string' || value.code.trim() === '') {
    return null;
  }

  if (typeof value.isActive !== 'boolean') {
    return null;
  }

  const createdAt = normalizeNullableText(value.createdAt);
  const updatedAt = normalizeNullableText(value.updatedAt);

  return {
    id: value.id,
    code: value.code.trim(),
    displayName: normalizeNullableText(value.displayName),
    phoneNumber: normalizeNullableText(value.phoneNumber),
    isActive: value.isActive,
    sessionDir: normalizeNullableText(value.sessionDir),
    createdAt,
    createdAtLabel: formatEmployeeDate(createdAt),
    updatedAt
  };
};
