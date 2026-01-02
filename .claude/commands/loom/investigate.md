---
description: Investigate bugs, issues, or questions outside story context (Loom: Adhoc Phase)
---

# Loom: Adhoc Investigation

You are executing the **Adhoc Investigation** workflow in Loom, the autonomous SDLC orchestration system.

## Context Loading

1. **Load Loom Config**:
   ```bash
   cat .agent/loom/config.json
   ```

2. **Load Weave Extension**:
   - Read `.agent/weave/extensions/loom/praxeology.json` for adhoc-investigation workflow

## Workflow: Adhoc Investigation

Follow the workflow defined in `loom/praxeology.json > workflows > adhoc-investigation`:

### Step 1: Capture Issue
- Listen to user's issue, bug, or question
- Document it clearly:
  ```markdown
  # Investigation: {Brief Title}
  Date: {timestamp}

  ## Issue Description
  {User's description}

  ## Expected Behavior
  {What should happen}

  ## Actual Behavior
  {What is happening}

  ## Context
  - Affected component: {backend/frontend/CLI}
  - Error messages: {if any}
  - Reproduction steps: {if applicable}
  ```

### Step 2: Search Scrolls (Conversation History)
- Use deep-memory-search to check if similar issue discussed before:
  ```bash
  bun .claude/scripts/deep-memory-search.ts "{keywords from issue}"
  ```
- Look for:
  - Similar error messages
  - Related discussions
  - Previous solutions

### Step 3: Consult Weave (Shadow Advisor)
- Use Task tool with `subagent_type='shadow-advisor'` to query:
  - "Are there known pain points related to {component/feature}?"
  - "What patterns have we used for {related functionality}?"
  - "Have we solved similar problems before?"

### Step 4: Explore Codebase
**Choose appropriate method based on investigation needs:**

**Option A: Librarian** (when you know the domain)
- Load relevant Librarian shard
- Find files by purpose and pattern
- Example:
  ```bash
  cat .agent/librarian/shards/domain-crm.json | jq '.files[] | select(.purpose | test("campaign"))'
  ```

**Option B: Explore Agent** (when you need deep investigation)
- Use Task tool with `subagent_type='Explore'`
- Let agent search systematically
- Example:
  ```typescript
  Task({
    subagent_type: 'Explore',
    description: 'Find SSE implementation files',
    prompt: 'Search codebase for Server-Sent Events (SSE) implementations. Look for EventSource, text/event-stream, and streaming endpoints.'
  })
  ```

### Step 5: Diagnose Root Cause
Delegate to appropriate specialist:

- **Backend issues** → backend-dev
- **Frontend issues** → frontend-dev
- **CLI issues** → cli-dev
- **Architecture questions** → system-architect

Provide full context:
- Issue description
- Findings from scrolls/Weave
- Relevant files from Librarian/Explore
- Any error messages or logs

### Step 6: Report Findings
Present findings to user in this format:

```markdown
## 🔍 Investigation Results

### Root Cause
{Clear explanation of what's causing the issue}

### Affected Components
- {List files/components involved}

### Recommended Fix
{Suggest solution}

### Scope Assessment
- **Complexity**: {trivial|simple|moderate|complex}
- **Files affected**: {count}
- **Roles needed**: {backend-dev, frontend-dev, etc.}

### Decision Point
Choose one:
1. **Quick Fix**: Apply fix immediately (if trivial)
2. **Create Story**: Scope warrants full story workflow (if moderate+)
3. **User Decision**: Present options and let user choose
```

### Step 7: Decision Point
Use `AskUserQuestion` to offer:

**Option 1: Quick Fix** (if trivial)
- Single file change
- Clear solution
- No testing infrastructure needed
→ Proceed with fix immediately

**Option 2: Create Story** (if moderate+)
- Multiple files affected
- Requires multiple roles
- Needs proper testing
→ Use `/loom:ideate` to create full story

**Option 3: More Investigation**
- Root cause unclear
- Need more context
→ Continue investigating

## Quick Fix Path
If user chooses quick fix:

1. Apply fix using appropriate agent
2. Test the fix
3. Commit with clear message:
   ```bash
   git commit -m "fix({component}): {brief description}

   Root cause: {explanation}
   Fix: {what was changed}

   Investigation: ad-hoc"
   ```
4. Verify fix resolves issue

## Create Story Path
If user chooses to create story:

1. Capture investigation findings
2. Use `/loom:ideate` with findings as input
3. Convert issue into proper user story with:
   - WHY: Why is this important to fix?
   - AC: How do we verify it's fixed?
   - Context: Investigation findings

## Important Notes
- **Search first** - check scrolls and Weave before deep dive
- **Use right tool** - Librarian for known domains, Explore for discovery
- **Assess scope** - don't over-engineer simple fixes
- **Document findings** - even adhoc work has value
- **Consider story** - if scope grows, formalize it
