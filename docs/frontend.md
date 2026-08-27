# Frontend

Milestone 8 replaces the minimal Milestone 5/6 frontend shells with a routed,
multi-page SaaS application on top of the same backend APIs. Milestone 8 is
currently in progress: Milestone 8A (Application Shell & Navigation) is being
stabilized, while broader 8B/8C/8D functionality may already exist in the
working tree and remains subject to its own milestone review. This frontend work
does not change backend behavior except where explicitly noted as an identified
API gap below - no new auth, RBAC, or endpoints were added for this milestone.

## Stack

- **React 19 + TypeScript + Vite** (unchanged from earlier milestones).
- **React Router 7** - client-side routing, replacing the single monolithic
  `AuthShell` component that rendered everything inline.
- **TanStack Query 5** - server state (fetching, caching, loading/error
  states, mutations, optimistic updates), replacing the hand-rolled
  `useEffect`/`useState` fetch patterns every feature used to repeat.
- **Tailwind CSS 4** - utility-first styling via CSS custom properties for
  theming (see Design System below), replacing the single hand-written
  `styles.css`.
- **@dnd-kit** - accessible drag-and-drop for the Kanban board.
- **lucide-react** - icon set.
- **date-fns** - relative/human date formatting.
- **Vitest + React Testing Library** - the frontend's first test suite.

React Router, TanStack Query, and Tailwind were already named as the intended
stack in this README's "Target Stack" section; Zustand was not adopted -
React Context covers the app's actual global-state needs (auth session,
theme, toasts, the realtime connection) without an extra dependency, and
TanStack Query already owns all server state.

## Architecture and Component Organization

```
src/
  api/            Typed fetch wrappers, one module per backend domain
                  (auth, workspaces, projects, notifications) plus a shared
                  client.ts (apiRequest/ApiError) every module builds on.
  lib/            Small framework-agnostic utilities: session storage,
                  the React Query client, the `cn` class-name helper.
  context/        App-wide providers: AuthContext, ThemeContext,
                  RealtimeContext, ToastContext.
  hooks/          React Query hooks (useWorkspaces, useProjects, useTasks,
                  useNotifications), realtime subscription hooks, and
                  small local hooks (useDebounce, useWorkspaceId).
  components/
    ui/           Design-system primitives: Button, Input/Textarea, Select,
                  Avatar, Badge, Skeleton, EmptyState, Dialog/Drawer/Overlay,
                  Menu, GlobalLoadingBar.
    layout/       AppLayout, Sidebar, Topbar - the application shell.
    tasks/        KanbanBoard, TaskCard, TaskListView, TaskDetailDrawer,
                  CreateTaskDialog, TaskBadges, TaskRow.
    projects/     ProjectHeader.
    notifications/  NotificationBell.
    search/       SearchPalette (Cmd/Ctrl+K).
    activity/     ActivityEntry (shared by the dashboard, project activity
                  tab, and the task drawer's activity section).
    data/         QueryBoundary - the shared loading/error/success renderer
                  for a React Query result.
    errors/       ErrorBoundary.
    auth/         RequireAuth route guard.
  pages/          One component per route: LoginPage, RegisterPage,
                  RootRedirect, DashboardPage, ProjectPage, MembersPage,
                  NotFoundPage, PermissionDeniedPage.
  realtime/       client.ts - authenticated WebSocket client with reconnect,
                  event dedupe, and active subscription tracking.
```

The rule of thumb used throughout: a component that renders one thing in one
place lives next to its page; a component reused across two or more features
(badges, the activity entry renderer, the query boundary) moved to
`components/`. Nothing was split into its own file solely for the sake of
it - `TaskDetailDrawer.tsx`, for example, keeps its labels/dependencies/
comments/activity sections as internal functions in one file rather than
four separate one-call-site component files.

## State Management

- **Server state -> TanStack Query.** Every list/detail/mutation in
  `hooks/` goes through it. Query keys are arrays scoped by workspace/project/
  task id (`["tasks", workspaceId, projectId, filters]`) so invalidating a
  narrower key never has to know about a wider one's shape.
