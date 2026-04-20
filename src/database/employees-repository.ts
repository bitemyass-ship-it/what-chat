import type { DatabaseSync } from 'node:sqlite';
import type {
  CreateEmployeeInput,
  EmployeeRecord,
  EmployeesRepository,
  UpsertEmployeeInput
} from './types';

interface EmployeeRow {
  id: number;
  code: string;
  display_name: string | null;
  phone_number: string | null;
  is_active: number;
  session_dir: string | null;
  created_at: string;
  updated_at: string;
}

const EMPLOYEE_SELECT_COLUMNS = `
  id,
  code,
  display_name,
  phone_number,
  is_active,
  session_dir,
  created_at,
  updated_at
`;

const mapEmployeeRow = (row: EmployeeRow): EmployeeRecord => ({
  id: row.id,
  code: row.code,
  displayName: row.display_name,
  phoneNumber: row.phone_number,
  isActive: row.is_active === 1,
  sessionDir: row.session_dir,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const asEmployeeRow = (row: unknown): EmployeeRow => row as EmployeeRow;

const normalizeCode = (code: string): string => {
  const normalizedCode = code.trim();

  if (normalizedCode === '') {
    throw new Error('Employee code is required');
  }

  return normalizedCode;
};

const normalizeNullableText = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalizedValue = value.trim();
  return normalizedValue === '' ? null : normalizedValue;
};

export const createEmployeesRepository = (
  database: DatabaseSync
): EmployeesRepository => {
  const countStatement = database.prepare(
    'SELECT COUNT(*) AS total FROM employees'
  );
  const findByCodeStatement = database.prepare(`
    SELECT ${EMPLOYEE_SELECT_COLUMNS}
    FROM employees
    WHERE code = ?
  `);
  const deleteByCodeStatement = database.prepare(`
    DELETE FROM employees
    WHERE code = ?
  `);
  const listActiveStatement = database.prepare(`
    SELECT ${EMPLOYEE_SELECT_COLUMNS}
    FROM employees
    WHERE is_active = 1
    ORDER BY code ASC
  `);
  const listAllStatement = database.prepare(`
    SELECT ${EMPLOYEE_SELECT_COLUMNS}
    FROM employees
    ORDER BY code ASC
  `);
  const createStatement = database.prepare(`
    INSERT INTO employees (
      code,
      display_name,
      phone_number,
      is_active,
      session_dir
    )
    VALUES (?, ?, ?, ?, ?)
  `);
  const upsertStatement = database.prepare(`
    INSERT INTO employees (
      code,
      display_name,
      phone_number,
      is_active,
      session_dir
    )
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      display_name = excluded.display_name,
      phone_number = excluded.phone_number,
      is_active = excluded.is_active,
      session_dir = excluded.session_dir,
      updated_at = CURRENT_TIMESTAMP
  `);
  const findByCode = (code: string): EmployeeRecord | undefined => {
    const row = findByCodeStatement.get(normalizeCode(code));
    return row ? mapEmployeeRow(asEmployeeRow(row)) : undefined;
  };

  return {
    count(): number {
      const result = countStatement.get() as { total: number };
      return result.total;
    },

    create(input: CreateEmployeeInput): EmployeeRecord {
      const code = normalizeCode(input.code);
      const displayName = normalizeNullableText(input.displayName);
      const phoneNumber = normalizeNullableText(input.phoneNumber);
      const sessionDir = normalizeNullableText(input.sessionDir);
      const isActive = input.isActive ?? true;

      createStatement.run(code, displayName, phoneNumber, isActive ? 1 : 0, sessionDir);

      const employee = findByCode(code);

      if (!employee) {
        throw new Error(`Unable to load created employee: ${code}`);
      }

      return employee;
    },

    deleteByCode(code: string): boolean {
      const result = deleteByCodeStatement.run(normalizeCode(code)) as { changes: number };
      return result.changes > 0;
    },

    findByCode,

    listActive(): EmployeeRecord[] {
      return listActiveStatement.all().map((row) => mapEmployeeRow(asEmployeeRow(row)));
    },

    listAll(): EmployeeRecord[] {
      return listAllStatement.all().map((row) => mapEmployeeRow(asEmployeeRow(row)));
    },

    upsert(input: UpsertEmployeeInput): EmployeeRecord {
      const code = normalizeCode(input.code);
      const existingEmployee = findByCode(code);
      const displayName =
        input.displayName === undefined
          ? existingEmployee?.displayName ?? null
          : normalizeNullableText(input.displayName);
      const phoneNumber =
        input.phoneNumber === undefined
          ? existingEmployee?.phoneNumber ?? null
          : normalizeNullableText(input.phoneNumber);
      const sessionDir =
        input.sessionDir === undefined
          ? existingEmployee?.sessionDir ?? null
          : normalizeNullableText(input.sessionDir);
      const isActive = input.isActive ?? existingEmployee?.isActive ?? true;

      upsertStatement.run(code, displayName, phoneNumber, isActive ? 1 : 0, sessionDir);

      const employee = findByCode(code);

      if (!employee) {
        throw new Error(`Unable to load upserted employee: ${code}`);
      }

      return employee;
    }
  };
};
