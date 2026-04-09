# Backend Specification: Employee Create/Delete

## 1. Цель

Нужно изменить backend так, чтобы он поддерживал два продуктовых сценария:

1. добавление нового employee по одному обязательному полю `displayName`
2. удаление existing employee через безопасный backend flow

Спецификация описывает только backend-часть. Frontend, proxy-роуты и UI здесь упоминаются только как потребители API.

## 2. Контекст текущей реализации

Текущая реализация уже содержит:

- `POST /employees`
- `DELETE /employees/:code`
- таблицу `employees` в SQLite
- `employees-controller`, `employees-repository`, `sessionManager`

Текущее поведение не соответствует новому продуктному сценарию:

- `POST /employees` требует `code` в request body
- при создании employee с `isActive = true` backend пытается сразу поднять WhatsApp session
- repository по умолчанию создает employee с `isActive = true`

Это мешает создать employee "только по имени", потому что у него еще нет phone number и WhatsApp session не должна стартовать автоматически.

## 3. Scope

В scope задачи входит:

- смена контракта `POST /employees`
- backend-генерация уникального `code`
- создание employee в неактивном состоянии
- полное удаление employee вместе с чатами и session artifacts
- корректная работа с runtime WhatsApp session при удалении
- обновление backend-тестов

Вне scope:

- rename доменной сущности `employee` в `user`
- изменение `PATCH /employees/:code`
- bulk create / bulk delete
- editable `code`

## 4. Термины

- `employee` - внутренняя доменная сущность backend
- `code` - immutable идентификатор employee, используется в route params, repository lookup и session ownership
- `runtime session` - текущая WhatsApp session внутри `sessionManager`
- `persisted active state` - значение `employees.is_active` в базе

## 5. Целевое поведение

### 5.1 Create employee

Backend должен принимать только имя сотрудника, сам генерировать `code` и создавать employee в безопасном "неактивном" состоянии.

После успешного создания запись должна иметь:

- `displayName = <trimmed input>`
- `code = <generated unique code>`
- `phoneNumber = null`
- `sessionDir = null`
- `isActive = false`

Во время create backend не должен:

- стартовать WhatsApp session
- создавать runtime session
- требовать phone number
- требовать session dir

### 5.2 Delete employee

Backend должен удалять employee только если:

- employee существует

Полное удаление должно включать:

- сам employee record
- все `chats`, связанные с employee
- все `chat_aliases`, связанные с этими чатами или employee
- runtime WhatsApp session, если она существует
- persisted WhatsApp session storage на диске

Если у employee есть runtime WhatsApp session, backend обязан сначала остановить ее, затем удалить persisted session storage и затем удалить employee record.

Если удаление не завершилось после остановки runtime session, backend должен попытаться вернуть runtime session в исходное состояние.

## 6. API contract

### 6.1 POST /employees

#### Request body

```json
{
  "displayName": "Anna Petrova"
}
```

#### Rules

- `displayName` обязателен
- `displayName` должен быть строкой
- после `trim()` `displayName` не должен быть пустым
- для MVP route должен отвергать поля `code`, `phoneNumber`, `isActive`, `sessionDir`

#### Success response

- status: `201`
- body: стандартный serialized employee object

Пример:

```json
{
  "id": 7,
  "code": "anna-petrova",
  "displayName": "Anna Petrova",
  "phoneNumber": null,
  "isActive": false,
  "sessionDir": null,
  "createdAt": "2026-03-31 08:10:00",
  "updatedAt": "2026-03-31 08:10:00"
}
```

#### Validation errors

- `400 { "error": "displayName is required" }`
- `400 { "error": "displayName must be a string" }`
- `400 { "error": "displayName cannot be empty" }`
- `400 { "error": "code is not allowed" }`
- `400 { "error": "phoneNumber is not allowed" }`
- `400 { "error": "isActive is not allowed" }`
- `400 { "error": "sessionDir is not allowed" }`