- **Auth session -> `AuthContext`.** Owns the stored session, the current
  user, and `getAccessToken()` - every hook calls this before an API request;
  it transparently refreshes the access token first if it's within 30s of
  expiry (same rule the Milestone 5/6 code used), so no hook or component
  ever handles token refresh itself.
- **Realtime connection -> `RealtimeContext`.** Owns one `RealtimeClient`
  (from Milestone 6, unchanged) keyed to the session's access token.
- **Theme -> `ThemeContext`.** `light` / `dark` / `system`, persisted to
  `localStorage`, toggles a `dark` class on `<html>` that Tailwind's
  `dark:` variant reads.
- **Toasts -> `ToastContext`.** A queue of transient notifications rendered
  in a fixed corner viewport.
- **Everything else is local `useState`** (open/closed dialogs, form field
  values, active tab, sort/filter state in the task list) - there was no
  case in this app where local state needed to be lifted into a global store.

## Routing

```
/login, /register                                   - public
/                                                     - redirects to the
                                                        user's first
                                                        workspace, or a
                                                        "create your first
                                                        workspace" screen
/w/:workspaceId                                       - dashboard
/w/:workspaceId/members                               - workspace members
/w/:workspaceId/projects/:projectId                   - project (tabs:
                                                        Board / List /
                                                        Activity)
/w/:workspaceId/projects/:projectId?task=:taskId      - the above, with the
                                                        task detail drawer
                                                        open (deep-linkable,
                                                        e.g. from search or
                                                        the dashboard)
*                                                      - 404
```

All routes under `/w/:workspaceId` are wrapped once by `RequireAuth`, which
shows a full-page spinner while the session hydrates and redirects to
`/login` (preserving the original path) if there is none.

## Design System

Tokens are CSS custom properties defined once in `src/styles/globals.css`
(`--background`, `--foreground`, `--primary`, `--danger`, `--success`,
`--warning`, `--border`, `--sidebar`, ...), each with a light and a
`.dark`-scoped value, mapped into Tailwind's `@theme inline` so components
use ordinary utilities (`bg-card`, `text-muted-foreground`, `border-border`)
that automatically follow the active theme - no component branches on
light/dark itself. `ui/` holds the primitives every feature composes:
`Button` (5 variants), `Input`/`Textarea`/`Field`, `Select`, `Avatar`
(deterministic color + initials from a name), `Badge`, `Skeleton`,
`EmptyState`, `Overlay` (the shared portal/focus-trap/Escape-to-close
behavior behind both `Drawer` and `Dialog`), and `Menu` (a dependency-free
dropdown).

## Responsiveness

The shell is mobile-first: the sidebar is `hidden md:block` on desktop and
becomes a full-height overlay panel (via the same `Overlay` primitive used
for dialogs/drawers) triggered by a hamburger button in the `Topbar` below
the `md` breakpoint. The Kanban board's column grid
(`grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`) stacks to one column on
phones. The task drawer is `w-full max-w-xl`, so it becomes a full-screen
panel rather than a cramped sidebar on small viewports. Verified visually at
1440×900 and 390×844 (see Validation).

## Accessibility

- Every overlay (`Dialog`, `Drawer`, the mobile nav, the search palette) is
  built on one shared `Overlay` component that renders into a portal with
  `role="dialog" aria-modal="true"`, moves focus into the panel on open,
  restores focus to the trigger on close, traps Tab/Shift+Tab inside the
  panel, and closes on Escape - implemented once, so every overlay in the
  app gets this for free rather than each one reinventing it.
- A single global `:focus-visible` style (in `globals.css`) guarantees a
  visible keyboard focus ring everywhere, not just where a component
  remembered to add one.
- Icon-only buttons (close, remove-label, sidebar toggle, notification
  bell) all carry `aria-label`; decorative icons carry `aria-hidden`.
- The notification bell announces unread count in its `aria-label`
  (e.g. "Notifications, 3 unread") rather than only conveying it visually
  through the badge.
- Breadcrumbs use `<nav aria-label="Breadcrumb">` with `aria-current="page"`
  on the current item; tabs use `role="tab"`/`aria-selected`.
