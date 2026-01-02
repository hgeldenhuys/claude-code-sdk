---
description: Make small modifications to existing features (Loom: Adhoc Phase)
---

# Loom: Adhoc Tweak

You are executing the **Adhoc Tweak** workflow in Loom, the autonomous SDLC orchestration system.

## Context Loading

1. **Load Loom Config**:
   ```bash
   cat .agent/loom/config.json
   ```

2. **Load Weave Extension**:
   - Read `.agent/weave/extensions/loom/praxeology.json` for adhoc-tweak workflow

## Workflow: Adhoc Tweak

Follow the workflow defined in `loom/praxeology.json > workflows > adhoc-tweak`:

### Step 1: Capture Change Request
- Listen to user's desired change
- Document it clearly:
  ```markdown
  # Tweak: {Brief Title}
  Date: {timestamp}

  ## Change Requested
  {User's description}

  ## Current Behavior
  {What exists now}

  ## Desired Behavior
  {What should change}

  ## Affected Area
  {Component/feature being modified}
  ```

### Step 2: Assess Scope
**Tweak Criteria** (from permissions in deontics):
- ✅ Single file change (or 2-3 closely related files)
- ✅ Single role needed
- ✅ Clear requirement (no ambiguity)
- ✅ User explicitly requests quick change

**Story Criteria** (suggest full workflow if):
- ❌ More than 3 files affected
- ❌ Multiple roles needed (backend + frontend, etc.)
- ❌ Complex requirements or ambiguity
- ❌ Significant testing needed

**Decision Logic**:
```typescript
if (filesAffected > 3 || rolesNeeded.length > 1) {
  suggestFullStory();
} else {
  proceedWithTweak();
}
```

### Step 3: Make Change
If scope is appropriate for tweak:

1. **Delegate to Specialist**:
   - Use Task tool with appropriate `subagent_type`
   - Provide clear context:
     ```typescript
     Task({
       subagent_type: 'backend-dev', // or frontend-dev, cli-dev
       description: 'Update error message format',
       prompt: `
         Tweak Request: Update error message format

         Current: "Error: Invalid input"
         Desired: "Validation failed: Invalid input format"

         File: src/utils/validation.ts
         Function: validateInput()

         Make the change and verify no other code depends on old format.
       `
     })
     ```

2. **Self-Test**:
   - Agent should test the change
   - Verify no regressions
   - Check related functionality still works

### Step 4: Quick Validation
- If change affects user-facing behavior:
  - Quick manual test (for UI changes)
  - Run relevant test suite (if exists)
- If internal refactor:
  - Verify no compilation errors
  - Spot-check related code

### Step 5: Commit
Create clear, concise commit:

```bash
git commit -m "{type}({scope}): {brief description}

{Explanation of what changed and why}

Change type: adhoc tweak
Files: {list}
"
```

**Commit type examples**:
- `feat`: New functionality added
- `fix`: Bug fixed
- `refactor`: Code restructured, no behavior change
- `style`: Formatting, naming
- `docs`: Documentation only
- `chore`: Tooling, config

### Step 6: Report to User
```markdown
## ✅ Tweak Complete

### Change Summary
- **What**: {brief description}
- **Files**: {list affected files}
- **Tested**: {yes/no and how}

### Commit
- {commit hash}: {commit message first line}

### Notes
{Any important notes or side effects}
```

## When to Suggest Full Story
If scope assessment reveals:

```markdown
## ⚠️ Scope Larger Than Expected

This change affects:
- **Files**: {count} files across {count} components
- **Roles**: {backend-dev, frontend-dev, etc.}
- **Testing**: Requires integration tests

**Recommendation**: Create a proper story for this change.

Use `/loom:ideate` to properly plan and track this work.

Would you like me to:
1. Create a story (recommended)
2. Proceed with tweak anyway
3. Break into smaller tweaks
```

Use `AskUserQuestion` to get user's choice.

## Examples

### Good Tweak Candidates ✅
- Change error message text
- Update UI label or button text
- Adjust timeout value
- Fix typo in code comment
- Rename internal variable
- Add logging statement
- Update color or spacing
- Change default value

### Should Be Stories ❌
- Add new API endpoint
- Create new UI component
- Change database schema
- Add authentication check
- Refactor multiple components
- Update external API integration
- Change data flow
- Add new feature flag

## Important Notes
- **Quick wins only** - resist scope creep
- **Test before commit** - even small changes can break things
- **Suggest story when appropriate** - don't force tweaks for complex changes
- **Document well** - commit messages matter
- **No silent changes** - always inform user of what was done
