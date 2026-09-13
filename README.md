# web

The Compose.Market web app (Vite + React). Chat, mission control, market,
sessions, and the model playground.

## Stream consumption

All agent/workflow/model streams flow through one pipeline:

- `src/hooks/use-chat.ts` — message state and the mutation primitives
  (`addUserMessage`, `createAssistantPlaceholder`, block/artifact upserts,
  activity tree reduction). Pages never call `setMessages` directly.
- `src/hooks/use-stream.ts` — the single send pipeline (`runAgent`,
  `runWorkflow`, `runResponses`, `watchPlan`). Every event is dispatched by
  domain: `model.*` events build text/reasoning/tool/artifact blocks,
  `activity.*` events drive tool activity, plan/connector gates, and the
  mission-control tree. Payloads are read from the typed protocol fields —
  the client never sniffs raw wire frames.
- `src/hooks/use-session.tsx` — one session bootstrap
  (`resolveActiveKeyToken`) and one `SessionState`.
- `src/hooks/use-thread.ts` — one conversation-thread hook
  (sessionStorage-backed, scoped per user + counterpart), used by the agent
  and workflow pages.
- `src/lib/format.ts` — shared display formatters (`formatWeiUsd`).

Rendering uses `@compose-market/theme` stream components. `MissionControl`
renders the activity tree from the protocol `target` projection
(`target.name`, `target.summary`) — no client-side label rewriting. Connector
decisions reuse the theme `PlanActions` row.

`web → @compose-market/sdk → @compose-market/core` and
`web → @compose-market/theme`; all three resolve to the local `packages/`
sources during development.
