# Frontend Specification: QR Polling Timeout And Error Tolerance

## 1. Goal

When a user opens the WhatsApp connection modal for an employee, the frontend polls the backend for session status. Polling must be resilient to transient backend errors and must not run indefinitely.

After this change, polling must stop in exactly three cases:

1. **QR received** — `runtimeStatus` becomes `waiting_for_qr` → show QR code in the modal
2. **Error limit** — more than 5 errors have accumulated since polling started → show error in the modal
3. **Timeout** — 2 minutes have elapsed since polling started without a QR arriving → show a timeout error in the modal

## 2. Product Decision

### 2.1 Polling resolves to exactly one of two outcomes

When polling stops, the modal is in one of two states:

- **Success** — QR code is displayed, user can scan
- **Error** — an error message is displayed, user can retry

There is no intermediate "still polling" displayed state after a stopping condition is reached.

### 2.2 Errors are accumulated, not reset

The error counter increments on every error and is never reset during a polling session.

Reason: the session startup either works or it doesn't within the allowed window. A recovery after several errors does not retroactively make those errors less significant.

Do not reset the error counter on a successful poll response.

### 2.3 Two distinct error messages

The error displayed depends on which stopping condition was reached:

- Error limit exceeded → show the last received error message (or a generic fallback)
- Timeout → show a fixed timeout message: `'WhatsApp session did not start in time. Please try again.'`

### 2.4 Polling must continue through errors below the limit

Do not stop or show an error for individual errors that have not yet reached the limit.

## 3. Scope

In scope:

- frontend polling loop in `EmployeeEditor.tsx`
- timeout logic (2-minute hard limit without QR)
- error counter logic (> 5 accumulated errors)
- conditional error display in the modal

Out of scope:

- backend changes
- increasing or decreasing `SESSION_POLL_INTERVAL_MS`
- changes to any other polling flow in the project

## 4. Current State

Current behavior in `frontend/src/ui/Pages/Employee/components/EmployeeEditor.tsx`:

- polling runs every `SESSION_POLL_INTERVAL_MS` (1 500 ms) while `runtimeStatus` is `'starting'` or `'waiting_for_qr'`
- on the first error from `requestSessionState`, polling stops and the error is shown immediately
- there is no timeout for the case where QR does not arrive
- there is no error accumulation — every single error stops the session

Result: a single transient backend error interrupts the flow. There is also no safeguard for a session that never delivers a QR code.

## 5. Requirements

### 5.1 Constants

```ts
const POLLING_QR_TIMEOUT_MS = 2 * 60 * 1_000;  // 120 000 ms
const POLLING_MAX_ERRORS    = 5;
```

### 5.2 Tracked state (refs)

```ts
const pollingStartedAtRef = useRef<number | null>(null);  // when polling began
const pollErrorCountRef   = useRef<number>(0);            // total errors since polling started
```

Use `useRef` so values persist across re-renders without triggering them.

### 5.3 Initializing the refs

When the polling `useEffect` determines that polling should start, initialize the refs once:

```ts
if (pollingStartedAtRef.current === null) {
  pollingStartedAtRef.current = Date.now();
  pollErrorCountRef.current   = 0;
}
```

### 5.4 Resetting the refs

Reset both refs whenever polling stops for any reason:

```ts
pollingStartedAtRef.current = null;
pollErrorCountRef.current   = 0;
```

This covers all three stopping conditions and component unmount.

### 5.5 Timeout check

At the start of each poll tick (before calling `requestSessionState`), check whether the timeout has elapsed:

```ts
const timeoutReached =
  pollingStartedAtRef.current !== null &&
  Date.now() - pollingStartedAtRef.current >= POLLING_QR_TIMEOUT_MS;

if (timeoutReached) {
  setSessionError('WhatsApp session did not start in time. Please try again.');
  setIsPollingSession(false);
  // reset refs
  return;
}
```

### 5.6 Error accumulation and limit

When an error is caught inside the polling loop:

```ts
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
    // reset refs
  }
  // below the limit: suppress, polling continues on next tick
}
```

### 5.7 QR received

When `requestSessionState` returns a session with `runtimeStatus === 'waiting_for_qr'`, the existing `applySessionPayload` call already stops polling and renders the QR code. No change required for this path.

