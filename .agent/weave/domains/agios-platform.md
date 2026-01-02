# Agios Platform Domain

**Overview:** Claude Code observability platform for tracking hook events, sessions, and agent activities

## Entities

### Core Applications
- **API Application** (apps/api) - ElysiaJS backend with modular architecture, real-time SSE streaming, PostgreSQL
- **Web Dashboard** (apps/web) - React Router v7 with TanStack Query, shadcn/ui components
- **CLI Application** (apps/cli) - Command-line interface for platform operations

### Packages
- **Hooks SDK** (packages/hooks-sdk) - Custom TypeScript SDK for Claude Code hooks with transaction tracking
- **Database** (packages/db) - Drizzle ORM schema, migrations, utilities for PostgreSQL
- **API Client** (packages/api-client) - Type-safe TypeScript client for Agios API
- **Transcript Types** (packages/transcript-types) - TypeScript types for Claude Code transcripts and events

### Knowledge Systems
- **Weave** (.agent/weave) - 11-dimension institutional memory framework (Q+E+O+M+C+A+T+Η+Π+Μ+Δ)

## Key Architectural Patterns

### CQRS (Command Query Responsibility Segregation)
- **Commands**: POST, PUT, DELETE - modify data, trigger events
- **Queries**: GET /recent (initial snapshot) + GET /stream (delta updates via SSE)
- Pattern: Read (GET) → Initial State | Write (POST/PUT/DELETE) → Commands | Stream (SSE) → Deltas

### Real-time First (No Polling)
- Database Event → PostgreSQL NOTIFY → SSE → UI Update
- Explicitly forbidden: `setInterval(() => fetch())`, polling loops
- All data updates stream in real-time using LISTEN/NOTIFY

### Event-Driven Architecture
- Hook Event → Database → Worker → NOTIFY → SSE → UI
- Events are immutable (INSERT only, no UPDATE/DELETE)
- Workers use pg-boss for async processing

### Idempotency at Database Level
- Prevent duplicates through UNIQUE constraints, composite keys
- Use `onConflictDoNothing()` in Drizzle, not application logic

## Critical Constraints

### MUST Rules
- MUST use SSE for real-time updates (no polling)
- MUST enforce idempotency at database level (UNIQUE constraints)
- MUST test yourself first with Chrome MCP before telling user to test
- MUST use consistent field naming (camelCase or snake_case, never mix)

### MUST NOT Rules
- MUST NOT use polling for updates
- MUST NOT assume features don't exist without verifying (grep first)
- MUST NOT trust agent findings blindly (verify with direct database queries)
- MUST NOT commit untested code

## Tech Stack

- **Backend**: ElysiaJS, PostgreSQL, Drizzle ORM, pg-boss
- **Frontend**: React 19, React Router v7, TanStack Query, shadcn/ui
- **Runtime**: Bun
- **Database**: PostgreSQL with ElectricSQL integration
- **Hooks**: Custom TypeScript SDK in packages/hooks-sdk

## Development Workflow

```bash
# API Server
cd apps/api && bun dev

# Web Dashboard
cd apps/web && bun dev

# Database Migrations
bun run db:generate
bun run db:migrate
bun run db:studio
```

## Related Dimensions

- **O (Ontology)**: Core entities and relations - `ontology:agios-platform`
- **E (Epistemology)**: Architectural patterns - `epistemology:cqrs-pattern`, `epistemology:real-time-first-pattern`
- **M (Mereology)**: Component hierarchy - `mereology:frontend-layer-composition`
- **Δ (Deontics)**: Constraints and rules - `deontics:must-test-before-commit`
- **Q (Qualia)**: Best practices - `qualia:test-before-claiming-success`

## Query Full Details

```bash
# Get platform entity
bun .agent/weave/scripts/query.ts ontology:agios-platform

# Search for CQRS pattern
bun .agent/weave/scripts/search.ts --dimension=E "CQRS"

# Get all constraints
bun .agent/weave/scripts/query.ts ontology:constraints

# Find related insights
bun .agent/weave/scripts/related.ts agios-platform
```

---
*Domain shard: ~1000 tokens | Covers: architecture, patterns, constraints, tech stack*
