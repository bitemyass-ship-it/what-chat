# Backend Specification: Employee Monthly Report Export POST

## 1. Цель

Нужно реализовать backend `POST` endpoint, который запускает export CSV-отчета по сообщениям одного employee за один календарный месяц.

После изменений backend должен:

1. принимать `employeeCode` и `period` в route params
2. валидировать employee и период
3. запускать export в отдельном child process
4. сразу возвращать `202 Accepted`, если child process был успешно запущен или export для этого файла уже выполняется
5. сохранять отчет в локальную папку, путь к которой задается через env
6. всегда заменять существующий отчет при новом export

Эта спецификация описывает только `POST` export flow. `GET` для скачивания отчета находится вне scope этой задачи.

## 2. Scope

В scope задачи входит:

- новый backend route `POST /reports/:employeeCode/:period`
- auth protection для route
- env-настройка директории отчетов
- validation для `employeeCode` и `period`
- запуск child process из основного HTTP-процесса
- standalone worker для генерации CSV
- SQL query для выборки сообщений employee за месяц
- запись CSV-файла в файловую систему
- перезапись существующего CSV-файла
- unit/integration tests для POST и worker-логики

Вне scope:

- `GET` endpoint для скачивания
- cloud storage
- cron scheduler
- frontend UI
- XLSX export
- несколько листов/файлов на один отчет
- export медиафайлов

## 3. API Contract

### 3.1 Endpoint

Нужно добавить endpoint:

```http
POST /reports/:employeeCode/:period
```

Пример:

```http
POST /reports/anna/202605
```

`employeeCode` должен соответствовать `employees.code`.

`period` имеет формат:

```text
YYYYMM
```

Например:

```text
202605 = май 2026
```

### 3.2 Request Body

Request body не требуется.

Если body передан, backend должен его игнорировать. Для этой задачи фильтры в body не поддерживаются.

### 3.3 Authentication

Endpoint должен быть защищен тем же shared-password auth middleware, что и существующие employee endpoints.

Текущий backend auth contract:

- password передается в header `X-User-Password`
- если header отсутствует, пустой или неверный, backend возвращает `401`
- body unauthorized response:

```json
{
  "error": "Unauthorized"
}
```

Export route не должен запускать child process, проверять employee или трогать файловую систему, если request не прошел authentication.

### 3.4 Success Response

Если child process был запущен, response:

```http
202 Accepted
```

Body:

```json
{
  "status": "accepted"
}
```

Если export для того же `employeeCode + period` уже выполняется, backend тоже возвращает:

```http
202 Accepted
```

Body:

```json
{
  "status": "accepted"
}
```

Основной HTTP-процесс не должен ждать завершения export.

## 4. Error Contract

### 4.1 Invalid employeeCode

Если `employeeCode` отсутствует или после trim становится пустым:

```http
400 Bad Request
```

```json
{
  "error": "employeeCode route parameter is required"
}
```

### 4.2 Unknown employee

Если employee не найден:

```http
404 Not Found
```

```json
{
  "error": "Employee not found: anna"
}
```

### 4.3 Invalid period

Если `period` не соответствует `YYYYMM` или месяц не входит в диапазон `01..12`:

```http
400 Bad Request
```

```json
{
  "error": "period route parameter must use YYYYMM format"
}
```

Невалидные примеры:

- `2026`
- `202600`
- `202613`
- `20260501`
- `abcdef`

Если `period` указывает на будущий месяц:

```http
400 Bad Request
```

```json
{
  "error": "period must not be in the future"
}
```

### 4.4 Child process start failure

Если основной процесс не смог запустить child process:

```http
500 Internal Server Error
```

```json
{
  "error": "Failed to start report export"
}
```

Ошибки, которые происходят уже внутри child process после успешного старта, не меняют HTTP response текущего POST-запроса. Их нужно логировать.

## 5. Storage

### 5.1 Env variable

Нужно добавить env:

```env
REPORTS_DIR=reports
```

Для local development значение по умолчанию:

```text
reports
```

Если путь относительный, он резолвится относительно project root.

### 5.2 File path

Целевой файл отчета:

```text
{REPORTS_DIR}/employees/{employeeCode}/{employeeCode}-{period}.csv
```

Пример:

```text
reports/employees/anna/anna-202605.csv
```

Worker должен создавать отсутствующие директории автоматически.

### 5.3 Overwrite rule

Новый export всегда заменяет существующий файл для того же `employeeCode + period`.