## 6. Behavior Table

| Scenario | Result |
| --- | --- |
| Successful response, QR not yet arrived, within timeout | Continue polling |
| Successful response, `runtimeStatus === 'waiting_for_qr'` | Stop polling, show QR in modal |
| Error, total accumulated errors ≤ 5 | Suppress error, continue polling |
| Error, total accumulated errors > 5 | Show error in modal, stop polling |
| 2 minutes elapsed at start of a tick | Show timeout error in modal, stop polling |
| Component unmounts | Cancel callbacks, reset refs |

## 7. Changes Required

### 7.1 `EmployeeEditor.tsx`

1. Add constants near the top of the file:
   ```ts
   const POLLING_QR_TIMEOUT_MS = 2 * 60 * 1_000;
   const POLLING_MAX_ERRORS    = 5;
   ```

2. Add refs inside the component:
   ```ts
   const pollingStartedAtRef = useRef<number | null>(null);
   const pollErrorCountRef   = useRef<number>(0);
   ```

3. In the polling `useEffect`, initialize refs once when polling starts:
   ```ts
   if (pollingStartedAtRef.current === null) {
     pollingStartedAtRef.current = Date.now();
     pollErrorCountRef.current   = 0;
   }
   ```

4. At the beginning of the `setTimeout` callback, check for timeout before making the request:
   ```ts
   const timeoutReached =
     pollingStartedAtRef.current !== null &&
     Date.now() - pollingStartedAtRef.current >= POLLING_QR_TIMEOUT_MS;

   if (timeoutReached) {
     setSessionError('WhatsApp session did not start in time. Please try again.');
     setIsPollingSession(false);
     pollingStartedAtRef.current = null;
     pollErrorCountRef.current   = 0;
     return;
   }
   ```

5. Replace the existing `catch` block with error-counter logic:
   ```ts
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
       pollErrorCountRef.current   = 0;
     }
   }
   ```

6. Wherever polling stops normally (session becomes `ready`, `shouldPollSession` returns false), also reset refs:
   ```ts
   pollingStartedAtRef.current = null;
   pollErrorCountRef.current   = 0;
   ```

## 8. Error Handling And Fallback Rules

### 8.1 Polling continuation after suppressed error

The polling loop is driven by the `useEffect` dependency array. After a suppressed error the session state has not changed, so the effect may not re-trigger automatically.

If a `pollAttempt` counter or equivalent forcing mechanism is not already in place, one must be added to ensure the effect re-runs after each tick regardless of session state changes.

### 8.2 Component unmount

`isCancelled` must be checked before all stateful updates. This is already in place and must not be removed.

## 9. Testing Requirements

### 9.1 Errors below the limit

- 5 consecutive errors must not call `setSessionError`
- polling must continue after each of the 5 suppressed errors

### 9.2 Error limit reached

- the 6th error must call `setSessionError` with the error message
- polling must stop after the 6th error

### 9.3 No error counter reset on success

- after 4 errors, a successful response must not reset the counter
- the 5th subsequent error must still be suppressed (counter = 5, not > 5)
- the 6th subsequent error (counter = 6) must stop polling

### 9.4 Timeout without QR

- after 2 minutes of polling with no `waiting_for_qr` status, polling must stop with the fixed timeout message

### 9.5 QR received before timeout

- if `runtimeStatus` becomes `waiting_for_qr` before 2 minutes, polling stops with the QR shown — no error

### 9.6 Refs reset on restart

- when polling stops and restarts, both refs must be initialized fresh

### 9.7 Component unmount

- unmounting during active polling must not produce React state update warnings

## 10. Acceptance Criteria

The task is complete when all of the following are true.

1. When QR code arrives, polling stops and QR is shown in the modal.
2. Up to 5 accumulated errors are silently suppressed and polling continues.
3. On the 6th accumulated error, polling stops and the error message is shown in the modal.
4. The error counter is never reset during a polling session — errors always accumulate.
5. If 2 minutes pass without a QR code arriving, polling stops and the timeout message is shown in the modal.
6. Both the timeout timer and error counter reset when polling stops and later restarts.
7. Component unmount cancels all pending poll callbacks without errors.
