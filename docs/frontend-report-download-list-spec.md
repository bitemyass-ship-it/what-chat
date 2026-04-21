# Frontend Specification: Employee Report Download & List

## 1. Goal

Extend the existing "Monthly report" section on the employee info tab to show available reports and allow the user to download them.

After implementation the section must:

1. show a list of previously generated CSV reports for the current employee
2. let the user download any listed report by clicking on it
3. keep the existing "Generate report" button and export flow untouched
4. refresh the report list automatically after a successful export
5. handle loading, empty, and error states gracefully

This spec covers only the download/list UI and its supporting API routes. Report generation via POST is already implemented and described in `docs/backend-report-export-post-spec.md`.

## 2. Scope

In scope:

- Next.js API route `GET /api/reports` (proxy to backend `GET /reports`)
- Next.js API route `GET /api/reports/[employeeCode]/[period]` (proxy to backend download endpoint)
- changes to `EmployeeReportExport` component to display the report list
- client-side download trigger via `fetch` + Blob
- loading, empty, and error states for the list
- loading state per-item during download
- list refresh after successful export
- auth handling consistent with existing patterns

Out of scope:

- backend changes (backend endpoints already exist)
- report generation flow changes
- report deletion
- pagination or filtering controls (the list is small enough to show in full)
- drag-and-drop or multi-select download
- progress bars for download

## 3. Existing Context

### 3.1 Component location

The "Monthly report" section lives in:

```text
frontend/src/ui/Pages/Employee/components/EmployeeReportExport.tsx
```

It is rendered inside the info tab of the employee page:

```text
frontend/src/ui/Pages/Employee/components/EmployeeEditor.tsx
```

at line 598:

```tsx
<EmployeeReportExport employeeCode={employee.code} />
```

### 3.2 Current section layout

```text
[Monthly report]                         ← section card
  Title: "Monthly report"
  Description text
  [Inner card: period label + "Generate report" button]
  [Error / Success messages]
```

### 3.3 Backend contract

Backend already exposes:

| Endpoint | Method | Returns |
|---|---|---|
| `/reports` | GET | JSON array of `{ employeeCode, period, fileName, downloadUrl }` |
| `/reports/:employeeCode/:period` | GET | CSV file bytes with `Content-Type: text/csv` and `Content-Disposition: attachment` |

Both endpoints are protected by the `X-User-Password` header.

### 3.4 Existing frontend patterns

- API calls from client components go through Next.js API routes under `src/app/api/`
- Next.js routes proxy to the backend via `proxyProtectedEmployeeApiRequest` from `src/app/api/employees/proxy.ts`
- Auth is cookie-based (`wm_auth_password`); the proxy reads the cookie and forwards it as the `X-User-Password` header
- 401 responses are handled via `handleUnauthorizedClientResponse` which redirects to login
- Styling uses Tailwind CSS with the project's custom theme (no external UI library)

## 4. New Next.js API Routes

### 4.1 List reports route

Create:

```text
frontend/src/app/api/reports/route.ts
```

Handler:

```text
GET /api/reports
```

Flow:

1. read auth cookie from request
2. proxy to backend `GET /reports` via `fetchAuthenticatedBackend`
3. forward the JSON response and status as-is

Use the existing `proxyProtectedEmployeeApiRequest` helper with method `GET`. No request body forwarding is needed.

If backend returns non-OK status, forward the status and body unchanged.

### 4.2 Download report route

Extend:

```text
frontend/src/app/api/reports/[employeeCode]/[period]/route.ts
```

Add a `GET` handler alongside the existing `POST` handler.

Handler:

```text
GET /api/reports/:employeeCode/:period
```

Flow:

1. read auth cookie from request
2. call backend `GET /reports/{employeeCode}/{period}` via `fetchAuthenticatedBackend`
3. if backend returns non-OK, forward the status and JSON error body as-is
4. if backend returns 200, build a `NextResponse` that preserves:
   - response body as raw bytes (use `arrayBuffer()`, not `text()`, to preserve BOM and encoding)
   - `Content-Type` from backend (`text/csv; charset=utf-8`)
   - `Content-Disposition` from backend (`attachment; filename="..."`)
   - `Content-Length` from backend if present

The existing `buildProxyResponse` helper reads the body as text and only forwards `Content-Type`. For the download route, build the response manually in the route handler to avoid encoding issues and to forward download headers.

Example response construction:

```ts
const buffer = await backendResponse.arrayBuffer();

return new NextResponse(buffer, {
  status: backendResponse.status,
  headers: {
    'content-type': backendResponse.headers.get('content-type') ?? 'application/octet-stream',
    'content-disposition': backendResponse.headers.get('content-disposition') ?? 'attachment',
    ...(backendResponse.headers.has('content-length')
      ? { 'content-length': backendResponse.headers.get('content-length')! }
      : {})
  }
});
```

