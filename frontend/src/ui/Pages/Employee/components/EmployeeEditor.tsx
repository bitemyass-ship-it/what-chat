'use client';

import QRCode from 'qrcode';
import {
  startTransition,
  useEffect,
  useRef,
  useState,
  type FormEvent
} from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { handleUnauthorizedClientResponse } from '@/lib/client-auth';
import {
  deserializeEmployee,
  normalizeNullableText,
  type Employee
} from '@/lib/employee-record';
import {
  deserializeWhatsappSession,
  type WhatsappSession
} from '@/lib/whatsapp-session';
import EmployeeChatsPlaceholder from './EmployeeChatsPlaceholder';
import EmployeeHeader from './EmployeeHeader';
import EmployeeInfoForm from './EmployeeInfoForm';
import EmployeeReportExport from './EmployeeReportExport';
import EmployeeTabs, { type EmployeeTabId } from './EmployeeTabs';
import EmployeeWhatsappSessionModal from './EmployeeWhatsappSessionModal';

interface EmployeeEditorProps {
  initialEmployee: Employee;
}

type SessionControlMode = 'enable' | 'disable';

const SESSION_POLL_INTERVAL_MS = 1_500;
const POLLING_QR_TIMEOUT_MS = 2 * 60 * 1_000;
const POLLING_MAX_ERRORS = 5;

const parseErrorMessage = async (
  response: Response,
  fallbackMessage: string
): Promise<string> => {
  try {
    const payload = (await response.json()) as { error?: unknown };

    if (typeof payload.error === 'string' && payload.error.trim() !== '') {
      return payload.error;
    }
  } catch {
    return fallbackMessage;
  }

  return fallbackMessage;
};

