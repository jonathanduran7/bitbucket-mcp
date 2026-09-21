# Tasks: MCP Server para Bitbucket Cloud (MVP)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~2000-2300 (greenfield: ~20 source files + 3 test files + README) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes (by volume) — overridden by explicit user choice |
| Suggested split | See "Alternative work-unit split" below, kept for reference only |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: size-exception
400-line budget risk: High

**Nota**: el volumen estimado (~2000+ líneas) supera largamente el budget de revisión de 400 líneas. El usuario definió explícitamente `single-pr` por ser un proyecto chico/greenfield con un único responsable de delivery — es una decisión válida, pero requiere `size:exception` registrado antes de `sdd-apply` según el guard de `delivery_strategy: single-pr`. Alternativa si se reconsidera: dividir en 3-4 PRs siguiendo las fases de abajo (Foundation+Runtime+Client → Config+Resolution → Tools read-only → Tools write+Tests+Docs).

### Alternative work-unit split (referencia, no aplica si se acepta size:exception)

| Unit | Goal | Fases incluidas |
|------|------|------------------|
| 1 | Runtime + cliente Bitbucket | Fases 1-3 |
| 2 | Config/perfiles + resolución + tools de perfil/workspace | Fases 4-8, 10 |
| 3 | Tools de lectura (repos, branches, PRs read) | Fases 9, 11, 12 (read) |
| 4 | Tools de escritura + registry + tests + docs | Fase 12 (write), 13-16 |

## Phase 1: Project Foundation

- [x] 1.1 Crear `package.json` (ESM, `"type": "module"`, Node >=20, deps `@modelcontextprotocol/sdk` + `zod`, devDeps `typescript`, `vitest`, `@types/node`)
- [x] 1.2 Crear `tsconfig.json` (target ES2022, module NodeNext, strict)
- [x] 1.3 Crear estructura de carpetas `src/bitbucket/`, `src/config/`, `src/tools/`
- [x] 1.4 Crear `.gitignore` (`profiles.json`, `.env`, `node_modules`, `dist`)
- [x] 1.5 Crear `.env.example` (`BITBUCKET_EMAIL`, `BITBUCKET_TOKEN`, `BITBUCKET_WORKSPACE`, `BITBUCKET_REPO`, `BITBUCKET_PROFILES_PATH`)

## Phase 2: MCP Server Bootstrap

- [x] 2.1 `src/index.ts`: validar env fail-fast (`BITBUCKET_EMAIL`/`BITBUCKET_TOKEN` requeridas, error accionable nombrando la variable) — spec `mcp-server-runtime`
- [x] 2.2 `src/index.ts`: instanciar `BitbucketClient` + `ProfileStore` + `ContextResolver` por DI (sin singletons), configurar transporte stdio
- [x] 2.3 `src/index.ts`: iterar `registry.ts` y llamar `server.registerTool(name, {description, inputSchema, annotations}, handler)` con mapeo `readOnlyHint = readOnly && !mutatesLocalConfig`, `openWorldHint`, `destructiveHint: false` (registry vacío en este batch — ver nota de desvío)

## Phase 3: Bitbucket Client

- [x] 3.1 `src/bitbucket/types.ts`: tipos de respuesta (lista paginada, workspace, repo, branch, PR, comment, commit)
- [x] 3.2 `src/bitbucket/errors.ts`: errores tipados `AuthError`, `NotFoundError`, `RateLimitError`, `UpstreamTimeoutError`, `NetworkError`, `ConfigError` — garantizar que ningún constructor acepte/exponga token o email
- [x] 3.3 `src/bitbucket/pagination.ts`: traversal completo de `next` (URL completa, nunca `?page=N` manual), `pagelen=100` inicial, tope de páginas de seguridad
- [x] 3.4 `src/bitbucket/client.ts`: Basic Auth `email:token` sobre `https://api.bitbucket.org/2.0`, `ConfigError` si falta `BITBUCKET_TOKEN` antes de llamar a `fetch`
- [x] 3.5 `src/bitbucket/client.ts`: backoff en 429/5xx (3 reintentos, base 1s, jitter, honra `Retry-After` si viene), `redirect: "follow"` explícito para el endpoint de diff

## Phase 4: Profile Configuration Layer

- [x] 4.1 `src/config/types.ts`: tipos `Profile`, `ProfilesFile` (`version`, `activeProfile`, `profiles`)
- [x] 4.2 `src/config/profiles.ts`: resolver path (`${XDG_CONFIG_HOME:-~/.config}/bitbucket-mcp/profiles.json`, override `BITBUCKET_PROFILES_PATH`)
- [x] 4.3 `src/config/profiles.ts`: lectura — archivo inexistente → estado vacío en memoria (no error); archivo corrupto → error accionable nombrando el path, sin sobreescribir
- [x] 4.4 `src/config/profiles.ts`: escritura atómica (`profiles.json.tmp` + `rename`), `chmod 0600` archivo / `0700` directorio en cada escritura

## Phase 5: Context Resolution

