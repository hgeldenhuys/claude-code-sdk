---
name: writing-skills
description: Guide for creating effective Claude Code skills. Use when creating new skills, refactoring existing skills, or validating skill structure. Covers YAML frontmatter, progressive disclosure, naming conventions, and best practices.
---

# Writing Skills

Create effective Claude Code skills that are concise, well-structured, and follow official best practices.

## Quick Reference

| Element | Requirement |
|---------|-------------|
| Filename | `SKILL.md` in skill directory |
| Name | Lowercase, hyphens, numbers only (max 64 chars) |
| Description | Third person, max 1024 chars |
| Main file | Under 500 lines |
| References | One level deep from SKILL.md |

## YAML Frontmatter

Every skill requires frontmatter:

```yaml
---
name: skill-name
description: Third person description of what skill does and when to use it. Include trigger phrases.
allowed-tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"]  # Optional
model: sonnet  # Optional: opus, sonnet, haiku
---
```

### Frontmatter Fields

| Field | Required | Notes |
|-------|----------|-------|
| `name` | Yes | Lowercase letters, numbers, hyphens. Max 64 chars |
| `description` | Yes | Third person. Max 1024 chars. Include when to use |
| `allowed-tools` | No | Restricts which tools the skill can use |
| `model` | No | Force specific model (opus, sonnet, haiku) |

## Naming Conventions

**Use gerund form** (verb ending in -ing):

| Good | Avoid |
|------|-------|
| `writing-skills` | `skill-writer` |
| `debugging-api` | `api-debugger` |
| `creating-hooks` | `hook-creator` |

**Rules:**
- Lowercase letters, numbers, hyphens only
- No spaces or underscores
- Maximum 64 characters
- Descriptive of what the skill helps accomplish

## Progressive Disclosure

Keep SKILL.md focused. Split detailed content to reference files.

### Pattern 1: Table of Contents

```markdown
## Reference Files

| File | Contents |
|------|----------|
| [TEMPLATES.md](./TEMPLATES.md) | Starter templates |
| [EXAMPLES.md](./EXAMPLES.md) | Real-world examples |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | Common issues |
```

### Pattern 2: Inline Links

```markdown
For detailed templates, see [TEMPLATES.md](./TEMPLATES.md).
```

### Pattern 3: Conditional Loading

```markdown
## Advanced Configuration

If you need custom model settings, see [ADVANCED.md](./ADVANCED.md).
```

## Skill Structure

### Recommended Sections

1. **Quick Reference** - Table with key requirements
2. **Core Instructions** - Main guidance (bulk of skill)
3. **Workflows** - Step-by-step procedures with checklists
4. **Examples** - Input/output pairs
5. **Reference Files** - Links to detailed content

### File Organization

```
skills/
└── skill-name/
    ├── SKILL.md           # Main skill file (required)
    ├── TEMPLATES.md       # Starter templates (optional)
    ├── EXAMPLES.md        # Detailed examples (optional)
    └── TROUBLESHOOTING.md # Common issues (optional)
```

## Writing Effective Descriptions

Descriptions appear in skill discovery. Make them count.

### Structure

```
[What it does]. [When to use it]. [Key triggers/phrases].
```

### Examples

**Good:**
```
Guide for creating effective Claude Code skills. Use when creating new
skills, refactoring existing skills, or validating skill structure.
Covers YAML frontmatter, progressive disclosure, and naming conventions.
```

**Avoid:**
```
A skill for writing skills.
```

## Workflows

Include step-by-step workflows with copyable checklists.

### Workflow Template

```markdown
## Workflow: [Name]

### Prerequisites
- [ ] Requirement 1
- [ ] Requirement 2

### Steps

1. **Step Name**
   - [ ] Action item
   - [ ] Action item

2. **Step Name**
   - [ ] Action item

### Validation
- [ ] Check 1
- [ ] Check 2
```

## Examples Section

Show concrete input/output pairs.

### Example Template

```markdown
## Examples

### Example: [Scenario Name]

**Input:**
```
User request or context
```

**Output:**
```
Expected result or response
```

**Why:** Brief explanation of approach.
```

## Validation Checklist

Before finalizing a skill:

- [ ] Name uses gerund form
- [ ] Name is lowercase with hyphens only
- [ ] Description is third person
- [ ] Description includes when to use
- [ ] SKILL.md is under 500 lines
- [ ] Reference files are one level deep
- [ ] Workflows have copyable checklists
- [ ] Examples show input/output pairs

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Over 500 lines | Split to reference files |
| Vague description | Add specific triggers and use cases |
| No workflows | Add step-by-step procedures |
| Missing examples | Add input/output pairs |
| Deep file nesting | Keep references one level deep |

## Reference Files

| File | Contents |
|------|----------|
| [TEMPLATES.md](./TEMPLATES.md) | Starter templates for new skills |
| [EXAMPLES.md](./EXAMPLES.md) | Real-world skill examples |
