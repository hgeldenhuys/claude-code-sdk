# Commit Patterns

Conventions for comprehensive commit messages during wrap-up.

## Standard Format

```
<type>(<scope>): <brief description>

## What
- Key change 1
- Key change 2

## Why
Root motivation for this work

## Learnings (optional)
- Insight 1
- Insight 2

## References (optional)
- Related issue/story
- Documentation link

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

## Types

| Type | When |
|------|------|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `refactor` | Code restructuring, no behavior change |
| `docs` | Documentation only |
| `test` | Adding or updating tests |
| `chore` | Build, tooling, dependencies |
| `perf` | Performance improvement |
| `style` | Code style, formatting |

## Scope

Scope should be the primary area affected:

```
feat(auth): Add OAuth2 login flow
fix(api): Handle null response from external service
refactor(db): Extract repository pattern
docs(readme): Update installation instructions
```

## Examples

### Feature Commit

```
feat(skills): Add wrap-up skill for session closing ceremony

## What
- Created skills/wrap-up/SKILL.md with ceremony workflow
- Added SKILL-DETECTION.md for identifying new skill opportunities
- Added COMMIT-PATTERNS.md for commit conventions

## Why
Needed a scrum-master-style closing ritual to capture learnings,
update documentation, and create comprehensive commits.

## Learnings
- Skills should include detection criteria for creating child skills
- Commit patterns should be explicit, not assumed

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

### Bug Fix Commit

```
fix(tui): Prevent crash when database is empty

## What
- Added null check in session loader
- Return empty list instead of throwing

## Why
Users with fresh installations were hitting null pointer exception
when opening TUI before any sessions existed.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

### Refactor Commit

```
refactor(core): Extract filter logic to dedicated module

## What
- Moved FilterOptions from types.ts to filter.ts
- Added builder pattern for filter construction
- Updated all imports

## Why
Filter logic was growing and cluttering the types module.
Separation improves maintainability and testability.

## Learnings
- Builder pattern makes filter construction more readable
- For-loops perform better than forEach in hot paths

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

### Multi-File Commit

```
feat(entity): Add Transaction entity with full CRUD

## What
- crates/core/src/transaction.rs: Type definitions
- crates/db/src/transaction_repo.rs: Repository layer
- crates/api/src/transaction_controller.rs: API endpoints
- tests/transaction.test.rs: Unit and integration tests

## Why
Transaction support required for payment processing feature.
Follows established entity pattern from Account and Product.

## References
- Pattern: skills/entity-scaffold/SKILL.md
- Story: TRANS-001

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

## Learnings Section

Include learnings when:

- Discovered a pattern that worked well
- Found a pitfall to avoid
- Made a key decision with rationale
- Solved a non-obvious problem

Keep learnings:
- Specific and actionable
- Brief (1-2 sentences each)
- Focused on the "why" not just "what"

**Good learnings:**

```
## Learnings
- Rust's thiserror in core + anyhow in CLI gives best error ergonomics
- Doctor command should use symbols + colors for colorblind accessibility
```

**Poor learnings:**

```
## Learnings
- Code should be clean
- Tests are important
```

## When to Skip Sections

### Skip "Why" when:
- Type is self-explanatory (style, chore)
- Single-line fix with obvious reason

### Skip "Learnings" when:
- Routine work, nothing novel
- Simple fix or update

### Skip "References" when:
- No related issues/stories
- No external documentation

## Commit Size

Prefer smaller, focused commits:

| Size | Guidance |
|------|----------|
| 1-3 files | Good, single concern |
| 4-10 files | OK if logically related |
| 10+ files | Consider splitting |

Exception: Scaffold commits (new entity with all files) can be larger.

## Git Hygiene

### Before Committing

```bash
# Check what's staged
git status

# Review changes
git diff --staged

# Ensure no secrets
git diff --staged | grep -i "password\|secret\|key\|token"
```

### Commit Message Tips

1. **Subject line** under 72 characters
2. **Blank line** between subject and body
3. **Wrap body** at 72 characters
4. Use **imperative mood** ("Add" not "Added")
5. Reference **issues/stories** in body, not subject

### Creating Commit

Use heredoc for multi-line messages:

```bash
git commit -m "$(cat <<'EOF'
feat(area): Brief description

## What
- Change 1
- Change 2

## Why
Motivation

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```
