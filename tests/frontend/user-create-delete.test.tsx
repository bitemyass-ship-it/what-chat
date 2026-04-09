import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import type { Employee } from '../../frontend/src/lib/employees';
import CreateUserModal from '../../frontend/src/ui/Pages/Home/components/CreateUserModal';
import DeleteUserModal from '../../frontend/src/ui/Pages/Home/components/DeleteUserModal';
import UserTable from '../../frontend/src/ui/Pages/Home/components/UserTable';
import {
  buildCreateUserPayload,
  CREATE_USER_GENERIC_ERROR,
  DELETE_USER_GENERIC_ERROR,
  INVALID_EMPLOYEE_RESPONSE_ERROR,
  isDeleteConfirmationValid,
  resolveCreateUserResponse,
  resolveDeleteUserResponse
} from '../../frontend/src/ui/Pages/Home/components/user-actions';

const pushMock = jest.fn();
const refreshMock = jest.fn();

jest.mock('next/link', () => {
  const React = require('react') as typeof import('react');

  return {
    __esModule: true,
    default: ({
      children,
      href,
      ...props
    }: {
      children: ReactNode;
      href: string;
    }) => React.createElement('a', { href, ...props }, children)
  };
});

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock
  })
}));

const employee: Employee = {
  id: 1,
  code: 'anna',
  displayName: 'Anna Petrova',
  phoneNumber: null,
  isActive: false,
  sessionDir: null,
  createdAt: '2026-03-31T10:00:00Z',
  createdAtLabel: '31 Mar 2026',
  updatedAt: '2026-03-31T10:00:00Z'
};

describe('home dashboard create/delete flow', () => {
  beforeEach(() => {
    pushMock.mockReset();
    refreshMock.mockReset();
  });

  it('should render a visible Create user action on the main table', () => {
    const markup = renderToStaticMarkup(
      <UserTable employees={[employee]} error={null} warning={null} />
    );

    expect(markup).toContain('Create user');
  });

  it('should keep the create action visible in the empty state', () => {
    const markup = renderToStaticMarkup(
      <UserTable employees={[]} error={null} warning={null} />
    );

    expect(markup).toContain('No users yet.');
    expect(markup).toContain('Create user');
  });

  it('should render a dedicated delete action column and accessible row action', () => {
    const markup = renderToStaticMarkup(
      <UserTable employees={[employee]} error={null} warning={null} />
    );

    expect(markup).toContain('Actions');
    expect(markup).toContain('aria-label="Delete user Anna Petrova"');
    expect(markup).toContain('href="/employees/anna"');
  });

  it('should render the create modal with only the Name field', () => {
    const markup = renderToStaticMarkup(
      <CreateUserModal
        displayName=""
        error={null}
        isOpen
        isSubmitting={false}
        onClose={() => undefined}
        onDisplayNameChange={() => undefined}
        onSubmit={() => undefined}
      />
    );

    expect(markup).toContain('Create user');
    expect(markup).toContain('>Name<');
    expect(markup).toContain('name="displayName"');
    expect(markup).not.toContain('name="code"');
  });

  it('should render the destructive delete modal copy and locked confirmation state', () => {
    const markup = renderToStaticMarkup(
      <DeleteUserModal
        confirmationValue="nope"
        employee={employee}
        error={null}
        isOpen
        isSubmitting={false}
        onClose={() => undefined}
        onConfirmationChange={() => undefined}
        onSubmit={() => undefined}
      />
    );

    expect(markup).toContain('Deletion is irreversible.');
    expect(markup).toContain('related chats');
    expect(markup).toContain('stored WhatsApp session data');
    expect(markup).toContain('Anna Petrova');
    expect(markup).toContain('anna');
    expect(markup).toContain('disabled=""');
  });
});

describe('home dashboard create/delete helpers', () => {
  it('should build a create payload with only trimmed displayName', () => {
    expect(buildCreateUserPayload('  Anna Petrova  ')).toEqual({
      displayName: 'Anna Petrova'
    });
    expect(Object.keys(buildCreateUserPayload('  Anna Petrova  ') ?? {})).toEqual([
      'displayName'
    ]);
    expect(buildCreateUserPayload('   ')).toBeNull();
  });

  it('should accept DELETE confirmation in any letter case', () => {
    expect(isDeleteConfirmationValid('DELETE')).toBe(true);
    expect(isDeleteConfirmationValid('delete')).toBe(true);
    expect(isDeleteConfirmationValid('Delete')).toBe(true);
    expect(isDeleteConfirmationValid('  DELETE  ')).toBe(true);
    expect(isDeleteConfirmationValid('DELETE NOW')).toBe(false);
  });

  it('should resolve create success only for a valid employee payload', async () => {
    await expect(
      resolveCreateUserResponse(
        new Response(JSON.stringify(employee), {
          status: 201,
          headers: {
            'content-type': 'application/json'
          }
        })
      )
    ).resolves.toEqual({
      kind: 'success',
      employee: expect.objectContaining({
        code: 'anna'
      })
    });

    await expect(
      resolveCreateUserResponse(
        new Response(JSON.stringify({ id: 'broken' }), {
          status: 201,
          headers: {
            'content-type': 'application/json'
          }
        })
      )
    ).resolves.toEqual({
      kind: 'error',
      message: INVALID_EMPLOYEE_RESPONSE_ERROR
    });
  });

  it('should keep backend create validation text and generic proxy failures stable', async () => {
    await expect(
      resolveCreateUserResponse(
        new Response(JSON.stringify({ error: 'displayName must not be empty' }), {
          status: 400,
          headers: {
            'content-type': 'application/json'
          }
        })
      )
    ).resolves.toEqual({
      kind: 'error',
      message: 'displayName must not be empty'
    });

    await expect(
      resolveCreateUserResponse(
        new Response(JSON.stringify({ error: 'internal detail' }), {
          status: 502,
          headers: {
            'content-type': 'application/json'
          }
        })
      )
    ).resolves.toEqual({
      kind: 'error',
      message: CREATE_USER_GENERIC_ERROR
    });
  });

  it('should refresh on delete 204/404 and keep generic errors stable on failures', async () => {
    await expect(
      resolveDeleteUserResponse(
        new Response(null, {
          status: 204
        })
      )
    ).resolves.toEqual({
      kind: 'success'
    });

    await expect(
      resolveDeleteUserResponse(
        new Response(JSON.stringify({ error: 'Employee not found: anna' }), {
          status: 404,
          headers: {
            'content-type': 'application/json'
          }
        })
      )
    ).resolves.toEqual({
      kind: 'success'
    });

    await expect(
      resolveDeleteUserResponse(
        new Response(JSON.stringify({ error: 'Failed to delete employee' }), {
          status: 500,
          headers: {
            'content-type': 'application/json'
          }
        })
      )
    ).resolves.toEqual({
      kind: 'error',
      message: DELETE_USER_GENERIC_ERROR
    });
  });

  it('should reject unexpected delete success payloads as a contract error', async () => {
    await expect(
      resolveDeleteUserResponse(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        })
      )
    ).resolves.toEqual({
      kind: 'error',
      message: INVALID_EMPLOYEE_RESPONSE_ERROR
    });
  });
});
