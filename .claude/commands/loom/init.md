---
description: Initialize Loom 2.0 Domain Memory structure
---

# /loom:init - Initialize Loom for a Project

Initialize a project with Loom SDLC orchestration using Trak (Board CLI) for story management.

## Purpose

Creates the project-specific configuration that Loom uses to coordinate work:
- Stack configuration for actor context
- Project runbook with conventions
- Directory structure for retrospectives and artifacts
- Initializes Trak database for story/task/AC tracking

## When to Use

Run this **once per project** when first adopting Loom.

**Don't run this if:**
- `.agent/loom/` directory already exists
- You're just creating a new story (use `/loom:ideate` instead)

## Stage Manager Rules

As Stage Manager, you MUST follow these rules during initialization:

- **DO** create stack-config.json and runbook.md
- **DO** delegate stack detection to architect agent
- **DO** create directory structure
- **DO** initialize Trak database
- **DO NOT** analyze the codebase directly
- **DO NOT** edit implementation files
- **DO NOT** run tests or build commands

## Execution Steps

### Step 1: Check for Existing Setup

Check if Loom is already initialized:

```bash
if [ -d ".agent/loom" ]; then
  echo "Loom already initialized at .agent/loom/"
  ls -la .agent/loom/

  # Check if Trak database exists
  board feature list --json 2>/dev/null && echo "Trak database found"
fi
```

**If re-initializing:**
```bash
# Backup existing setup
mv .agent/loom .agent/loom.backup.$(date +%Y%m%d-%H%M%S)
echo "Backed up existing Loom setup"
```

### Step 2: Create Directory Structure

Create the Loom directory structure:

```bash
mkdir -p .agent/loom/{features,retrospectives,templates}
echo "Created .agent/loom/ directory structure"
```

### Step 3: Initialize Trak Database

Initialize Trak for story/task management:

```bash
# Check if board database exists
if ! board feature list --json 2>/dev/null; then
  echo "Initializing Trak database..."
  # Trak auto-initializes on first use
fi
echo "Trak ready for story management"
```

### Step 4: Spawn Architect for Stack Detection

**CRITICAL:** Stage Manager does NOT analyze the codebase. Delegate to architect.

Spawn architect agent using Task tool:

```markdown
You are an Architect agent tasked with detecting the tech stack for Loom initialization.

## Your Task

Analyze this codebase and return a complete `stack-config.json`.

## What to Detect

1. **Runtime & Package Manager**
   - Check for `bun.lockb`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`
   - Check `package.json` for engine requirements

2. **Backend Stack**
   - Framework: ElysiaJS, Express, Fastify, Hono, NestJS
   - Database: Check for PostgreSQL, MySQL, MongoDB, SQLite
   - ORM: Drizzle, Prisma, TypeORM
   - Validation: Zod, TypeBox, Yup

3. **Frontend Stack**
   - Framework: React, Vue, Svelte, Next.js
   - Router: React Router, TanStack Router
   - State: TanStack Query, Zustand, Redux
   - UI: shadcn/ui, Radix, Tailwind
   - Bundler: Vite, Webpack, Turbopack

4. **Testing**
   - Unit: bun:test, Vitest, Jest
   - E2E: Playwright, Cypress
   - Integration: Supertest, Pactum

5. **Infrastructure**
   - Hosting: Vercel, Railway, Fly.io
   - CI: GitHub Actions, GitLab CI
   - Containers: Docker, Podman

6. **Conventions** (analyze existing code)
   - Loop style: for, forEach, for-of
   - Async style: async-await vs promises
   - Export style: named vs default
   - Function style: arrow vs declaration
   - Database port (check .env, docker-compose.yml)
   - Naming conventions (files, functions, constants)

## Output Format

Return a complete JSON object:

```json
{
  "project": "my-project",
  "version": "2.0",
  "runtime": "bun",
  "packageManager": "bun",
  "backend": {
    "framework": "elysia",
    "database": "postgresql",
    "orm": "drizzle"
  },
  "frontend": {
    "framework": "react",
    "router": "react-router-v7"
  },
  "testing": {
    "unit": "bun:test",
    "e2e": "playwright"
  },
  "conventions": {
    "loopStyle": "for",
    "asyncStyle": "async-await",
    "databasePort": 5432
  }
}
```

