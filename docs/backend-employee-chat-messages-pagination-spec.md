# Backend Specification: Employee Chat Messages Table Pagination

## 1. Цель

Нужно реализовать server-side pagination для таблицы сообщений конкретного чата.

После изменений backend должен:

1. отдавать историю сообщений не целиком, а страницами
2. возвращать pagination metadata вместе со списком сообщений
3. сортировать сообщения только на сервере по дате сообщения
4. не предоставлять клиенту сортировку по другим колонкам

Эта спецификация описывает только backend-контракт и backend-логику для таблицы сообщений одного чата.

## 2. Scope

В scope задачи входит:

- обновление `GET /employees/:code/chats/:chatRecordId/messages`
- добавление query-параметров пагинации
- возврат pagination metadata
- использование `LIMIT/OFFSET` на уровне repository / SQL
- фиксированная серверная сортировка по `timestamp`
- обновление backend tests

Вне scope:

- таблица списка чатов сотрудника
- frontend UI
- клиентская сортировка
- фильтры
- поиск по сообщениям
- редактирование summary блока чата, кроме случаев, когда это нужно для согласованности API

## 3. Текущее состояние

Сейчас endpoint:

- `GET /employees/:code/chats/:chatRecordId/messages`

возвращает полный массив сообщений чата.

Текущее поведение:

- controller всегда отдает все доступные сообщения
- response body является plain array
- сообщения уже отсортированы по `timestamp DESC`
- pagination metadata отсутствует

На уровне repository уже есть почти вся нужная инфраструктура:

- `LIMIT/OFFSET`
- `COUNT(*)`

То есть для messages pagination backend уже частично подготовлен.

## 4. Целевой API Contract

### 4.1 Endpoint

Route path остается тем же:

- `GET /employees/:code/chats/:chatRecordId/messages`

Но endpoint должен принимать query params:

- `page`
- `pageSize`

Пример:

- `GET /employees/anna/chats/17/messages?page=1&pageSize=20`

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

### 4.3 Success Response

Успешный `200 OK` response должен быть объектом:

```ts
interface GetEmployeeChatMessagesResponse {
  items: ChatMessageListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
```

Где:

```ts
interface ChatMessageListItem {
  messageId: number;
  externalMessageId: string;
  timestamp: string | null;
  direction: 'incoming' | 'outgoing' | 'system';
  body: string;
  messageType: string;
}
```

Пример:

```json
{
  "items": [
    {
      "messageId": 2,
      "externalMessageId": "wamid-latest",
      "timestamp": "2026-03-31T09:41:22.000Z",
      "direction": "outgoing",
      "body": "Latest message",
      "messageType": "chat"
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 94,
  "totalPages": 5
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

### 5.2 Unknown chat

Если `chatRecordId` не принадлежит этому employee или chat не существует:

- status: `404`
- body:

```json
{
  "error": "Chat not found: 17"
}
```

### 5.3 Invalid route params

Если `chatRecordId` не является положительным integer:

- status: `400`
- body:

```json
{
  "error": "chatRecordId route parameter must be a positive integer"
}
```

### 5.4 Invalid query params

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

### 5.5 Unexpected backend failure

Нужно сохранить текущий style:

- status: `500`
- body:

```json
{
  "error": "Failed to read employee chat messages"
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
  "page": 8,
  "pageSize": 20,
  "total": 11,
  "totalPages": 1
}
```

## 7. Sorting Rules

Клиентская сортировка для таблицы сообщений не поддерживается.

Backend всегда обязан возвращать сообщения в одном фиксированном порядке.

### 7.1 Primary ordering

- `timestamp DESC`

То есть newest first.

### 7.2 Rows with null timestamp

Сообщения с `timestamp = null` должны идти после сообщений с датой.

### 7.3 Stable tie-breaker

Если `timestamp` одинаковый, нужен стабильный deterministic порядок.

Рекомендуемый tie-breaker:

- `messageId DESC`

### 7.4 Required SQL ordering

Рекомендуемая сортировка:

```sql
ORDER BY
  CASE WHEN m.timestamp IS NULL THEN 1 ELSE 0 END ASC,
  m.timestamp DESC,
  m.id DESC
```

## 8. Repository Requirements

### 8.1 Existing capabilities to reuse

Repository уже умеет:

- `countByEmployeeCodeAndChatRecordId(employeeCode, chatRecordId)`
- `listByEmployeeCodeAndChatRecordId(employeeCode, chatRecordId, { limit, offset })`

Их нужно использовать как основную реализацию pagination.

### 8.2 Required behavior

Controller должен:

- считать `total` через repository count method
- читать только одну страницу сообщений через repository list method

### 8.3 Chat existence validation

Перед возвратом paginated messages backend должен убедиться, что chat существует и принадлежит employee.

Нельзя полагаться только на пустой массив messages, потому что:

- пустой чат и несуществующий чат должны различаться

Если сейчас проверка делается через загрузку полного списка чатов и `.find(...)`, ее нужно считать временной и неэффективной для paginated мира.

Рекомендуемое целевое поведение:

- точечная проверка существования чата по `chatRecordId`

## 9. Serialization Requirements

Поля message row должны остаться совместимыми с текущим frontend row contract.

Меняется только верхний контейнер response:

- было: `ChatMessageListItem[]`
- станет: `{ items, page, pageSize, total, totalPages }`

### 9.1 Timestamp format

Backend должен продолжать отдавать `timestamp` как:

- ISO 8601 UTC string
- или `null`

Пример:

- `2026-03-31T09:41:22.000Z`

## 10. Controller Requirements

Controller for `GET /employees/:code/chats/:chatRecordId/messages` должен:

1. провалидировать `code`
2. провалидировать `chatRecordId`
3. провалидировать `page`
4. провалидировать `pageSize`
5. убедиться, что employee существует
6. убедиться, что chat существует и принадлежит employee
7. получить `total`
8. вычислить `offset`
9. загрузить только одну страницу messages
10. вернуть paginated response object

## 11. Test Requirements

Нужно обновить и/или добавить tests для следующих сценариев:

- endpoint возвращает первую страницу сообщений
- endpoint возвращает максимум `20` элементов
- endpoint возвращает корректный `total`
- endpoint возвращает корректный `totalPages`
- endpoint возвращает пустой `items`, если page вне диапазона
- endpoint возвращает `400` на invalid `page`
- endpoint возвращает `400` на invalid `pageSize`
- endpoint возвращает `400` на invalid `chatRecordId`
- endpoint возвращает `404` для unknown employee
- endpoint возвращает `404` для unknown chat
- endpoint сохраняет required sort order по дате

## 12. Acceptance Criteria

- `GET /employees/:code/chats/:chatRecordId/messages` больше не возвращает plain array.
- Endpoint принимает `page` и `pageSize`.
- Один response содержит максимум 20 сообщений.
- Backend возвращает `items`, `page`, `pageSize`, `total`, `totalPages`.
- Порядок строк задаётся только backend sorting по `timestamp DESC`.
- Заготовка для сортировки по другим колонкам отсутствует.
- Ошибки валидации query params возвращаются как `400`.
- Unknown employee возвращает `404`.
- Unknown chat возвращает `404`.