- [x] 5.1 `src/config/context.ts`: `resolveWorkspace`/`resolveRepo` con precedencia de 4 niveles (arg explícito > env override `BITBUCKET_WORKSPACE`/`BITBUCKET_REPO` > perfil activo > error) — cubrir los 4 escenarios de `profile-config/spec.md`
- [x] 5.2 `src/config/context.ts`: error accionable nombrando el valor faltante y la tool para fijarlo; sin request HTTP en el path de error

## Phase 6: list_workspaces

- [x] 6.1 `src/tools/workspaces.ts`: `list_workspaces` (sin argumento `workspace`, paginación completa, mensaje de lista vacía sin error)

## Phase 7: Profile Read Tools

- [x] 7.1 `src/tools/config.ts`: `list_profiles` (lista vacía con mensaje, sin llamada a Bitbucket)
- [x] 7.2 `src/tools/config.ts`: `get_active_profile` (resultado claro de "sin perfil activo", no excepción)

## Phase 8: Profile Write Tools

- [x] 8.1 `src/tools/config.ts`: `set_active_profile` (validar existencia, error accionable listando perfiles disponibles si no existe)
- [x] 8.2 `src/tools/config.ts`: `set_default_workspace` (persistir en perfil activo/especificado)
- [x] 8.3 `src/tools/config.ts`: `clear_default_workspace` (idempotente cuando no hay default seteado)

## Phase 9: Repository Tools

- [x] 9.1 `src/tools/repositories.ts`: `list_repositories` (resolver `workspace`, paginación completa)
- [x] 9.2 `src/tools/repositories.ts`: `get_repository` (resolver `workspace`, requerir `repo`, error "not found" nombrando workspace+repo)

## Phase 10: Manual Smoke Test (checkpoint intermedio)

- [x] 10.1 Documentar checklist de smoke test manual (borrador que luego va al README): correr el server desde Claude Code, ejercitar `list_workspaces`, `list_profiles`, `get_active_profile`, `set_active_profile`, `set_default_workspace`, `clear_default_workspace`, `list_repositories`, `get_repository` — ver `openspec/changes/bitbucket-mcp-server/smoke-test-checklist.md`
- [ ] 10.2 Ejecutar el checklist manualmente contra al menos 2 workspaces reales y registrar resultado antes de avanzar a Fase 11 — **BLOQUEADO: requiere un humano con credenciales reales de Bitbucket y acceso a 2 workspaces; un agente automatizado no puede completar esta task.**

## Phase 11: Branches

- [x] 11.1 `src/tools/branches.ts`: `list_branches` (requerir `repo`, error de validación si falta, paginación completa)
- [x] 11.2 `src/tools/branches.ts`: `get_branch` (requerir `repo`+`branch`, error "not found" nombrando la branch)

## Phase 12: Pull Requests

- [x] 12.1 `src/tools/pull-requests.ts`: `list_pull_requests` (filtro `state`, default open, paginación completa)
- [x] 12.2 `src/tools/pull-requests.ts`: `get_pull_request` (error "not found" nombrando el PR id)
- [x] 12.3 `src/tools/pull-requests.ts`: `get_pr_commits` (paginación completa)
- [x] 12.4 `src/tools/pull-requests.ts`: `get_pr_diff` (default 100k chars, `maxChars` opcional tope 400k, truncar en el último `\n`, respuesta `{diff, truncated, returnedChars, hint?}`, `redirect: "follow"`)
- [x] 12.5 `src/tools/pull-requests.ts`: `list_pr_comments` (inline y general, paginación completa)
- [x] 12.6 `src/tools/pull-requests.ts`: `create_pr_comment` (validar contenido no vacío antes de llamar a Bitbucket)
- [x] 12.7 `src/tools/pull-requests.ts`: `create_pull_request` (validar source/destination branch + título, error tipado si falta una branch)
- [x] 12.8 `src/tools/pull-requests.ts`: `update_pull_request` (solo título/descripción/destination/reviewers, rechazar merge/approve/decline con error explícito)

## Phase 13: Tool Registry

- [x] 13.1 `src/tools/registry.ts`: tipo `ToolDefinition` + array agregando todos los módulos de tools, con `readOnly`/`mutatesLocalConfig` por tool (config tools: `readOnly: true`, `mutatesLocalConfig: true` donde aplique)

## Phase 14: Unit Tests (vitest)

- [x] 14.1 `vitest.config.ts`: setup mínimo (TS/ESM, sin config adicional)
- [x] 14.2 `src/config/context.test.ts`: cubrir los 4 escenarios de precedencia (arg > env > perfil > error) del spec `profile-config`
- [x] 14.3 `src/bitbucket/pagination.test.ts`: traversal multi-página y corte en página única, con `fetch` inyectado
- [x] 14.4 `src/bitbucket/errors.test.ts`: mapeo 401/403/404/429/5xx/network y verificación de que no se filtran credenciales

## Phase 15: Documentation

- [x] 15.1 `README.md`: env vars requeridas, ubicación y formato de `profiles.json`, cómo cambiar de perfil activo, ejemplos de uso desde un cliente MCP, tabla read-only vs write tools separada claramente

## Phase 16: Example Config

- [x] 16.1 `profiles.example.json` con datos ficticios siguiendo el formato documentado (`version`, `activeProfile`, `profiles`)