Return ONLY the JSON object, no other text.
```

**Wait for architect response.** The response will be a `stack-config.json` object.

### Step 5: Save Configuration Files

#### 5.1: Save stack-config.json

Save the architect's output to `.agent/loom/stack-config.json`:

```bash
# Architect returned stack-config JSON
echo "${ARCHITECT_OUTPUT}" > .agent/loom/stack-config.json
```

#### 5.2: Copy runbook.md template

Copy the runbook template:

```bash
cp .agent/loom/templates/runbook.md .agent/loom/runbook.md
```

**Then populate with stack-specific values:**

Read the template, replace placeholders with values from `stack-config.json`, and write to `.agent/loom/runbook.md`.

Example replacements:
- `{{project_name}}` -> stack-config.project
- `{{runtime}}` -> stack-config.runtime
- `{{backend_framework}}` -> stack-config.backend.framework
- `{{database}}` -> stack-config.backend.database
- `{{frontend_framework}}` -> stack-config.frontend.framework

### Step 6: Configure Per-Project Discord Webhook (Optional)

Ask user if they want to configure a Discord webhook for this project:

```markdown
Would you like to configure a Discord webhook for this project's notifications?

This allows notifications from this project to go to a dedicated Discord channel
instead of the default global channel.

Options:
1. Yes - I have a Discord webhook URL ready
2. Skip - Use the global channel (can configure later with `claude-notify webhook <url>`)
```

**If user provides a webhook URL:**

```bash
# Validate and save the webhook URL
claude-notify webhook <provided-url>
```

Or manually create/update `.agent/loom/notification-config.json`:

```json
{
  "discordWebhookUrl": "https://discord.com/api/webhooks/..."
}
```

### Step 7: Verify and Report Success

Verify all files were created:

```bash
# Check structure
ls -la .agent/loom/
ls -la .agent/loom/features/
ls -la .agent/loom/retrospectives/

# Verify Trak is working
board feature list --json
```

Display success summary:

```markdown
Loom Initialized Successfully!

**Configuration:**
- `.agent/loom/stack-config.json` - Tech stack configuration
- `.agent/loom/runbook.md` - Project conventions
- `.agent/loom/features/` - Documentation artifacts
- `.agent/loom/retrospectives/` - Generated retrospectives
- `.board.db` - Trak database for story/task/AC management

**Detected Stack:**
- Runtime: ${runtime}
- Backend: ${backend.framework}
- Frontend: ${frontend.framework}
- Database: ${backend.database}
- ORM: ${backend.orm}
- Testing: ${testing.unit}, ${testing.e2e}

**Next Steps:**
1. Review stack-config.json and runbook.md
2. Customize conventions if needed
3. Configure Discord webhook (if not done): `claude-notify webhook <url>`
4. Create your first story: `/loom:ideate`
5. View project board: `board story list` or `board-tui`
```

## Board CLI Commands

Loom uses Trak (Board CLI) for all story/task/AC management:

```bash
# Features
board feature create -c FEAT -n "Feature Name"
board feature list --json

# Stories
board story create -f FEAT -t "Story Title" --why "Motivation"
board story list --json
board story show STORY-ID --json

# Tasks
board task create -s STORY-ID -t "Task Title" -a backend-dev
board task list -s STORY-ID --json
board task update TASK-ID -s completed

# Acceptance Criteria
board ac create -s STORY-ID -d "AC description"
board ac verify AC-CODE --notes "Evidence"
board ac progress -s STORY-ID --json

# Sessions
board session start -s STORY-ID
board session current --json
board session end
```

## Important Notes

- **Run once per project** - Don't re-initialize unless resetting
- **Stage Manager never analyzes code** - Always delegate to architect
- **Trak is source of truth** - All story/task/AC data lives in `.board.db`
- **Commit configuration** - Share stack-config.json and runbook.md with team

## Success Criteria

After initialization:
- `.agent/loom/` directory exists with correct structure
- `stack-config.json` and `runbook.md` created
- Stack correctly detected by architect
- Trak database initialized (`.board.db`)
- Ready to create first story with `/loom:ideate`