Точный текст ошибок можно стандартизировать иначе, но он должен быть:

- стабильным
- публичным
- предсказуемым для UI

#### Conflict / server errors

- `409` только если не удалось аллоцировать уникальный `code` после bounded retry
- `500 { "error": "Failed to create employee" }` для остальных неожиданных ошибок

### 6.2 DELETE /employees/:code

#### Request

- route param `code`

#### Success response

- status: `204`
- empty body

#### Business errors

- `404 { "error": "Employee not found: <code>" }`

#### Server error

- `500 { "error": "Failed to delete employee" }`

## 7. Code generation rules

### 7.1 Base slug

`code` должен строиться из `displayName` по такому алгоритму:

1. trim leading/trailing whitespace
2. collapse repeated internal whitespace to single spaces
3. transliterate Cyrillic to Latin
4. lowercase
5. replace whitespace and punctuation runs with `-`
6. remove characters outside `[a-z0-9-]`
7. collapse repeated hyphens
8. trim hyphens from both ends
9. если результат пустой, использовать fallback `user`

### 7.2 Examples

- `Anna` -> `anna`
- `Anna Petrova` -> `anna-petrova`
- `  Anna   Petrova  ` -> `anna-petrova`
- `Anna/Petrova` -> `anna-petrova`
- `Anna 2` -> `anna-2`
- `Anna (Sales)` -> `anna-sales`
- `!!!` -> `user`
- `Анна Петрова` -> `anna-petrova`

### 7.3 Uniqueness

Аллокация уникального `code`:

- первая попытка: `<base>`
- дальше: `<base>-2`, `<base>-3`, `<base>-4`

Примеры:

- если уже есть `anna`, новая `Anna` -> `anna-2`
- если есть `anna`, `anna-2`, новая `Anna` -> `anna-3`

### 7.4 Race handling

Даже если перед `create(...)` backend проверил `findByCode(...)`, нужно считать возможным race condition.

Требование:

- create flow должен делать bounded retry при unique conflict
- retry может быть реализован в controller или helper layer
- после исчерпания retry backend возвращает `409` или `500`, но не должен падать без контролируемого ответа

Рекомендуемый лимит: `5` попыток.

## 8. Storage and session rules

### 8.1 Create

При создании employee backend обязан явно передать в repository:

- `code`
- `displayName`
- `phoneNumber: null`
- `sessionDir: null`
- `isActive: false`

Нельзя полагаться на repository default `isActive = true`.

### 8.2 Delete

Delete flow должен работать в таком порядке:

1. загрузить employee по `code`
2. если employee не найден, вернуть `404`
3. запросить `sessionManager.getSessionHealth(code)`
4. если `hasRuntimeSession = true`, вызвать `sessionManager.stopSession(code)`
5. удалить persisted session storage
6. удалить employee через repository
7. за счет DB cascade удалить связанные `chats` и `chat_aliases`
8. вернуть `204`

Delete не должен блокироваться из-за существующих чатов.

Техническое требование:

- delete обязан опираться на SQLite foreign key cascade
- `PRAGMA foreign_keys = ON` должен оставаться включенным

### 8.3 Delete rollback

В текущем коде rollback после неудачного delete зависит от `existingEmployee.isActive`. Это недостаточно надежно.

Нужно изменить правило:

- если до удаления существовала runtime session
- и backend уже успел ее остановить
- и employee не был успешно удален

то backend должен попытаться восстановить runtime session независимо от persisted `isActive`

Причина:

- runtime session уже может существовать даже при `isActive = false`
- rollback должен восстанавливать предыдущее фактическое runtime state, а не только persisted flag

## 9. Изменения по слоям

### 9.1 Controller

Файл: `src/controllers/employees-controller.ts`

Нужно:

- заменить parser create payload на create-by-name contract
- добавить явную валидацию запрещенных полей
- вынести генерацию `code` в helper
- перестать вызывать `sessionManager.startSession(...)` внутри create route
- сохранить текущую serialize shape response
- убрать pre-delete блокировку по наличию чатов
- скорректировать delete rollback так, чтобы он ориентировался на runtime session state

