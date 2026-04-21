# Backend Specification: Employee Monthly Report Download GET

## 1. Цель

Нужно реализовать backend `GET` endpoints для работы с уже сгенерированными CSV-отчетами:

1. скачать конкретный отчет по `employeeCode + period`
2. получить список доступных отчетов для UI

После изменений backend должен:

1. отдавать существующий CSV-файл через `GET /reports/:employeeCode/:period`
2. отдавать список доступных отчетов через `GET /reports`
3. защищать оба endpoint тем же shared-password auth middleware, что и `POST /reports`
4. читать файлы только из configured `REPORTS_DIR`
5. не запускать export и не создавать файлы в GET flow
6. безопасно обрабатывать отсутствующие файлы и директории

Эта спецификация описывает только GET download/list flow. Генерация отчетов через `POST /reports/:employeeCode/:period` уже описана отдельно в `docs/backend-report-export-post-spec.md`.

## 2. Scope

В scope задачи входит:

- `GET /reports/:employeeCode/:period`
- `GET /reports`
- auth protection для обоих GET endpoints
- validation для `employeeCode` и `period`
- проверка существования employee для download endpoint
- безопасное вычисление file path внутри `REPORTS_DIR`
- отдача CSV-файла с корректными download headers
- список доступных CSV-отчетов для UI
- unit/integration tests для download/list flow

Вне scope:

- генерация отчета
- изменение `POST /reports/:employeeCode/:period`
- frontend UI
- cloud storage
- stream progress
- partial/range downloads
- удаление отчетов
- переименование отчетов
- XLSX export

## 3. Existing Storage Contract

Отчеты лежат в директории:

```env
REPORTS_DIR=reports
```

Если путь относительный, он резолвится от project root.

Файл отчета:

```text
{REPORTS_DIR}/employees/{employeeCode}/{employeeCode}-{period}.csv
```

Пример:

```text
reports/employees/anna/anna-202605.csv
```

GET endpoints не должны создавать `REPORTS_DIR` или вложенные директории. Если директории нет, это нормальное состояние "отчетов пока нет".

## 4. Authentication

Оба GET endpoint должны быть защищены тем же shared-password auth middleware, что и employee endpoints и POST export endpoint.

Текущий backend auth contract:

- password передается в header `X-User-Password`
- если header отсутствует, пустой или неверный, backend возвращает `401`
- body unauthorized response:

```json
{
  "error": "Unauthorized"
}
```

GET endpoints не должны проверять employee, читать директории отчетов или трогать файловую систему, если request не прошел authentication.

## 5. Endpoint: Download Report

### 5.1 Contract

Добавить endpoint:

```http
GET /reports/:employeeCode/:period
```

Пример:

```http
GET /reports/anna/202605
```

`employeeCode` должен соответствовать `employees.code`.

`period` имеет формат:

```text
YYYYMM
```

### 5.2 Request Body

Request body не требуется.

Если body передан, backend должен его игнорировать.

### 5.3 Success Response

Если employee существует и CSV-файл найден:

```http
200 OK
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="anna-202605.csv"
```

Response body: bytes CSV-файла.

Допустимо также выставлять:

```http
Content-Length: <file size bytes>
```

Backend должен отдавать файл как download attachment, чтобы браузер скачивал CSV, а не пытался отрисовать его как JSON.

### 5.4 Download File Name

Download filename должен быть:

```text
{employeeCode}-{period}.csv
```

Пример:

```text
anna-202605.csv
```

## 6. Endpoint: List Available Reports

### 6.1 Contract

Добавить endpoint:

```http
GET /reports
```

Endpoint возвращает массив доступных отчетов, которые можно скачать.

### 6.2 Success Response

Если отчеты есть:

```http
200 OK
Content-Type: application/json
```

Body:

```json
[
  {
    "employeeCode": "anna",
    "period": "202605",
    "fileName": "anna-202605.csv",
    "downloadUrl": "/reports/anna/202605"
  },
  {
    "employeeCode": "bob",
    "period": "202604",
    "fileName": "bob-202604.csv",
    "downloadUrl": "/reports/bob/202604"
  }
]
```

Если `REPORTS_DIR` или `REPORTS_DIR/employees` отсутствует:

```http
200 OK
```

Body:

```json
[]
```

### 6.3 Response Shape

Каждый item:

| Field | Type | Description |
|---|---|---|
| `employeeCode` | string | Employee code from directory name. |
| `period` | string | Report period from file name. |
| `fileName` | string | CSV file name displayed by UI. |
| `downloadUrl` | string | Backend URL for downloading this report. |

Response intentionally returns a bare JSON array, not `{ "items": [...] }`, to keep the UI contract minimal.

### 6.4 Sorting

List response should be stable and deterministic:

1. `employeeCode ASC`
2. `period DESC`
3. `fileName ASC`

This lets UI show each employee's newest reports first.

### 6.5 File Discovery Rules

The list endpoint should scan only:

```text
{REPORTS_DIR}/employees/*
```

Expected structure:

```text
{REPORTS_DIR}/employees/{employeeCode}/{employeeCode}-{period}.csv
```

Only files matching this pattern should be returned:

```text
{employeeCode}-{YYYYMM}.csv
```

Rules:

- ignore directories that are not employee folders
- ignore non-CSV files
- ignore files whose period is not valid `YYYYMM`
- ignore files whose filename employee prefix does not match parent employee directory
- ignore nested files deeper than one employee directory level
- do not throw if one employee folder cannot be read; log warning and continue

Example ignored files:

```text
reports/employees/anna/readme.txt
reports/employees/anna/anna-202613.csv
reports/employees/anna/bob-202605.csv
reports/tmp.csv
reports/employees/anna/archive/anna-202604.csv
```

