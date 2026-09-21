# Design: MCP Server para Bitbucket Cloud (MVP)

## Technical Approach

Tres capas sin dependencias cruzadas hacia arriba: `src/bitbucket` (cliente puro REST v2.0, recibe `workspace`/`repo` ya resueltos), `src/config` (perfiles + resolución de contexto, cero conocimiento de HTTP) y `src/tools` (único punto donde se unen: Zod → `resolveContext()` → cliente → envelope MCP). `src/index.ts` sólo hace bootstrap: valida env, construye cliente y store de perfiles, y los inyecta al registry (DI por parámetro, sin singletons ni imports de estado global — así el cliente es testeable con un `fetch` inyectado).

Auth confirmada: **API token con Basic Auth `email:api_token`** (app passwords deprecadas, deshabilitadas 9-jun-2026). Base URL `https://api.bitbucket.org/2.0`.

## Architecture Decisions

### Decision: Persistencia de perfiles → híbrido (archivo fuera del repo + env)

| Opción | Trade-off | Veredicto |
|---|---|---|
| Sólo env (`BITBUCKET_PROFILES` JSON inline) | Cero I/O y cero riesgo de versionar datos, pero **no cumple la spec**: `set_default_workspace` / `set_active_profile` deben persistir sin editar config a mano, y un proceso MCP no puede reescribir su propio entorno | Rechazada |
| Sólo archivo | Cumple persistencia, pero obliga a editar el archivo para un override puntual y complica correr dos clientes MCP contra workspaces distintos | Rechazada |
| **Híbrido** | Un archivo escribible para el estado de perfiles + env para credenciales y override por proceso. Costo: una capa más de precedencia que documentar | **Elegida** |

**Ubicación**: `${XDG_CONFIG_HOME:-~/.config}/bitbucket-mcp/profiles.json`, override con `BITBUCKET_PROFILES_PATH`. Vive **fuera del repo** por diseño, así el accidente de versionarlo no existe; `profiles.example.json` (datos ficticios) sí va en el repo, y `.gitignore` incluye `profiles.json` + `.env` por si alguien apunta `BITBUCKET_PROFILES_PATH` al cwd.

**Formato** (sin credenciales, restricción dura):

```json
{ "version": 1, "activeProfile": "acme",
  "profiles": { "acme": { "defaultWorkspace": "acme-ws", "defaultRepo": "api" } } }
```

**Seguridad**: directorio `0700`, archivo `0600` (se aplican en cada escritura, no sólo al crear). Escritura atómica: `write` a `profiles.json.tmp` + `rename`. Si el archivo no existe → estado vacío en memoria, no error. Si está corrupto → error accionable nombrando el path, sin sobreescribirlo.

### Decision: Precedencia con capa env (refinamiento de la spec)

`arg explícito > env override (BITBUCKET_WORKSPACE / BITBUCKET_REPO) > perfil activo del archivo > error accionable`. El env se inserta entre arg y perfil; cuando no está seteado, todos los escenarios de `profile-config/spec.md` se cumplen literalmente. **Divergencia declarada, no inventada**: la spec no contempla esta capa; si el equipo la rechaza, se elimina sin tocar cliente ni tools.

### Decision: Registro de tools con SDK oficial + metadata readOnly

`registry.ts` exporta `ToolDefinition[]` con `{ name, description, inputSchema (ZodRawShape), readOnly, mutatesLocalConfig, handler }`. `index.ts` itera y llama `server.registerTool(name, { description, inputSchema, annotations }, handler)`.

Mapeo a annotations del SDK: `readOnlyHint = readOnly && !mutatesLocalConfig`; `openWorldHint = true` sólo para tools que tocan Bitbucket; `destructiveHint = false` en todo el MVP. Los tools de config son `readOnly: true` (spec: "no escriben en Bitbucket") pero `mutatesLocalConfig: true`, así el flag de la spec y el hint del protocolo no se contradicen.

### Decision: Límite de `get_pr_diff` = 100.000 caracteres

Pendiente de la spec, resuelto: default **100.000 caracteres** (~25k tokens, cabe en cualquier cliente MCP), parámetro opcional `maxChars` con tope duro **400.000**. Truncado en el último `\n` anterior al límite (nunca parte una línea). Respuesta siempre `{ diff, truncated: boolean, returnedChars, hint? }`; con `truncated: true` el `hint` sugiere `get_pr_diff` con `maxChars` mayor o usar diffstat. El diff es texto plano **sin paginar** y responde 302 (fetch lo sigue solo); `redirect: "follow"` explícito para no depender del default.