## 5. Component Changes

### 5.1 Updated section layout

```text
[Monthly report]                         ← section card (existing)
  Title: "Monthly report"               ← unchanged
  Description text                       ← unchanged
  [Inner card: period + Generate]        ← unchanged
  [Error / Success messages]             ← unchanged
  [Available reports list]               ← NEW
```

The available reports list is rendered below the existing content, inside the same section card. It appears only when there is at least one report or while the list is loading.

### 5.2 Report list states

**Loading:**

While the list is being fetched, show a short text indicator:

```text
Loading reports...
```

Styled as `text-sm text-slate-500`. No spinner needed. The text appears in place of the report list.

**Empty:**

If the backend returns an empty array (no reports for this employee), do not render the list area at all. The section looks exactly like the current implementation.

**Error:**

If the list request fails, show an error message below the existing content:

```text
Unable to load available reports
```

Styled consistently with existing error messages: `rounded-[1.25rem] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800`.

If the request returns 401, redirect to login via `handleUnauthorizedClientResponse` (existing pattern).

**Success:**

Render the list of reports as described in section 5.3.

### 5.3 Report list UI

The list is introduced by a small heading to visually separate it from the generate area:

```text
Available reports
```

Styled as: `text-sm font-medium text-slatewarm-950`.

Below the heading, render each report as a row inside a bordered container. Container styling:

```text
rounded-[1.4rem] border border-stone-200 bg-stone-50/80
```

This matches the existing inner-card pattern used in `EmployeeInfoForm` (employee availability card) and the generate-report card in the current component.

Each report row:

```text
[File icon]  anna-202604.csv  ·  April 2026          [Download button]
```

| Element | Description |
|---|---|
| File icon | Inline SVG document icon, `text-slate-400`, 16x16. |
| File name | `fileName` from backend response. `text-sm font-medium text-slatewarm-950`. |
| Period label | Human-readable period derived from `period` field using existing `formatPeriodLabel`. `text-sm text-slate-500`. Separated from file name by a middle dot (`·`). |
| Download button | Text button labeled "Download". `text-sm font-medium text-slatewarm-950 underline underline-offset-2 hover:text-slate-600 transition-colors duration-200`. Changes to "Downloading..." and becomes disabled while the download is in progress. |

Rows are separated by `border-t border-stone-200` (first row has no top border).

If only one report exists, the container shows a single row with no dividers.

### 5.4 Sorting

The backend already returns reports sorted by `employeeCode ASC`, `period DESC`, `fileName ASC`. After filtering to the current employee, the frontend preserves the backend order. This means the newest report appears first.

### 5.5 Download flow

When the user clicks "Download" on a report row:

1. set download-in-progress state for that specific report item (button shows "Downloading...", disabled)
2. `fetch` the Next.js download API route:

```ts
const response = await fetch(
  `/api/reports/${encodeURIComponent(employeeCode)}/${encodeURIComponent(period)}`
);
```

3. if 401 — redirect to login via `handleUnauthorizedClientResponse`
4. if non-OK — show an error message in the section error area:
   - try to parse `{ error }` from JSON body
   - fall back to `"Failed to download report"`
5. if OK:
   - read response as blob: `const blob = await response.blob()`
   - create object URL: `const url = URL.createObjectURL(blob)`
   - create a temporary `<a>` element with `href=url`, `download=fileName`
   - programmatically click the link
   - revoke the object URL: `URL.revokeObjectURL(url)`
6. clear download-in-progress state for that item

The user should be able to trigger multiple downloads simultaneously (different reports). Each row tracks its own loading state independently.

### 5.6 List refresh after export

After the existing "Generate report" handler receives a successful response (the `setSuccess(...)` call), the component should schedule a list refresh.

Since report generation is asynchronous (the backend returns 202 and generates the file in a background process), the file may not be available immediately. The component should:

1. wait 5 seconds after the success response
2. re-fetch the report list

This is a single delayed re-fetch, not polling. If the file is not ready after 5 seconds, the user can manually refresh the page.

Implementation approach: use a `listRefreshKey` counter in state. Increment it after the 5-second delay. The `useEffect` that fetches the list should include `listRefreshKey` in its dependency array.

Clean up the timeout in the effect cleanup function to avoid stale refreshes if the component unmounts or the employee code changes.

### 5.7 Filtering

The backend `GET /reports` returns reports for all employees. The component must filter the response array to include only items where `employeeCode` matches the current employee's code.

```ts
reports.filter(report => report.employeeCode === employeeCode)
```

## 6. Data Model