## 7. Validation and Errors

### 7.1 Invalid employeeCode

For `GET /reports/:employeeCode/:period`, if `employeeCode` is absent or after trim becomes empty:

```http
400 Bad Request
```

```json
{
  "error": "employeeCode route parameter is required"
}
```

### 7.2 Unknown employee

For `GET /reports/:employeeCode/:period`, if employee is not found:

```http
404 Not Found
```

```json
{
  "error": "Employee not found: anna"
}
```

### 7.3 Invalid period

For `GET /reports/:employeeCode/:period`, if `period` does not match `YYYYMM` or month is not `01..12`:

```http
400 Bad Request
```

```json
{
  "error": "period route parameter must use YYYYMM format"
}
```

Invalid examples:

- `2026`
- `202600`
- `202613`
- `20260501`
- `abcdef`

### 7.4 Future period

For consistency with POST export validation, if `period` points to a future month:

```http
400 Bad Request
```

```json
{
  "error": "period must not be in the future"
}
```

### 7.5 Report file not found

If employee exists and period is valid, but target CSV does not exist:

```http
404 Not Found
```

```json
{
  "error": "Report not found: anna 202605"
}
```

### 7.6 Filesystem read failure

If backend cannot read an existing report file due to unexpected filesystem error:

```http
500 Internal Server Error
```

```json
{
  "error": "Failed to read report file"
}
```

The error should be logged with:

- `employeeCode`
- `period`
- `targetFilePath`
- filesystem error message

### 7.7 List filesystem failure

If list endpoint cannot read the top-level report directory due to unexpected filesystem error:

```http
500 Internal Server Error
```

```json
{
  "error": "Failed to list report files"
}
```

If `REPORTS_DIR` or `REPORTS_DIR/employees` does not exist, return `200 []`, not `500`.

## 8. Security Requirements

### 8.1 Path traversal protection

Backend must never read files outside resolved `REPORTS_DIR`.

Implementation must:

1. build target path from known path segments, not from a raw user-provided path
2. resolve target path to absolute path
3. verify that resolved target path remains inside resolved `REPORTS_DIR`

Recommended check:

```ts
const relativePath = path.relative(reportsDir, targetFilePath);
const isInsideReportsDir =
  relativePath !== '' &&
  !relativePath.startsWith('..') &&
  !path.isAbsolute(relativePath);
```

If path safety check fails, return:

```http
400 Bad Request
```

```json
{
  "error": "Invalid report path"
}
```

### 8.2 No arbitrary file download

Download endpoint must not accept:

- raw file paths
- query param paths
- file names from request body
- `../` traversal
- absolute paths

Only `employeeCode + period` route params are allowed.

### 8.3 Content type

Downloaded reports must be returned as CSV:

```http
Content-Type: text/csv; charset=utf-8
```

Do not return report bytes as JSON.

## 9. Routing and App Wiring

Extend existing reports router/controller.

Recommended files:

- `src/routes/reports.ts`
- `src/controllers/reports-controller.ts`
- `src/reports/report-paths.ts`
- optionally `src/reports/report-file-service.ts`

Routes:

```ts
router.get('/reports', controller.list);
router.get('/reports/:employeeCode/:period', controller.download);
router.post('/reports/:employeeCode/:period', controller.create);
```

Order matters: mount `GET /reports` before `GET /reports/:employeeCode/:period`.

App wiring stays protected:

```ts
app.use('/reports', authMiddleware);
app.use(createReportsRouter(...));
```

## 10. Tests

### 10.1 Download endpoint tests

Cover:

- missing auth header returns `401`
- invalid auth header returns `401`
- valid download returns `200`
- valid download returns CSV bytes exactly as stored
- valid download sets `Content-Type: text/csv; charset=utf-8`
- valid download sets `Content-Disposition` attachment with `{employeeCode}-{period}.csv`
- unknown employee returns `404`
- invalid period returns `400`
- future period returns `400`
- missing report file returns `404`
- filesystem read failure returns `500`
- request body is ignored
- no child process/export is started by GET

### 10.2 List endpoint tests

Cover:

- missing auth header returns `401`
- invalid auth header returns `401`
- missing `REPORTS_DIR` returns `200 []`
- missing `REPORTS_DIR/employees` returns `200 []`
- returns available report files as array
- returns `employeeCode`, `period`, `fileName`, `downloadUrl`
- sorts by `employeeCode ASC`, `period DESC`, `fileName ASC`
- ignores invalid/non-CSV/nested files
- ignores file where filename employee prefix does not match parent directory
- one unreadable employee directory logs warning and does not break whole list, if feasible to test

### 10.3 Path safety tests

Cover:

- target download path must stay inside `REPORTS_DIR`
- list endpoint does not expose files outside `REPORTS_DIR`
- generated root `reports/` remains ignored by git via `/reports/`
- `src/reports/*` is not ignored by git

## 11. Acceptance Criteria

Task is complete when:

1. `GET /reports/:employeeCode/:period` exists and is auth-protected
2. `GET /reports` exists and is auth-protected
3. valid download returns the exact CSV file from `{REPORTS_DIR}/employees/{employeeCode}/{employeeCode}-{period}.csv`
4. download response has correct CSV and attachment headers
5. missing report returns `404`, not an empty CSV
6. list response returns a JSON array of downloadable reports
7. list response is deterministic and ignores invalid files
8. GET endpoints never start export child processes
9. GET endpoints never create or overwrite report files
10. path traversal outside `REPORTS_DIR` is impossible
11. generated root `reports/` is ignored by git using `/reports/`, while `src/reports/` remains visible to git
12. tests cover auth, validation, file download, list behavior, and path safety