### Decision: Adoptar vitest en este change (scope mínimo)

`strict_tdd: false` y no hay runner. Diferirlo deja sin red la lógica más frágil y pura del sistema (precedencia de resolución, paginación, mapeo de errores). Se adopta **vitest** (recomendado en `openspec/config.yaml`, TS/ESM sin config), acotado a unit tests de `config/context.ts`, `bitbucket/pagination.ts` y `bitbucket/errors.ts` con `fetch` inyectado. Sin gate de coverage, sin tests de integración: la verificación E2E es manual desde Claude Code contra dos workspaces reales. Alternativa `node:test` (cero devDependencies) se descarta por ergonomía de mocking.

## Data Flow

```
MCP client ──call──▶ tools/*.ts ──▶ config/context.resolve() ──▶ config/profiles (archivo+env)
                         │                  │
                         │                  └─(falla)─▶ error accionable, SIN request HTTP
                         └──(ws,repo)──▶ bitbucket/client ──▶ pagination ──▶ api.bitbucket.org
                                               └─(HTTP err)─▶ bitbucket/errors ──▶ envelope MCP
```

Paginación: el cliente sigue el campo `next` (URL completa, **nunca** se arma `?page=N` a mano) hasta agotarlo, con `pagelen=100` en el primer request y un tope de páginas para no colgar el proceso.

Errores y retry: 401/403 → `AuthError` (credenciales redactadas siempre); 404 → `NotFoundError` con el recurso; 429 y 555 → backoff exponencial genérico (3 reintentos, base 1s, jitter, honra `Retry-After` **si viene** — no se asume que exista ni se leen headers `X-RateLimit-*` como contrato); agotado → `RateLimitError` / `UpstreamTimeoutError` (este último sugiere diffstat o `maxChars` menor). Red → `NetworkError`.

## File Changes

| File | Action | Description |
|---|---|---|
| `src/index.ts` | Create | Bootstrap: valida env (fail-fast), arma deps, registra tools, stdio transport |
| `src/bitbucket/{client,pagination,errors,types}.ts` | Create | Cliente puro, traversal de `next`, errores tipados, tipos de respuesta |
| `src/config/{profiles,context,types}.ts` | Create | Store de archivo (atómico, 0600), resolución con precedencia, tipos |
| `src/tools/registry.ts` | Create | `ToolDefinition[]` + mapeo a annotations MCP |
| `src/tools/{config,workspaces,repositories,branches,pull-requests}.ts` | Create | Tools por dominio |
| `package.json`, `tsconfig.json`, `vitest.config.ts` | Create | ESM, Node >= 20, target ES2022 |
| `.env.example`, `profiles.example.json`, `.gitignore`, `README.md` | Create | Config, seguridad, read vs write |

## Interfaces / Contracts

```ts
type ToolDefinition<S extends ZodRawShape> = {
  name: string; description: string; inputSchema: S;
  readOnly: boolean;            // no escribe en Bitbucket (contrato de la spec)
  mutatesLocalConfig?: boolean; // escribe profiles.json
  handler: (args: objectOutputType<S, ZodTypeAny>, deps: Deps) => Promise<ToolResult>;
};
type Deps = { bitbucket: BitbucketClient; profiles: ProfileStore; resolve: ContextResolver };
```

## Scopes requeridos (API token)

| Tools | Scope |
|---|---|
| `list_workspaces` | account / read:workspace |
| repos y branches | repository (read) |
| PRs read, commits, diff, comments | pullrequest (read) |
| `create_pr_comment`, `create_pull_request`, `update_pull_request` | pullrequest:write |

Verificar el nombre granular exacto al generar el token en Atlassian (los scopes clásicos y los granulares conviven).

## Testing Strategy

| Layer | What | How |
|---|---|---|
| Unit | Precedencia, paginación, mapeo de errores, truncado de diff | vitest + `fetch` inyectado |
| Integration | — | Diferido (no hay fixtures de la API) |
| E2E | Tools desde Claude Code contra 2 workspaces reales | Manual, checklist en README |

## Migration / Rollout

No aplica (greenfield). Degradación posible: si el archivo de perfiles da problemas, se cae a modo env-only sin tocar `src/bitbucket`.

## Open Questions

- [ ] Nombre granular exacto de los scopes del API token (se confirma al crearlo, no bloquea el diseño).
- [ ] Si el equipo acepta la capa de override por env en la precedencia (refinamiento sobre `profile-config/spec.md`).
