# Authentication Specification: Single Shared Password + MD5 Check

## 1. Goal

Нужно добавить в продукт простой MVP-механизм аутентификации:

- в системе есть один логический пользователь
- пользователь вводит один общий пароль
- backend проверяет пароль на каждом запросе через MD5
- если хотя бы один защищенный запрос не проходит проверку, frontend возвращает пользователя на страницу входа и требует повторный ввод пароля

Спецификация покрывает и backend, и frontend, потому что здесь важен единый end-to-end flow.

## 2. Current State

Сейчас:

- backend не защищен паролем
- frontend открывает dashboard сразу
- часть frontend-запросов идет через Next.js proxy routes
- часть данных читается server-side напрямую из backend через `frontend/src/lib/*`

Это важно для дизайна auth flow:

- если хранить пароль только в browser state, server-side rendering не сможет читать защищенные данные
- значит frontend должен хранить пароль так, чтобы его могли использовать и proxy routes, и server-side loaders

## 3. Scope

В scope входит:

- один shared password на весь продукт
- backend-проверка auth на каждом защищенном запросе
- login screen на frontend
- хранение текущего auth state на frontend
- redirect на страницу входа после любого `401 Unauthorized`
- backend endpoint для проверки введенного пароля
- обновление proxy routes и server-side data loaders
- тесты на auth flow

Вне scope:

- multi-user accounts
- roles / permissions
- JWT / refresh tokens
- password reset
- brute-force protection
- переход на безопасный password hashing algorithm вместо MD5

## 4. Target Auth Model

### 4.1 Shared password

Система использует один общий пароль для всего приложения.

Backend не хранит raw password в базе. Вместо этого backend получает raw password из environment:

- `AUTH_PASSWORD=<raw password>`

Пример:

```env
AUTH_PASSWORD=0000
```

Пароль в env хранится не в виде готового hash. MD5 должен вычисляться внутри backend-кода автоматически во время каждой проверки.

### 4.2 Request-level validation

Каждый защищенный запрос к backend должен содержать header:

```text
X-User-Password: <raw password>
```

Backend для каждого такого запроса обязан:

1. взять значение `X-User-Password`
2. взять raw password из `AUTH_PASSWORD`
3. вычислить `md5(receivedPassword)`
4. вычислить `md5(configuredEnvPassword)`
5. пропустить запрос дальше только если значения совпали

Если header отсутствует, пустой или hash не совпадает, backend возвращает `401 Unauthorized`.

### 4.3 Why password is stored in an HTTP-only cookie

Из-за текущей архитектуры Next.js пароль нельзя держать только в client memory:

- `frontend/src/app/page.tsx` и employee pages читают данные server-side
- server-side код не видит `sessionStorage`

Поэтому для MVP frontend должен хранить введенный пароль в HTTP-only cookie, чтобы:

- server-side loaders могли подставлять его в backend header
- proxy routes могли подставлять его в backend header
- пароль не был доступен обычному browser JavaScript после успешного логина

Cookie для MVP:

- name: `wm_auth_password`
- `HttpOnly`
- `SameSite=Lax`
- `Path=/`
- `Secure=true` в production

## 5. User Flow

### 5.1 Login page

Root route `/` становится auth gate:

- если у пользователя нет сохраненного пароля, показывается форма входа
- если пароль уже есть и он валиден, показывается обычный dashboard
- если пароль есть, но backend отвечает `401`, frontend показывает форму входа снова

Форма входа содержит только:

- одно поле `Password`
- кнопку `Log in`

### 5.2 Login submit

Login flow:

1. пользователь вводит пароль на `/`
2. frontend отправляет его в same-origin route `POST /api/auth/login`
3. Next.js route вызывает backend `GET /auth/check` с header `X-User-Password`
4. если backend отвечает `204`, Next.js route сохраняет cookie `wm_auth_password`
5. frontend показывает dashboard
6. если backend отвечает `401`, cookie не создается, форма показывает ошибку `Invalid password`

Backend не создает session. Вся схема остается stateless со стороны backend: пароль проверяется заново на каждом запросе.

### 5.3 Protected requests after login

После успешного входа:

- все frontend proxy routes читают `wm_auth_password` из cookie и подставляют `X-User-Password` в запрос к backend
- все server-side data loaders делают то же самое
- браузер не ходит в backend напрямую

### 5.4 Global logout action

Во всей защищенной части приложения должна быть доступна кнопка logout.

Требования:

- кнопка видна на всех защищенных экранах
- расположение: левый нижний угол viewport
- кнопка не показывается на экране логина
- клик по кнопке вызывает `POST /api/auth/logout`
- после logout frontend удаляет auth cookie и возвращает пользователя на `/`
- после logout dashboard и другие защищенные страницы больше не должны рендериться до повторного ввода пароля

