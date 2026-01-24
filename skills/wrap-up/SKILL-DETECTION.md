# Skill Detection

Guidelines for identifying when session work should become a reusable skill.

## Detection Criteria

A new skill is warranted when **2+ of these apply**:

### 1. Repetition (3+ occurrences)

```
Did you do the same type of work 3+ times in this session?

Examples:
✓ Created 3 similar API endpoints
✓ Wrote 3 entity types with same structure
✓ Set up 3 CLI commands with same pattern
✗ Wrote 3 different functions (no structural similarity)
```

### 2. Boilerplate Reduction (>15 min per occurrence)

```
Does this work involve significant boilerplate?

Examples:
✓ 9-file entity structure (types, repo, controller, tests)
✓ Full CRUD scaffold with validation
✓ CLI command with args, help, subcommands
✗ Single function implementation
```

### 3. Consistency Enforcement

```
Would variation cause problems?

Examples:
✓ Naming conventions must match (entity names, file names)
✓ Import structure must be consistent
✓ Error handling patterns should be uniform
✗ Implementation details can vary
```

### 4. Non-Determinism Prevention

```
Did LLM produce inconsistent results?

Examples:
✓ Different naming styles across similar entities
✓ Varying file structures for same concept
✓ Inconsistent error message formats
✗ Results were consistent throughout
```

### 5. Future Recurrence

```
Will this work happen again?

Examples:
✓ Every new entity needs same scaffold
✓ Each feature needs same folder structure
✓ New endpoints follow same pattern
✗ One-off migration or fix
```

## Skill vs Script vs Pattern

| Create | When |
|--------|------|
| **Skill** | Needs context, instructions, possibly templates |
| **Script** | Pure automation, no context needed |
| **Pattern** | Just document in CLAUDE.md, no automation |

### Skill Indicators

- Requires understanding of project context
- Has multiple steps with decisions
- Benefits from templates or examples
- Other users might need it

### Script Indicators

- Single deterministic operation
- No context needed
- CI/CD or build tool
- Database migration

### Pattern Indicators

- Guidelines, not automation
- Style preferences
- Conventions to follow
- Too simple for skill

## Skill Template

When creating a new skill:

```markdown
# Skill Name

Brief description of what this skill does.

## When to Use

- Trigger 1
- Trigger 2

## Quick Reference

\`\`\`bash
/skill-name arg1 arg2
\`\`\`

## Workflow

1. Step 1
2. Step 2
3. Step 3

## Templates (if applicable)

[Include templates for common patterns]

## Examples

[Include real examples from this session]
```

## Detection Checklist

During wrap-up, ask:

```
□ Did I do similar work 3+ times?
□ Was there significant boilerplate (>15 min)?
□ Would inconsistency cause problems?
□ Did I need to correct LLM variations?
□ Will this work recur in the future?

2+ checks = Consider creating a skill
```

## Skill Proposal Format

When proposing a new skill:

```markdown
## Skill Proposal: [name]

**Triggers:** When would this be used?
**Pattern:** What's the repetitive structure?
**Savings:** How much time/effort saved?
**Files:** What would it create/modify?

**Example from this session:**
- [specific instance 1]
- [specific instance 2]
- [specific instance 3]

**Recommendation:** Create skill / Document pattern / No action
```

## Examples from Practice

### rust-cli Skill (Created)

**Triggers:** Building Rust CLI applications
**Pattern:**
- Workspace with core + cli crates
- Clap derive for arguments
- thiserror/anyhow for errors
- Doctor command pattern

**Detection criteria met:**
- ✓ Repetition: Multiple Rust CLIs built
- ✓ Boilerplate: 10+ files per CLI
- ✓ Consistency: Same patterns work best
- ✓ Non-determinism: LLM varies structure
- ✓ Future recurrence: More CLIs planned

### Entity Scaffold Skill (Proposed)

**Triggers:** Creating new domain entities
**Pattern:**
- types.ts (enums + interfaces)
- repository.ts (data access)
- controller.ts (API endpoints)
- *.test.ts (unit tests)
- registry updates

**Detection criteria met:**
- ✓ 3+ entities created same way
- ✓ 30 min boilerplate per entity
- ✓ Naming must be consistent
- ✓ LLM varied file structure

### API Endpoint Pattern (Not a Skill)

**Why not:**
- Each endpoint has unique logic
- Structure varies by need
- No significant boilerplate
- Just document conventions in CLAUDE.md