### 9.2 Utils

Рекомендуется добавить helper, например:

- `src/utils/employee-code.ts`

В helper вынести:

- normalization
- transliteration
- slug generation
- unique candidate generation

### 9.3 Repository

Файл: `src/database/employees-repository.ts`

Минимально допустимые изменения:

- не менять schema
- не менять shape `EmployeeRecord`
- не переносить бизнес-логику create-by-name внутрь repository без необходимости

Repository может остаться почти без изменений, если controller явно передает:

- generated `code`
- `isActive: false`
- nullable fields as `null`

### 9.4 Schema

Файл: `src/database/schema.ts`

Schema migration не требуется.

Текущая таблица уже поддерживает нужный сценарий:

- `display_name` nullable
- `phone_number` nullable
- `session_dir` nullable
- `code` unique
- `chats.employee_id -> employees.id` через `ON DELETE CASCADE`
- `chat_aliases` также удаляются каскадно

## 10. Logging

Нужно сохранить существующий подход к server logging через `logger`.

Желательно логировать:

- успешное создание employee с `code`
- успешное удаление employee с `code`
- ошибки аллокации `code`
- ошибки rollback при delete

В логах не нужны новые PII-поля сверх уже используемых в проекте.

## 11. Test plan

### 11.1 Controller tests

Добавить или обновить тесты для `tests/controllers/employees-controller.test.ts`:

- create с `{ displayName: 'Anna' }` возвращает `201`
- create генерирует `code = 'anna'`
- create сохраняет `isActive = false`
- create сохраняет `phoneNumber = null`
- create сохраняет `sessionDir = null`
- create не вызывает `sessionManager.startSession`
- create trim-ит `displayName`
- create отвергает missing `displayName`
- create отвергает empty `displayName`
- create отвергает forbidden fields
- create генерирует suffixes `anna`, `anna-2`, `anna-3`
- create корректно транслитерирует Cyrillic
- create корректно обрабатывает unique conflict race
- delete успешно удаляет employee даже при наличии чатов
- delete каскадно удаляет связанные `chats` и `chat_aliases`
- delete останавливает runtime session перед удалением
- delete rollback перезапускает runtime session, если она была остановлена до ошибки, даже при `existingEmployee.isActive = false`

### 11.2 App tests

Добавить или обновить тесты для `tests/app.test.ts`:

- `POST /employees` принимает name-only payload
- `POST /employees` возвращает generated `code`
- `POST /employees` не стартует WhatsApp session
- `DELETE /employees/:code` удаляет employee с существующими чатами
- `DELETE /employees/:code` сохраняет ответы `204`, `404`, `500`

### 11.3 Repository tests

Отдельные repository-тесты нужны только если изменится repository behavior.

Если repository остается прежним, достаточно controller/app coverage.

## 12. Acceptance criteria

- backend принимает create employee без `code`, phone number и session data
- backend сам генерирует уникальный immutable `code`
- новый employee всегда создается с `isActive = false`
- create flow никогда не стартует WhatsApp session
- delete flow не блокируется из-за существующих чатов
- delete flow останавливает runtime session до удаления
- delete flow удаляет employee, его `chats`, `chat_aliases` и session storage
- если delete падает после остановки runtime session, backend пытается восстановить session
- существующие `GET /employees`, `GET /employees/:code`, `PATCH /employees/:code` не ломаются

## 13. Риски и замечания

- В проекте уже есть раздел в `todo.md` про рассинхрон `runtime session` и `employees.is_active`. Реализация delete rollback должна учитывать это прямо сейчас.
- Если позже потребуется backward compatibility со старым create contract, ее лучше вводить отдельно через временный compatibility mode, а не смешивать со стабильным новым API.
- Если продукт позже потребует editable naming rules или custom code, это должна быть отдельная задача, а не часть текущего scope.
