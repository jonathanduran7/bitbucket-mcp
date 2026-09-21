# Proposal: MCP Server para Bitbucket Cloud (MVP)

## Intent

No existe hoy una forma de consultar y operar Bitbucket Cloud desde clientes MCP (Claude Code, Codex) sin clonar repos ni pegar datos a mano. La cuenta del usuario abarca **múltiples workspaces**, por lo que un server con workspace hardcodeado no sirve. Necesitamos un MCP Server en TypeScript sobre la API REST v2.0 que exponga **tools semánticas** (no un `bitbucket_request` genérico), con resolución de workspace por perfil y separación explícita read-only / write.

## Scope

### In Scope
- Servidor MCP (stdio) con MCP SDK oficial + Zod para input schemas.
- Cliente Bitbucket: auth por `BITBUCKET_EMAIL` / `BITBUCKET_TOKEN` (env), errores tipados, paginación (`values`/`page`/`pagelen`/`size`/`next`), manejo de rate limit.
- Capa config/context: perfiles (nombre, workspace default, repo default opcional), perfil activo, resolución `arg explícito > perfil activo > error accionable`.
- Tools config (locales): `get_active_profile`, `list_profiles`, `set_active_profile`, `set_default_workspace`, `clear_default_workspace`.
- Tools read: `list_workspaces`, `list_repositories`, `get_repository`, `list_branches`, `get_branch`, `list_pull_requests`, `get_pull_request`, `get_pr_commits`, `get_pr_diff`, `list_pr_comments`.
- Tools write: `create_pr_comment`, `create_pull_request`, `update_pull_request`.
- `.env.example`, `profiles.example.json`, README (persistencia, seguridad, read vs write).

### Out of Scope
- `approve` / `decline` / `merge` de PRs; issues, pipelines, webhooks, Bitbucket Server/DC.
- Tool genérica de request arbitrario; caché/persistencia de datos de Bitbucket; OAuth interactivo.

## Capabilities

### New Capabilities
- `mcp-server-runtime`: bootstrap, registro de tools, transporte stdio, envelope de errores, marcado read/write.
- `bitbucket-client`: auth, HTTP sobre `fetch`, paginación, mapeo de errores y rate limit.
- `profile-config`: perfiles, persistencia, perfil activo, resolución de workspace/repo.
- `workspace-discovery`: `list_workspaces`.
- `repository-browsing`: repositorios y branches.
- `pull-request-management`: lectura y escritura de PRs y comentarios.

### Modified Capabilities
- None (proyecto greenfield, `openspec/specs/` vacío).

## Approach

Arquitectura en capas, la propuesta del usuario con dos ajustes:

1. **`src/bitbucket/`** — cliente puro: recibe `workspace` y `repo` **ya resueltos**. NO conoce perfiles ni workspace activo (requisito explícito).
2. **`src/config/`** — `profiles.ts` (carga/persistencia), `context.ts` (resuelve perfil → workspace/repo, valida). Desacoplado del cliente.
3. **`src/tools/`** — cada tool: schema Zod → `resolveContext()` → cliente → salida MCP. Es la única capa que une config y cliente.

Ajustes propuestos sobre el árbol original:
- `src/bitbucket/errors.ts` para no mezclar mapeo de errores dentro de `client.ts`.
- `src/tools/registry.ts` con metadata `readOnly: true|false` por tool, para que la separación read/write sea dato y no convención.
- Sin dependencias extra más allá de `@modelcontextprotocol/sdk` y `zod`.

Entrega incremental: estructura → server → cliente → config → resolución → `list_workspaces` → tools de perfil → `set_default_workspace` → `list_repositories` → verificación desde cliente MCP real → branches → PRs.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/index.ts` | New | Bootstrap del server MCP |
| `src/bitbucket/` | New | `client.ts`, `pagination.ts`, `errors.ts`, `types.ts` |
| `src/config/` | New | `profiles.ts`, `context.ts`, `types.ts` |
| `src/tools/` | New | `registry.ts` + módulos por dominio |
| `package.json`, `tsconfig.json` | New | Setup TS/Node/ESM |
| `.env.example`, `profiles.example.json`, `README.md` | New | Config y documentación |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Endpoints/parámetros de la API asumidos de memoria | High | **No verificados en esta fase**: esta sesión no tuvo acceso a WebFetch/WebSearch. `sdd-design` y `sdd-apply` DEBEN validar cada endpoint (`/workspaces`, `/repositories/{workspace}`, `/repositories/{ws}/{repo}/refs/branches`, `/repositories/{ws}/{repo}/pullrequests`) contra la doc oficial vigente antes de implementar |
| Mecanismo de persistencia de perfiles sin decidir | High | Decisión formal en `sdd-design`: env-only vs archivo JSON local vs híbrido. Criterio: simple, seguro (sin credenciales en el archivo), mantenible |
| Credenciales filtradas en logs o en `profiles.json` | Med | Credenciales SOLO por env; el archivo de perfiles guarda únicamente workspace/repo. Redacción obligatoria en logs y errores |
| Sin test runner configurado | Med | `sdd-design` define si se adopta vitest en este change o se difiere; hasta entonces, verificación manual desde cliente MCP |
| `get_pr_diff` puede devolver payloads enormes | Med | Límite de tamaño + truncado explícito; evaluar `diffstat` como alternativa |
| Diferencias entre lo pedido y lo que permite la API | Med | Señalarlas explícitamente en specs/design; prohibido inventar workarounds |
| Rate limiting de Bitbucket Cloud | Low | Backoff con `Retry-After`, error tipado y accionable |

## Rollback Plan

Change greenfield: no hay código existente que romper. Rollback = descartar el branch/PR del slice o revertir sus commits. Cada slice del plan incremental es autónomo y revertible por separado. Si se adopta persistencia en archivo y resulta problemática, se puede degradar a modo env-only sin tocar el cliente Bitbucket (está desacoplado por diseño).

## Dependencies

- Cuenta Bitbucket Cloud con API token válido y acceso a los workspaces objetivo.
- Node.js >= 20 (`fetch` nativo estable).
- `@modelcontextprotocol/sdk`, `zod`.
- Verificación de la doc oficial de Bitbucket Cloud v2.0 antes de implementar cada endpoint.

## Success Criteria

- [ ] Todas las tools del MVP registradas, con schema Zod y marcadas `readOnly` o `write`.
- [ ] `workspace` explícito tiene prioridad sobre el default del perfil; sin ninguno, el error indica exactamente qué configurar.
- [ ] Cambiar perfil activo y workspace default funciona sin tocar código ni reiniciar la config a mano.
- [ ] Listados paginados devuelven resultados completos, no solo la primera página.
- [ ] Credenciales nunca aparecen en logs, errores ni archivos de config.
- [ ] Las tools responden correctamente desde un cliente MCP real (Claude Code) contra al menos dos workspaces distintos.
- [ ] README documenta dónde vive la config, su formato y la separación read/write.