export default function EmployeeEditor({ initialEmployee }: EmployeeEditorProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [employee, setEmployee] = useState(initialEmployee);
  const [displayName, setDisplayName] = useState(initialEmployee.displayName ?? '');
  const [phoneNumber, setPhoneNumber] = useState(initialEmployee.phoneNumber ?? '');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isStatusUpdating, setIsStatusUpdating] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [session, setSession] = useState<WhatsappSession | null>(null);
  const [isSessionStarting, setIsSessionStarting] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [qrImageUrl, setQrImageUrl] = useState<string | null>(null);
  const [isPollingSession, setIsPollingSession] = useState(false);
  const [pollAttempt, setPollAttempt] = useState(0);
  const pollingStartedAtRef = useRef<number | null>(null);
  const pollErrorCountRef = useRef<number>(0);

  const normalizedDisplayName = normalizeNullableText(displayName);
  const normalizedPhoneNumber = normalizeNullableText(phoneNumber);
  const activeTab: EmployeeTabId =
    searchParams.get('tab') === 'info'
      ? 'info'
      : 'chats';
  const hasPersistedPhoneNumber = employee.phoneNumber !== null;
  const hasChanges =
    normalizedDisplayName !== employee.displayName ||
    normalizedPhoneNumber !== employee.phoneNumber;
  const isWhatsappConnected = employee.isActive;
  const sessionControlMode: SessionControlMode = employee.isActive ? 'disable' : 'enable';
  const handleTabChange = (tab: EmployeeTabId) => {
    const nextSearchParams = new URLSearchParams(searchParams.toString());

    if (tab === 'chats') {
      nextSearchParams.delete('tab');

      if (!nextSearchParams.has('page')) {
        nextSearchParams.set('page', '1');
      }
    } else {
      nextSearchParams.set('tab', 'info');
      nextSearchParams.delete('page');
    }

    const nextHref = nextSearchParams.toString()
      ? `${pathname}?${nextSearchParams.toString()}`
      : pathname;

    router.push(nextHref, {
      scroll: false
    });
  };

  const shouldPollSession = (nextSession: WhatsappSession | null): boolean =>
    nextSession?.runtimeStatus === 'starting' ||
    nextSession?.runtimeStatus === 'waiting_for_qr';

  const createSessionSnapshot = (
    patch: Partial<WhatsappSession>
  ): WhatsappSession => ({
    employeeId: employee.code,
    hasRuntimeSession: false,
    whatsappActive: false,
    runtimeStatus: 'not_started',
    whatsappState: null,
    qrCode: null,
    lastError: null,
    lastDisconnectReason: null,
    lastEventAt: session?.lastEventAt ?? null,
    lastReadyAt: session?.lastReadyAt ?? null,
    lastCheckedAt: session?.lastCheckedAt ?? null,
    ...patch
  });

  const applySessionPayload = (
    nextSession: WhatsappSession,
    source:
      | 'initial'
      | 'toggle-enable'
      | 'toggle-disable'
      | 'poll'
  ): void => {
    setSession(nextSession);
    setIsPollingSession(shouldPollSession(nextSession));

    if (source === 'toggle-disable') {
      setIsSessionStarting(false);
      setIsQrModalOpen(false);
      return;
    }

    if (nextSession.runtimeStatus === 'ready') {
      setIsSessionStarting(false);
      setIsQrModalOpen(false);
      return;
    }

    if (nextSession.runtimeStatus === 'waiting_for_qr' && nextSession.qrCode) {
      setIsSessionStarting(false);
      return;
    }

    if (source === 'toggle-enable') {
      setIsQrModalOpen(true);
    }

    if (nextSession.runtimeStatus !== 'starting') {
      setIsSessionStarting(false);
    }
  };

  const requestSessionState = async (
    method: 'GET' | 'POST' = 'GET'
  ): Promise<WhatsappSession | null> => {
    const response = await fetch(
      `/api/employees/${encodeURIComponent(employee.code)}/whatsapp-session`,
      {
        method,
        cache: 'no-store'
      }
    );

    if (await handleUnauthorizedClientResponse(response, router)) {
      return null;
    }

    if (!response.ok) {
      throw new Error(
        await parseErrorMessage(
          response,
          method === 'POST'
            ? 'Failed to start WhatsApp session'
            : 'Failed to load WhatsApp session'
        )
      );
    }

    const payload = await response.json();
    const nextSession = deserializeWhatsappSession(payload);

    if (!nextSession) {
      throw new Error('WhatsApp session API returned invalid data');
    }

    return nextSession;
  };

  const requestEmployeeState = async (): Promise<Employee | null> => {
    const response = await fetch(
      `/api/employees/${encodeURIComponent(employee.code)}`,
      {
        cache: 'no-store'
      }
    );

    if (await handleUnauthorizedClientResponse(response, router)) {
      return null;
    }

    if (!response.ok) {
      throw new Error(
        await parseErrorMessage(response, 'Failed to load employee')
      );
    }

    const payload = await response.json();
    const nextEmployee = deserializeEmployee(payload);

    if (!nextEmployee) {
      throw new Error('Employee API returned invalid data');
    }

    return nextEmployee;
  };

  useEffect(() => {
    setSession(null);
    setSessionError(null);
    setStatusError(null);
    setIsSessionStarting(false);
    setIsPollingSession(false);
    setIsQrModalOpen(false);
    setQrImageUrl(null);
    pollingStartedAtRef.current = null;
    pollErrorCountRef.current = 0;
  }, [employee.code]);

  useEffect(() => {
    let isCancelled = false;

    if (!shouldPollSession(session)) {
      setIsPollingSession(false);
      pollingStartedAtRef.current = null;
      pollErrorCountRef.current = 0;
      return;
    }

    setIsPollingSession(true);

    if (pollingStartedAtRef.current === null) {
      pollingStartedAtRef.current = Date.now();
      pollErrorCountRef.current = 0;
    }

    const timeoutId = window.setTimeout(async () => {
      const timeoutReached =
        pollingStartedAtRef.current !== null &&
        Date.now() - pollingStartedAtRef.current >= POLLING_QR_TIMEOUT_MS;

      if (timeoutReached) {
        if (isCancelled) return;
        setSessionError('WhatsApp session did not start in time. Please try again.');
        setIsPollingSession(false);
        pollingStartedAtRef.current = null;
        pollErrorCountRef.current = 0;
        return;
      }

      try {
        const nextSession = await requestSessionState();

        if (isCancelled || !nextSession) {
          return;
        }

        setSessionError(null);
        applySessionPayload(nextSession, 'poll');
      } catch (pollError) {
        if (isCancelled) return;

        pollErrorCountRef.current += 1;

        if (pollErrorCountRef.current > POLLING_MAX_ERRORS) {
          setSessionError(
            pollError instanceof Error
              ? pollError.message
              : 'Failed to load WhatsApp session'
          );
          setIsPollingSession(false);
          pollingStartedAtRef.current = null;
          pollErrorCountRef.current = 0;
        } else {
          setPollAttempt((prev: number) => prev + 1);
        }
      }
    }, SESSION_POLL_INTERVAL_MS);

    return () => {
      isCancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [employee.code, session, pollAttempt]);

  useEffect(() => {
    let isCancelled = false;
    let retryTimeoutId: number | null = null;

    if (session?.runtimeStatus !== 'ready' || employee.isActive) {
      return;
    }

    const refreshEmployeeUntilActive = async () => {
      try {
        const nextEmployee = await requestEmployeeState();

        if (isCancelled || !nextEmployee) {
          return;
        }

        setEmployee(nextEmployee);

        if (nextEmployee.isActive) {
          startTransition(() => {
            router.refresh();
          });
          return;
        }
      } catch {
        if (isCancelled) {
          return;
        }
      }

      if (!isCancelled) {
        retryTimeoutId = window.setTimeout(
          refreshEmployeeUntilActive,
          SESSION_POLL_INTERVAL_MS
        );
      }
    };

    void refreshEmployeeUntilActive();

    return () => {
      isCancelled = true;
      if (retryTimeoutId !== null) {
        window.clearTimeout(retryTimeoutId);
      }
    };
  }, [employee.code, employee.isActive, router, session?.runtimeStatus]);

  useEffect(() => {
    let isCancelled = false;

    if (!session?.qrCode) {
      setQrImageUrl(null);
      return;
    }

    const rawQrCode = session.qrCode;

    const renderQrCode = async () => {
      try {
        const nextQrImageUrl = await QRCode.toDataURL(rawQrCode, {
          margin: 1,
          width: 320
        });

        if (!isCancelled) {
          setQrImageUrl(nextQrImageUrl);
        }
      } catch {
        if (!isCancelled) {
          setQrImageUrl(null);
          setSessionError((currentError) => currentError ?? 'Unable to render WhatsApp QR code');
        }
      }
    };

    void renderQrCode();

    return () => {
      isCancelled = true;
    };
  }, [session?.qrCode]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!hasChanges || isSaving) {
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(
        `/api/employees/${encodeURIComponent(employee.code)}`,
        {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            displayName: normalizedDisplayName,
            phoneNumber: normalizedPhoneNumber
          })
        }
      );

      if (await handleUnauthorizedClientResponse(response, router)) {
        return;
      }

      if (!response.ok) {
        setError(await parseErrorMessage(response, 'Failed to update employee'));
        return;
      }

      const payload = await response.json();
      const updatedEmployee = deserializeEmployee(payload);

      if (!updatedEmployee) {
        setError('Employee API returned invalid data');
        return;
      }

      const didPhoneNumberChange = updatedEmployee.phoneNumber !== employee.phoneNumber;

      setEmployee(updatedEmployee);
      setDisplayName(updatedEmployee.displayName ?? '');
      setPhoneNumber(updatedEmployee.phoneNumber ?? '');
      setSuccess('Employee updated');

      if (didPhoneNumberChange) {
        setSessionError(null);
        setIsSessionStarting(false);
        setIsQrModalOpen(false);
        setIsPollingSession(false);
        setQrImageUrl(null);
        setSession(null);
        pollingStartedAtRef.current = null;
        pollErrorCountRef.current = 0;
      }

      startTransition(() => {
        router.refresh();
      });
    } catch {
      setError('Unable to reach employee API');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleEmployeeStatus = async () => {
    if (isStatusUpdating || isSessionStarting) {
      return;
    }

    if (sessionControlMode === 'enable') {
      setIsSessionStarting(true);
      setStatusError(null);
      setSessionError(null);
      setSuccess(null);
      setIsQrModalOpen(true);

      try {
        const nextSession = await requestSessionState('POST');
        if (!nextSession) {
          return;
        }
        setSessionError(null);
        applySessionPayload(nextSession, 'toggle-enable');
        void requestEmployeeState()
          .then((nextEmployee) => {
            if (nextEmployee) {
              setEmployee(nextEmployee);
            }
          })
          .catch(() => undefined);
      } catch (startError) {
        const message =
          startError instanceof Error
            ? startError.message
            : 'Failed to start WhatsApp session';

        setStatusError(message);
        setSessionError(message);
        setIsQrModalOpen(false);
      } finally {
        setIsSessionStarting(false);
      }

      return;
    }

    const nextIsActive = false;

    setIsStatusUpdating(true);
    setStatusError(null);
    setSessionError(null);
    setSuccess(null);

    try {
      const response = await fetch(
        `/api/employees/${encodeURIComponent(employee.code)}`,
        {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            isActive: nextIsActive
          })
        }
      );

      if (await handleUnauthorizedClientResponse(response, router)) {
        return;
      }

      if (!response.ok) {
        setStatusError(
          await parseErrorMessage(
            response,
            nextIsActive ? 'Failed to enable employee' : 'Failed to disable employee'
          )
        );
        return;
      }

      const payload = await response.json();
      const updatedEmployee = deserializeEmployee(payload);

      if (!updatedEmployee) {
        setStatusError('Employee API returned invalid data');
        return;
      }

      setEmployee(updatedEmployee);
      setIsSessionStarting(false);
      setIsPollingSession(false);
      setIsQrModalOpen(false);
      setQrImageUrl(null);
      setSession(
        createSessionSnapshot({
          runtimeStatus: 'stopped'
        })
      );
      setSessionError(null);
      pollingStartedAtRef.current = null;
      pollErrorCountRef.current = 0;
    } catch {
      setStatusError(
        nextIsActive ? 'Unable to enable employee' : 'Unable to disable employee'
      );
    } finally {
      setIsStatusUpdating(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <EmployeeHeader employee={employee} isActive={employee.isActive} />
      <EmployeeTabs activeTab={activeTab} onTabChange={handleTabChange} />
      {activeTab === 'info' ? (
        <>
          <EmployeeInfoForm
            displayName={displayName}
            employee={employee}
            error={error}
            hasPersistedPhoneNumber={hasPersistedPhoneNumber}
            hasChanges={hasChanges}
            isSaving={isSaving}
            isSessionStarting={isSessionStarting}
            isStatusUpdating={isStatusUpdating}
            onDisplayNameChange={setDisplayName}
            onPhoneNumberChange={setPhoneNumber}
            onStatusToggle={handleToggleEmployeeStatus}
            onSubmit={handleSubmit}
            phoneNumber={phoneNumber}
            sessionControlMode={sessionControlMode}
            statusError={statusError}
            success={success}
          />
          <EmployeeReportExport employeeCode={employee.code} />
        </>
      ) : (
        <EmployeeChatsPlaceholder
          employeeCode={employee.code}
          isWhatsappConnected={isWhatsappConnected}
        />
      )}
      <EmployeeWhatsappSessionModal
        isEmployeeActive={employee.isActive}
        isOpen={isQrModalOpen}
        isPollingSession={isPollingSession}
        isSessionStarting={isSessionStarting}
        onClose={() => setIsQrModalOpen(false)}
        qrImageUrl={qrImageUrl}
        session={session}
        sessionError={sessionError}
      />
    </div>
  );
}