Child process должен открывать целевой CSV-файл на запись с truncate/overwrite behavior. Отдельное versioning или backup старого файла не требуется.

## 6. CSV Format

### 6.1 Encoding and delimiter

CSV должен писаться как:

- UTF-8 with BOM
- delimiter: semicolon `;`
- newline: `\n`
- значения должны корректно quote/escape-иться

Причина: UTF-8 BOM и semicolon стабильнее открываются в Excel для региональных локалей и нормально импортируются в Google Sheets.

### 6.2 Columns

CSV содержит только сообщения.

Header:

```csv
event_time;chat_phone_number;direction;body;message_type;call_info
```

Колонки:

| Column | Source | Description |
|---|---|---|
| `event_time` | `messages.timestamp` | Время события без секунд в server local timezone, формат `YYYY-MM-DD HH:mm`. |
| `chat_phone_number` | `chats.phone_number`, fallback `chats.chat_id` | Номер собеседника. Если номер неизвестен, пишется raw `chat_id`. |
| `direction` | `messages.direction` | `incoming`, `outgoing` или `system`. |
| `body` | `messages.body` | Текст сообщения. |
| `message_type` | `messages.message_type` | Тип события/сообщения, например `chat`, `image`, `video`, `audio`, `call`. |
| `call_info` | `messages.call_status` + `messages.call_media_type` | Для звонков объединенная информация, например `missed voice`, `incoming video`. Для обычных сообщений пустая строка. |

Employee-информация не дублируется в строках CSV, потому что `employeeCode` уже находится в route и имени файла.

Technical timestamps `created_at` / `updated_at` не экспортируются.

### 6.3 `call_info` formatting

Правила:

```text
call_status + " " + call_media_type
```

Если есть только одно поле, пишется только оно.

Если оба поля пустые, пишется пустая строка.

Примеры:

| call_status | call_media_type | call_info |
|---|---|---|
| `missed` | `voice` | `missed voice` |
| `incoming` | `video` | `incoming video` |
| `outgoing` | `null` | `outgoing` |
| `null` | `null` | `` |

## 7. Period Rules

`period = YYYYMM` должен превращаться в календарный диапазон месяца в server local timezone.

Пример:

```text
202605
```

Диапазон:

```text
start: 2026-05-01 00:00 inclusive
end:   2026-06-01 00:00 exclusive
```

Фильтрация выполняется по времени возникновения события:

```text
messages.timestamp
```

Сообщения с `timestamp IS NULL` не включаются в отчет.

Backend должен разрешать:

- прошлые месяцы
- текущий месяц, даже если он еще не завершен

Backend должен отклонять:

- будущие месяцы

Например, если текущая дата `2026-04-21`:

- `202603` разрешен
- `202604` разрешен
- `202605` возвращает `400`

## 8. SQL Selection Rules

Worker должен экспортировать только строки из `messages`, которые:

1. принадлежат указанному employee
2. имеют `timestamp`
3. попадают в выбранный month period

Чаты без сообщений за период не экспортируются, потому что отчет содержит только сообщения.

Рекомендуемый shape запроса:

```sql
SELECT
  m.timestamp,
  COALESCE(NULLIF(c.phone_number, ''), c.chat_id) AS chat_phone_number,
  m.direction,
  m.body,
  m.message_type,
  m.call_status,
  m.call_media_type,
  m.id AS message_id
FROM messages m
INNER JOIN employees e ON e.id = m.employee_id
INNER JOIN chats c ON c.id = m.chat_record_id
WHERE e.code = ?
  AND m.timestamp IS NOT NULL
  AND m.timestamp >= ?
  AND m.timestamp < ?
ORDER BY
  chat_phone_number ASC,
  m.timestamp ASC,
  m.id ASC;
```

Primary сортировка:

```text
chat_phone_number ASC
```

Secondary сортировка:

```text
event_time ASC
```

`m.id ASC` нужен только для стабильного порядка, если несколько событий имеют одинаковый timestamp.

## 9. Child Process Flow

### 9.1 Main process responsibilities

Основной HTTP-процесс должен:

1. принять POST request
2. проверить auth через существующий auth middleware
3. валидировать route params
4. проверить, что employee существует
5. вычислить абсолютный path к будущему CSV
6. запустить child process
7. вернуть `202 Accepted`

Основной процесс не должен:

- читать сообщения из базы для export
- писать CSV
- ждать завершения child process
- возвращать количество строк export-а
- возвращать размер файла