- Cmd/Ctrl+K opens search from anywhere; Escape closes any open overlay.

## Realtime UI Flow

The frontend keeps one authenticated `RealtimeClient` per session. It owns
reconnect with backoff, active subscription tracking, resubscribe on every
reconnect, and event-id dedupe. Milestone 8 adds React wiring around it:

- `RealtimeContext` owns one client per session and exposes connection
  `status`, shown as a small wifi icon in the `Topbar`.
- `useWorkspaceChannel(workspaceId)` / `useProjectChannel(workspaceId,
  projectId)` subscribe/unsubscribe declaratively as a component mounts,
  changes workspace, or changes project.
- `useRealtimeEvent(types, handler)` is the single hook every page uses to
  react to events. Pages don't touch React Query's cache directly from the
  socket handler in an ad hoc way - they call `queryClient.invalidateQueries`
  with the same query keys the page's own hooks use, so a `task.status_changed`
  event refetches exactly the queries already on screen (the task list, the
  open task's detail, its activity) and nothing else.
- **Optimistic updates**: `useUpdateTask` (used by both the Kanban
  drag-and-drop and the task drawer's selects) patches the tasks-list and
  task-detail caches immediately on drag/change, before the request
  resolves, and rolls back automatically if it fails - dragging a card to
  a new column moves it instantly rather than waiting on a round trip.
- **Duplicate event prevention**: handled once, inside `RealtimeClient`
  itself (by `event_id`), not re-implemented per page.
- **Graceful reconnect**: also owned by `RealtimeClient`; the UI's only job
  is to reflect `status` (the wifi icon) and let already-mounted
  subscriptions resubscribe automatically, which the client does on every
  `"connected"` ack.

## API Gaps Identified

The backend has no endpoints for these, so the frontend aggregates client-side
from existing per-project endpoints instead of inventing fake data. Both are
correct but don't scale past a workspace with a modest number of
projects/tasks - a real backend endpoint would fetch this in one query
instead of N:

- **No workspace-wide task query.** The dashboard's "assigned to me" /
  overdue / due-soon buckets, and the search palette's task results, are
  built by calling `GET /workspaces/{id}/projects/{project_id}/tasks` once
  per project the user can see and merging the results
  (`useMyTasksAcrossWorkspace`, `useWorkspaceSearchIndex`). A
  `GET /workspaces/{id}/tasks?assignee_id=&q=` endpoint would replace both.
- **No workspace-wide activity feed.** The dashboard's activity feed calls
  `GET /workspaces/{id}/projects/{project_id}/activity` once per project and
  merges/sorts client-side (`useRecentActivityAcrossWorkspace`). A
  `GET /workspaces/{id}/activity` endpoint would replace this.
- **No search endpoint at all.** There is no full-text search on the backend
  for either projects or tasks; "search" here is a substring match over
  already-fetched data. A real `GET /workspaces/{id}/search?q=` (or separate
  project/task search endpoints) is the eventual fix.

No backend code was changed to work around these - the aggregation lives
entirely in `hooks/useDashboardData.ts` and
`hooks/useWorkspaceSearchIndex.ts`, isolated from the rest of the app so it's
easy to delete once real endpoints exist.

## Testing

`npm run test` (Vitest + React Testing Library + jsdom). `src/test/setup.ts`
shims the two browser APIs jsdom lacks that this app depends on
(`WebSocket`, `matchMedia`); `src/test/utils.tsx` provides
`renderWithProviders` (wraps a component in the same provider stack as the
real app, using an in-memory router and a fresh query client per test) and
`mockApi` (a `fetch` mock routed by `"METHOD /path"`).

Covered: routing/auth guard behavior (`RequireAuth`), the login flow
end-to-end against a mocked API, task list filtering/sorting, task status
and priority badge rendering, the notification bell's unread count and
mark-read flow, and the realtime client's event delivery, deduplication,
resubscribe-on-reconnect, and post-disconnect silence. Not covered by
automated tests: drag-and-drop (dnd-kit's pointer-sensor interactions don't
translate well to jsdom) and visual/responsive regressions - those were
verified manually via a headless-browser screenshot pass (see the
milestone's final report).
