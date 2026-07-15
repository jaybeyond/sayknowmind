# SayKnowMind / BI multi-project task bridge

## Product behavior

BI remains the single task data source. SayKnowMind does not copy BI tasks into
`work_items`; its task API reads and writes the same BI task records.

- A Mind user sees every BI project they own or that has been shared with them.
- The top project selector filters the board. Creating from "all projects"
  requires an explicit project; creating inside one project keeps that project
  fixed.
- Task cards, list rows, and details show the BI project.
- Assignee choices come only from the selected task's BI project.
- BI mode offers "all" and "personal" task scope. "Team" remains available only
  for local Mind tasks.
- Mind-only `paused` and `no-priority` values are hidden in BI mode and
  rejected by the bridge instead of being silently converted.
- There is no user-facing integration switch. Operations controls rollout with
  environment configuration.

The BI frontend does not gain a bridge-specific switch or selector. Project
filtering, explicit project selection on create, project labels, and
project-scoped assignees are added only to the Mind task workspace.

This release shares task boards. It does not create, rename, archive, or delete
BI projects from Mind.

## Mind configuration

```dotenv
BI_TASKS_ENABLED=false
BI_API_BASE_URL=https://signboard-uat.ypzuat.click/api
BI_SERVICE_TOKEN=
BI_SERVICE_LOGIN_ID=<dedicated BI service login>
BI_SERVICE_PASSWORD=<secret-managed password>
BI_INTEGRATION_SECRET=<same 32+ character secret as BI>
BI_TASKS_ORGANIZATION_IDS=<comma-separated Mind organization ids>
BI_USER_MAP={}
BI_DEFAULT_ASSIGNEE_ID=
BI_DEFAULT_DUE_DAYS=7

# Deprecated compatibility only. Keep empty for new deployments.
BI_ORG_PROJECT_MAP={}
BI_DEFAULT_PROJECT_ID=
```

Use same-email linking when Mind and BI share an email. Put only exceptions in
`BI_USER_MAP` as `{"<mind-user-id>":"<bi-member-id>"}`. Production Mind
accounts that use synthetic `@sayknow.local` addresses need explicit mappings.
Keep `BI_DEFAULT_ASSIGNEE_ID` empty so an unmapped user fails clearly instead
of assigning work to somebody else.

## BI configuration

```dotenv
SAYKNOWMIND_INTEGRATION_ACCOUNT_IDS=<dedicated BI Account.id>
SAYKNOWMIND_INTEGRATION_SECRET=<same shared secret>
```

The BI integration account is transport-only. BI verifies an HMAC-signed actor
id/email on every request and then applies that actor's ownership, project
scope, membership, and role permissions. The integration account is blocked
from unrelated BI APIs.

## Safe rollout

1. Generate the shared secret in secret storage; never put it in Git or chat.
2. Deploy BI UAT with the integration account id and secret.
3. Deploy SayKnowMind Web and MCP from the same commit with
   `BI_TASKS_ENABLED=false`.
4. Configure the UAT Mind organization allowlist, service credentials, secret,
   and user-map exceptions.
5. Enable only the UAT organization and recreate Web. MCP needs the new image
   for project-aware tools but does not need BI credentials.
6. Complete the two-user/two-project acceptance matrix and clean test tasks.
7. For rollback, disable and recreate Mind Web first. Roll back BI only after
   Mind has stopped making bridge calls.
8. Production images may be released with the switch off. Enable one
   organization only after configuration review and UAT sign-off.

## Acceptance gate

- Two users see the projects they own and projects shared with them.
- A private third project remains invisible and direct task ids return 404.
- Mind create/update/delete appears immediately in BI.
- BI create/update/delete appears after Mind refresh.
- Project owner can assign and delete in both products.
- Shared members follow the BI role matrix.
- Personal scope resolves to the current delegated BI member.
- Project member picker contains only that project's members.
- More than 200 tasks returns every page.
- Unsigned, tampered, expired, unknown-user, and unrelated-module service
  requests fail closed.
- Disabling the Mind switch restores local Mind task behavior without changing
  BI data.

## MCP changes

- `sayknowmind_task_projects_list` lists accessible BI projects.
- `sayknowmind_tasks_list` accepts optional `project_id`.
- `sayknowmind_task_create` accepts `project_id`, which is required in BI
  mode.
- Existing per-user MCP authentication and mandatory `organization_id` remain
  in force.