### 6.1 Available report item

```ts
interface AvailableReport {
  downloadUrl: string;
  employeeCode: string;
  fileName: string;
  period: string;
}
```

This matches the backend response shape exactly.

### 6.2 Component state additions

New state fields in `EmployeeReportExport`:

| Field | Type | Initial | Description |
|---|---|---|---|
| `reports` | `AvailableReport[]` | `[]` | Filtered list for the current employee. |
| `isLoadingReports` | `boolean` | `true` | True while the initial list fetch is in progress. |
| `reportsError` | `string \| null` | `null` | Error message if the list fetch fails. |
| `downloadingPeriods` | `Set<string>` | `new Set()` | Set of `period` values currently being downloaded. Used to disable individual download buttons. |
| `listRefreshKey` | `number` | `0` | Counter incremented to trigger list re-fetch. |

## 7. Network Flow Diagram

```text
User opens employee info tab
  └─ Component mounts
       └─ GET /api/reports
            └─ Next.js reads auth cookie
            └─ GET backend /reports (X-User-Password header)
            └─ Backend returns JSON array
       └─ Component filters by employeeCode
       └─ Renders report list

User clicks "Download" on a report row
  └─ GET /api/reports/{employeeCode}/{period}
       └─ Next.js reads auth cookie
       └─ GET backend /reports/{employeeCode}/{period}
       └─ Backend returns CSV bytes + headers
  └─ Component creates Blob → object URL → triggers download

User clicks "Generate report" (existing flow, unchanged)
  └─ POST /api/reports/{employeeCode}/{period}
  └─ On success → 5s delay → re-fetch GET /api/reports
```

## 8. Error Handling

### 8.1 List fetch errors

| Scenario | Behavior |
|---|---|
| 401 Unauthorized | Redirect to login. |
| Network error / timeout | Show `"Unable to load available reports"` in error area. |
| Non-OK status | Try to extract `error` from JSON body; fall back to `"Unable to load available reports"`. |
| Unexpected JSON shape | Silently treat as empty list (no reports to show). |

### 8.2 Download errors

| Scenario | Behavior |
|---|---|
| 401 Unauthorized | Redirect to login. |
| 404 Not Found | Show `"Report not found"` or error message from backend. |
| Network error / timeout | Show `"Failed to download report"` in error area. |
| Non-OK status | Try to extract `error` from JSON body; fall back to `"Failed to download report"`. |

### 8.3 Error message placement

Both list errors and download errors are shown in the same error area, below the report list (or in place of it). A new error replaces any previous error. The existing export error/success messages remain separate and above the report list area.

## 9. Existing Export Flow Interaction

The existing "Generate report" button, its handler, and its success/error messages remain unchanged. The only addition is the delayed list refresh after a successful export (section 5.6).

The `success` message `"Report export started. The file will be ready shortly."` continues to appear above the report list. This message gives the user context that the new report will appear in the list after generation completes.

## 10. Accessibility

- Report list items must be focusable and navigable via keyboard
- Download buttons must be proper `<button>` elements (not links or divs)
- Disabled download buttons must have `disabled` attribute (not just visual styling)
- Loading state changes must not steal focus from the active element
- File icon must have `aria-hidden="true"` since it is decorative

## 11. Files to Create or Modify

| File | Action | Purpose |
|---|---|---|
| `frontend/src/app/api/reports/route.ts` | Create | List reports proxy route. |
| `frontend/src/app/api/reports/[employeeCode]/[period]/route.ts` | Modify | Add GET handler for download proxy. |
| `frontend/src/ui/Pages/Employee/components/EmployeeReportExport.tsx` | Modify | Add report list rendering, download logic, state management. |

No other components need to change. The `EmployeeEditor` passes only `employeeCode` to `EmployeeReportExport`, which is sufficient for filtering and download.

## 12. Acceptance Criteria

Task is complete when:

1. `GET /api/reports` Next.js route exists and proxies to backend with auth
2. `GET /api/reports/:employeeCode/:period` Next.js route exists and returns CSV bytes with correct headers
3. the "Monthly report" section shows a list of available reports for the current employee
4. each report in the list can be downloaded by clicking "Download"
5. downloaded file name matches the backend `fileName` (`{employeeCode}-{period}.csv`)
6. downloaded file content is identical to the backend response (no encoding corruption)
7. empty list state is handled gracefully (no list area rendered)
8. loading state is shown while the list is being fetched
9. download in progress state is shown per-item while a file is downloading
10. errors during list fetch and download are shown to the user
11. 401 responses redirect to login
12. report list refreshes automatically ~5 seconds after a successful export
13. existing "Generate report" button and flow are not broken
14. the list is filtered to show only reports matching the current employee