### 9.2 Duplicate in-flight request

Чтобы не было конкурентной записи в один и тот же файл, основной процесс должен держать in-memory set активных jobs по ключу:

```text
{employeeCode}:{period}
```

Если такой key уже активен, повторный POST должен вернуть `202 Accepted` без запуска второго child process.

Когда child process завершается, key удаляется из active set.

Это in-memory правило достаточно для MVP. Cross-process locking между несколькими backend instances вне scope.

### 9.3 Worker input

Child process должен получать:

- `employeeCode`
- `period`
- resolved database path
- resolved reports dir
- target file path

Input можно передать через CLI args или env vars. Главное требование: worker не должен зависеть от Express request object.

### 9.4 Worker responsibilities

Worker должен:

1. открыть SQLite database самостоятельно
2. выполнить export query
3. создать директорию для отчета
4. создать или перезаписать целевой CSV-файл
5. записать UTF-8 BOM
6. записать header
7. записать строки сообщений
8. закрыть database/file handles
9. завершиться с exit code `0` при успехе

Если export завершился ошибкой, worker должен:

1. залогировать ошибку в stderr
2. завершиться с non-zero exit code

HTTP response уже отправлен, поэтому failure worker-а не должен пытаться отвечать клиенту.

## 10. Routing and App Wiring

Нужно добавить отдельный reports router/controller, например:

- `src/routes/reports.ts`
- `src/controllers/reports-controller.ts`
- `src/reports/report-export-service.ts`
- `src/reports/report-export-worker.ts`

Route должен быть защищен тем же auth middleware, что и employee routes.

Рекомендуемое подключение:

```ts
app.use('/reports', authMiddleware);
app.use(createReportsRouter(...));
```

И route внутри router:

```ts
router.post('/reports/:employeeCode/:period', controller.create);
```

Важно: в этой задаче не добавлять `GET /reports/:employeeCode/:period`.

## 11. Environment Updates

Нужно обновить `.env.example`:

```env
# Local report export directory. Relative paths are resolved from project root.
REPORTS_DIR=reports
```

Также нужно добавить helper для resolution reports directory, аналогично подходу `resolveDatabasePath`.

## 12. Tests

### 12.1 Period parsing tests

Покрыть:

- `202605` -> May 2026 range
- `202601` -> January 2026 range
- `202612` -> December 2026 range
- invalid `202600`
- invalid `202613`
- invalid `2026`
- invalid `20260501`
- invalid `abc`
- current month is accepted
- past month is accepted
- future month is rejected with `period must not be in the future`

### 12.2 CSV formatting tests

Покрыть:

- header exactly equals `event_time;chat_phone_number;direction;body;message_type;call_info`
- UTF-8 BOM exists
- body with delimiter/newline/quotes is escaped correctly
- `call_status + call_media_type` becomes `call_info`
- missing phone number falls back to `chat_id`
- `event_time` has no seconds

### 12.3 Worker export tests

Покрыть:

- exports only selected employee messages
- exports only selected month
- excludes messages with `timestamp IS NULL`
- excludes chats without messages
- sorts by `chat_phone_number ASC`, then timestamp ASC
- overwrites an existing file
- creates missing report directories

### 12.4 POST endpoint tests

Покрыть:

- missing auth header returns `401` and does not spawn child process
- invalid auth header returns `401` and does not spawn child process
- valid POST returns `202`
- valid POST starts child process
- unknown employee returns `404`
- invalid period returns `400`
- empty employeeCode returns `400`
- child process start failure returns `500`
- duplicate in-flight POST returns `202` and does not spawn a second child process

## 13. Acceptance Criteria

Задача считается выполненной, когда:

1. `POST /reports/:employeeCode/:period` существует и защищен auth middleware
2. валидный POST возвращает `202 Accepted` сразу после старта child process
3. worker создает CSV в `{REPORTS_DIR}/employees/{employeeCode}/{employeeCode}-{period}.csv`
4. существующий CSV для того же employee/period перезаписывается
5. CSV содержит только колонки `event_time`, `chat_phone_number`, `direction`, `body`, `message_type`, `call_info`
6. CSV содержит только сообщения выбранного employee за выбранный месяц
7. строки отсортированы по `chat_phone_number ASC`, затем `event_time ASC`
8. сообщения без `timestamp` не экспортируются
9. `GET` endpoint не добавлен и не изменен
10. тесты покрывают validation, child process запуск и worker export