### 5.5 Auth failure after at least one bad request

Если любой защищенный backend request возвращает `401`, это означает, что текущий auth state больше невалиден.

Требуемое поведение frontend:

- прекратить текущий flow
- не показывать частично успешный результат
- вернуть пользователя на `/`
- снова показать форму ввода пароля

Для MVP достаточно считать любой `401` эквивалентом "нужно перелогиниться".

## 6. Backend Requirements

### 6.1 Protected routes

Рабочее допущение для реализации: auth middleware должен покрывать все backend business routes, кроме двух публичных исключений:

- `GET /health`
- `GET /auth/check`

Под защиту должны попадать все текущие business endpoints, включая:

- `GET /employees`
- `POST /employees`
- `GET /employees/:code`
- `PATCH /employees/:code`
- `DELETE /employees/:code`
- `GET /employees/:code/chats`
- `GET /employees/:code/chats/:chatRecordId/messages`
- `GET /employees/:code/health`
- `GET /employees/:code/whatsapp-session`
- `POST /employees/:code/whatsapp-session`
- другие будущие employee/chats/messages/whatsapp-session endpoints

То есть `employee health` endpoint не считается публичным health probe. Публичным health probe остается только корневой `GET /health`.

### 6.2 Auth check endpoint

Нужен новый backend endpoint:

- `GET /auth/check`

Поведение:

- route использует ту же auth-проверку, что и остальные protected routes
- при валидном `X-User-Password` возвращает `204 No Content`
- при невалидном или отсутствующем header возвращает `401`

Этот endpoint нужен только для login verification. Он не создает session и не возвращает token.

### 6.3 Unauthorized response contract

При auth failure backend должен возвращать:

- status: `401`
- body:

```json
{
  "error": "Unauthorized"
}
```

Требования:

- один стабильный ответ для missing password и wrong password
- backend не раскрывает, что именно не совпало
- backend не делает HTTP redirect

### 6.4 Environment validation

Backend должен fail-fast при старте, если:

- `AUTH_PASSWORD` не задан
- `AUTH_PASSWORD` пустой после `trim()`

Backend не должен принимать отдельный `AUTH_PASSWORD_MD5` из env. Источник истины для MVP только raw password в `AUTH_PASSWORD`.

### 6.5 Logging rules

Backend может логировать только факт auth failure, но не сам пароль и не его hash из request.

Допустимо логировать:

- route
- method
- client IP, если доступно
- timestamp

Недопустимо логировать:

- raw password
- request header `X-User-Password`

## 7. Frontend Requirements

### 7.1 Root route behavior

Route `/` должен работать как authentication gate:

- без валидного auth state показывает login screen
- с валидным auth state показывает текущий dashboard

Это позволяет сохранить существующий URL dashboard и одновременно выполнить требование "редирект на главную страницу входа".

### 7.2 New same-origin auth routes

Нужно добавить:

- `POST /api/auth/login`
- `POST /api/auth/logout`

#### `POST /api/auth/login`

Request body:

```json
{
  "password": "secret"
}
```

Поведение:

- валидирует, что `password` передан и не пуст после `trim()`
- вызывает backend `GET /auth/check` с header `X-User-Password`
- на `204` сохраняет `wm_auth_password` cookie и возвращает `204`
- на `401` не сохраняет cookie и возвращает `401 { "error": "Invalid password" }`
- на network/proxy failure возвращает `502`

#### `POST /api/auth/logout`

Поведение:

- очищает cookie `wm_auth_password`
- возвращает `204`

### 7.3 Global logout UI

Нужно добавить общий UI-компонент logout action для всей защищенной части frontend.

Требования:

- компонент рендерится в общем layout для защищенных страниц, а не копируется в каждую страницу отдельно
- визуальная позиция: fixed в левом нижнем углу
- label: `Log out` или `Logout`
- click flow:
  - вызвать `POST /api/auth/logout`
  - после успешного ответа выполнить navigation на `/`
  - даже если logout endpoint недоступен, frontend должен локально перейти на `/` и больше не пытаться использовать старый auth state

### 7.4 Existing proxy routes

Все existing proxy routes должны использовать общий helper, который:

- читает `wm_auth_password` из cookie
- если cookie нет, сразу возвращает `401`
- если cookie есть, прокидывает `X-User-Password` в backend request
- сохраняет backend status code без подмены

Это касается как минимум:

- `frontend/src/app/api/employees/proxy.ts`
- employee detail proxy routes
- chats proxy routes
- chat messages proxy routes
- будущих protected proxy routes

### 7.5 Server-side data loading

Текущие server-side loaders тоже должны использовать общий authenticated fetch helper.

Требование:

- прямой `fetch(...backend...)` без auth header больше не допускается для protected data

Это затрагивает как минимум:

- `frontend/src/lib/employees.ts`
- `frontend/src/lib/chats.ts`

Ожидаемое поведение:

- если server-side fetch получает `401`, страница не пытается рендерить protected content
- для `/employees/*` routes выполняется redirect на `/`
- для `/` route рендерится login screen вместо dashboard

### 7.6 UI behavior on `401`

Если frontend получает `401` в client-side action:

- create user
- delete user
- edit employee
- start/stop WhatsApp session
- любой другой action

то frontend обязан:

- считать текущую авторизацию потерянной
- скрыть текущий action result
- вернуть пользователя на `/`
- потребовать повторный ввод пароля

`500`, `502` и другие не-auth ошибки не должны автоматически разлогинивать пользователя.

## 8. Suggested Implementation Shape

### 8.1 Backend

Рекомендуемые изменения:

- new `src/middleware/auth.ts`
- new `src/routes/auth.ts`
- update `src/utils/env.ts`
- update `src/app.ts`
- update backend tests

`auth.ts` должен экспортировать middleware примерно такого смысла:

- read `X-User-Password`
- reject missing/empty password with `401`
- compute MD5 through Node `crypto`
- compute MD5 for configured `AUTH_PASSWORD`
- compare two MD5 values
- call `next()` only on success

### 8.2 Frontend

Рекомендуемые изменения:

- new `frontend/src/app/api/auth/login/route.ts`
- new `frontend/src/app/api/auth/logout/route.ts`
- new shared auth helper under `frontend/src/lib/`
- update `frontend/src/app/page.tsx`
- update protected frontend layout to host a persistent logout button
- update `frontend/src/ui/Pages/Home/Home.tsx`
- update `frontend/src/ui/Pages/Employee/Employee.tsx`
- update `frontend/src/app/api/employees/proxy.ts`

Желательно, чтобы вся логика чтения cookie и подстановки `X-User-Password` жила в одном месте, а не была размазана по route handlers и loaders.

## 9. Error Cases

### 9.1 Login errors

- empty password -> `400 { "error": "Password is required" }`
- wrong password -> `401 { "error": "Invalid password" }`
- backend unreachable -> `502 { "error": "Unable to reach auth endpoint" }`

### 9.2 Protected request errors

- missing auth cookie on frontend proxy -> `401 { "error": "Unauthorized" }`
- missing `X-User-Password` on backend -> `401 { "error": "Unauthorized" }`
- wrong password on backend -> `401 { "error": "Unauthorized" }`

### 9.3 Health check

`GET /health` не должен требовать пароль, иначе инфраструктурные probes и локальная диагностика сломаются.

## 10. Test Plan

Нужно добавить или обновить тесты для следующих сценариев:

- backend стартует с валидным `AUTH_PASSWORD`
- backend не стартует без `AUTH_PASSWORD`
- backend не стартует с пустым `AUTH_PASSWORD`
- `GET /health` доступен без auth
- `GET /auth/check` возвращает `204` при корректном пароле
- `GET /auth/check` возвращает `401` при неверном пароле
- `GET /employees` возвращает `401` без header
- protected routes проходят с корректным `X-User-Password`
- `POST /api/auth/login` сохраняет cookie при `204`
- `POST /api/auth/login` не сохраняет cookie при `401`
- root page показывает login screen без валидной авторизации
- root page показывает dashboard при валидной авторизации
- защищенные страницы показывают logout button в левом нижнем углу
- нажатие logout button очищает auth state и возвращает на `/`
- employee page redirect-ит на `/` при `401`
- client-side protected action redirect-ит на `/` при `401`
- non-auth backend errors не вызывают logout

## 11. Acceptance Criteria

- Пользователь видит форму ввода пароля на `/`, если он еще не авторизован.
- После корректного ввода пароля frontend может читать dashboard и employee pages.
- Каждый защищенный backend request проходит через проверку `MD5(receivedPassword) === MD5(AUTH_PASSWORD)`.
- Любой неверный или отсутствующий пароль дает `401 Unauthorized`.
- После любого `401` пользователь возвращается на `/` и должен снова ввести пароль.
- Во всей защищенной части приложения есть logout button в левом нижнем углу.
- Нажатие logout удаляет сохраненный пароль и возвращает пользователя на `/`.
- `GET /health` остается публичным.

## 12. Known Limitations

Эта схема соответствует MVP-требованию, но у нее есть ограничения:

- MD5 не является безопасным password hashing algorithm
- backend фактически проверяет один shared secret, а не пользовательскую session
- raw password хранится на frontend side в HTTP-only cookie, чтобы сохранить SSR flow

Это допустимо только как временное внутреннее решение. Для production-grade интернета следующей версией должны стать:

- salted password hashing на backend
- полноценная session/cookie auth или token-based auth
- rate limiting / lockout
