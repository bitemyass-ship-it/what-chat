# Backend Specification: Employee Chats Table Pagination

## 1. Цель

Нужно реализовать server-side pagination для списка чатов сотрудника.

После изменений backend должен:

1. отдавать список чатов не целиком, а страницами
2. возвращать pagination metadata вместе с данными
3. сортировать чаты только на сервере по дате последнего сообщения
4. не предоставлять клиенту никакой логики сортировки по другим колонкам

Эта спецификация описывает только backend-контракт и backend-логику для таблицы чатов.

## 2. Scope

В scope задачи входит:

- обновление `GET /employees/:code/chats`
- добавление query-параметров пагинации
- возврат pagination metadata
- пагинация на уровне repository / SQL
- фиксированная серверная сортировка по дате
- обновление backend tests

Вне scope:

- таблица сообщений конкретного чата
- frontend UI
- клиентская сортировка
- фильтры
- поиск

## 3. Текущее состояние

Сейчас endpoint:

- `GET /employees/:code/chats`

возвращает полный массив чатов сотрудника.

Текущее поведение:

- список не пагинируется
- response body является plain array
- сортировка уже задаётся на backend
- pagination metadata отсутствует

В repository уже есть:

- `countByEmployeeCode(employeeCode)`

Но analytics listing пока работает без `LIMIT/OFFSET`.

## 4. Целевой API Contract

### 4.1 Endpoint

Новый read contract остается тем же по route path:

- `GET /employees/:code/chats`

Но endpoint должен начать принимать query params:

- `page`
- `pageSize`

Пример:

- `GET /employees/anna/chats?page=1&pageSize=20`

### 4.2 Query Parameters

#### `page`

- optional
- positive integer
- default: `1`
- minimum: `1`

#### `pageSize`

- optional
- positive integer
- default: `20`

Для этой задачи рекомендуется зафиксировать `pageSize = 20`.

Если приходит любое другое значение, backend должен вернуть `400`.

Это упростит контракт и не создаст ложного впечатления, что размер страницы настраиваемый в UI.

### 4.3 Success Response

Успешный `200 OK` response должен быть объектом, а не массивом:

```ts
interface GetEmployeeChatsResponse {
  items: EmployeeChatListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
```

Где:

```ts
interface EmployeeChatListItem {
  chatRecordId: number;
  displayName: string | null;
  phoneNumber: string | null;
  rawChatLabel: string;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  totalMessages: number;
  incomingMessages: number;
  outgoingMessages: number;
}
```

Пример:

```json
{
  "items": [
    {
      "chatRecordId": 17,
      "displayName": "Anna Thread",
      "phoneNumber": "380991112233",
      "rawChatLabel": "380991112233@c.us",
      "firstMessageAt": "2026-03-30T08:15:00.000Z",
      "lastMessageAt": "2026-03-31T09:41:22.000Z",
      "lastMessagePreview": "Latest Anna preview",
      "totalMessages": 6,
      "incomingMessages": 4,
      "outgoingMessages": 2
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 137,
  "totalPages": 7
}
```

## 5. Error Contract

### 5.1 Unknown employee

Если employee не существует:

- status: `404`
- body:

```json
{
  "error": "Employee not found: anna"
}
```

### 5.2 Invalid query params

Если `page` не является положительным integer:

- status: `400`
- body:

```json
{
  "error": "page query parameter must be a positive integer"
}
```

Если `pageSize` не равно `20`:

- status: `400`
- body:

```json
{
  "error": "pageSize query parameter must be 20"
}
```

### 5.3 Unexpected backend failure

Нужно сохранить текущий style:

- status: `500`
- body:

```json
{
  "error": "Failed to read employee chats"
}
```

## 6. Pagination Rules

### 6.1 Default values

Если query params отсутствуют:

- `page = 1`
- `pageSize = 20`

### 6.2 Offset calculation

Backend должен считать:

```ts
offset = (page - 1) * pageSize;
```

### 6.3 Total pages

Backend должен считать:

```ts
totalPages = Math.max(1, Math.ceil(total / pageSize));
```

Это правило гарантирует стабильный pagination contract даже при `total = 0`.

### 6.4 Page overflow

Если клиент запрашивает страницу больше существующего диапазона:

- backend не должен silently переписывать `page`
- backend должен вернуть:
  - корректные `page`, `pageSize`, `total`, `totalPages`
  - пустой `items`

Пример:

```json
{
  "items": [],
  "page": 9,
  "pageSize": 20,
  "total": 31,
  "totalPages": 2
}
```

## 7. Sorting Rules

Клиентская сортировка для этой таблицы не поддерживается.

Backend всегда обязан возвращать чаты в одном фиксированном порядке.

### 7.1 Primary ordering

Сначала идут чаты, у которых `lastMessageAt` не `null`.

Потом идут чаты без даты последнего сообщения.

### 7.2 Date ordering

Для чатов с датой:

- `lastMessageAt DESC`

То есть newest first.

### 7.3 Stable tie-breaker

Если timestamp одинаковый, нужен стабильный deterministic порядок.

Рекомендуемый tie-breaker:

- `chatRecordId ASC`

### 7.4 Required SQL ordering

Рекомендуемая сортировка:

```sql
ORDER BY
  CASE WHEN c.last_message_timestamp IS NULL THEN 1 ELSE 0 END ASC,
  c.last_message_timestamp DESC,
  c.id ASC
```

## 8. Repository Requirements

### 8.1 Existing method to reuse

Можно и нужно использовать уже существующий:

- `countByEmployeeCode(employeeCode: string): number`

### 8.2 New paginated analytics method

Нужно добавить paginated-версию analytics listing:

```ts
listAnalyticsByEmployeeCode(
  employeeCode: string,
  options: { limit: number; offset: number }
): ChatAnalyticsRecord[]
```

Если удобнее, можно:

- либо расширить существующий метод optional options
- либо добавить отдельный paginated method

Но итоговый backend code должен уметь читать только одну страницу за запрос.

### 8.3 Analytics requirements remain unchanged

Каждый chat row по-прежнему должен содержать:

- `totalMessages`
- `incomingMessages`
- `outgoingMessages`

При этом:

- `totalMessages = incomingMessages + outgoingMessages`
- `system` messages не входят в эти counters

## 9. Serialization Requirements

Поля chat item должны остаться совместимыми с текущим frontend contract на уровне row shape.

Меняется только верхний контейнер response:

- было: `EmployeeChatListItem[]`
- станет: `{ items, page, pageSize, total, totalPages }`

### 9.1 Timestamp format

Backend должен продолжать отдавать:

- `firstMessageAt` как ISO 8601 UTC string или `null`
- `lastMessageAt` как ISO 8601 UTC string или `null`

Пример:

- `2026-03-31T09:41:22.000Z`

## 10. Controller Requirements

Controller for `GET /employees/:code/chats` должен:

1. провалидировать `code`
2. провалидировать `page`
3. провалидировать `pageSize`
4. убедиться, что employee существует
5. получить `total`
6. вычислить `offset`
7. загрузить только одну страницу chat rows
8. вернуть paginated response object

## 11. Test Requirements

Нужно обновить и/или добавить tests для следующих сценариев:

- endpoint возвращает первую страницу с `page = 1`
- endpoint возвращает максимум `20` элементов
- endpoint возвращает корректный `total`
- endpoint возвращает корректный `totalPages`
- endpoint возвращает пустой `items`, если page вне диапазона
- endpoint возвращает `400` на invalid `page`
- endpoint возвращает `400` на invalid `pageSize`
- endpoint сохраняет required sort order по дате
- endpoint возвращает `404` для unknown employee

## 12. Acceptance Criteria

- `GET /employees/:code/chats` больше не возвращает plain array.
- Endpoint принимает `page` и `pageSize`.
- Один response содержит максимум 20 чатов.
- Backend возвращает `items`, `page`, `pageSize`, `total`, `totalPages`.
- Порядок строк задаётся только backend sorting по `lastMessageAt DESC`.
- Заготовка для сортировки по другим колонкам отсутствует.
- Ошибки валидации query params возвращаются как `400`.
- Поведение для unknown employee остается `404`.
