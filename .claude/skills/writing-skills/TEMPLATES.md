# Skill Templates

Ready-to-use templates for different skill types. Copy the appropriate template and customize for your use case.

## Architecture Pattern Skill Template

For successful implementations that should be repeated across projects.

```markdown
---
name: [pattern-name]-architecture
description: Implement [pattern name] with [key approach]. Creates [what files/components]. Use when [trigger A], [trigger B], or [trigger C].
version: 0.1.0
---

# [Pattern Name] Architecture

[Problem this architecture solves and performance/scalability impact]

## Core Architecture

**[Key pattern in one sentence]**

```
[ASCII diagram if helpful]
```

## Files Structure

**Backend**:
- `path/to/file.ts` - [Purpose]
- `path/to/another.ts` - [Purpose]

**Frontend**:
- `path/to/component.tsx` - [Purpose]
- `path/to/hook.ts` - [Purpose]

## Implementation Steps

### 1. [First Component]

```typescript
// path/to/file.ts
[Code template]
```

**Why**: [Architectural rationale]
**Key decision**: [What and why]

### 2. [Second Component]

```typescript
// path/to/file.ts
[Code template]
```

**Why**: [Rationale]

### 3. [Integration]

[How components connect]

## Key Decisions

1. **[Decision]** - [Why over alternative]
2. **[Decision]** - [Tradeoff explanation]

## Performance Impact

- Before: [Metrics]
- After: [Metrics]
- Improvement: [%]

## Common Pitfalls

1. **[Anti-pattern]** - [Why it fails and correct approach]
2. **[Mistake]** - [How to avoid]

## When to Use This Skill

- [Trigger 1: specific file type or pattern]
- [Trigger 2: architectural need]
- [Trigger 3: error message or symptom]

## Success Metrics

- [How to verify it worked]
- [Performance expectations]
- [Testing approach]
```

---

## Debugging Protocol Skill Template

For systematic troubleshooting approaches.

```markdown
---
name: debugging-[specific-thing]
description: Systematic troubleshooting for [problem type]. Use when [error pattern] or [symptom].
allowed-tools: Read, Bash, Grep, Glob
version: 0.1.0
---

# Debugging [Specific Thing]

[Problem description and why it's tricky to diagnose]

## Core Principle

**[Key debugging insight - the non-obvious truth]**

## Protocol

### 1. [Verify First Layer]

```bash
[Verification command]
```

**Why**: [Explanation]
**Watch for**: [What indicates problem]

### 2. [Check Next Layer]

```bash
[Command]
```

**What to look for**: [Indicators]

### 3. [Isolate Root Cause]

[Steps to narrow down]

### 4. [Apply Fix]

[Common fixes for identified causes]

## Examples

### Example: [Scenario A]

**Symptom**: [What you see]
**Root cause**: [Actual problem]
**Solution**: [Fix]

```typescript
// ❌ WRONG
[Anti-pattern code]

// ✅ CORRECT
[Solution code]
```

### Example: [Scenario B]

**Symptom**: [What you see]
**Root cause**: [Actual problem]
**Solution**: [Fix]

## Common Pitfalls

1. **[Wrong assumption]** - [Why it misleads]
2. **[Debugging mistake]** - [Correct approach]

## When to Use This Skill

- [Error message pattern]
- [Symptom description]
- [Situation trigger]

## Verification Checklist

- [ ] [Check 1]
- [ ] [Check 2]
- [ ] [Check 3]
```

---

## Implementation Workflow Skill Template

For complex multi-file changes with dependencies.

```markdown
---
name: adding-[feature-type]
description: Complete workflow for adding [feature type] with [integration points]. Use when scaffolding [what] or implementing [capability].
version: 0.1.0
---

# Adding [Feature Type]

[Overview of what this workflow produces]

## Prerequisites

- [Requirement 1]
- [Requirement 2]

## Workflow Overview

```
1. [Step] ─────► 2. [Step] ─────► 3. [Step]
                      │
                      ▼
                 4. [Step] ─────► 5. [Step]
```

## Step 1: [First Phase]

**Files created**:
- `path/to/file.ts`

```typescript
// path/to/file.ts
[Template code]
```

**Verification**:
```bash
[Command to verify]
```

## Step 2: [Second Phase]

**Depends on**: Step 1

**Files created**:
- `path/to/file.ts`

```typescript
[Template code]
```

## Step 3: [Third Phase]

[Continue pattern]

## Integration Points

- [How this connects to existing code]
- [Configuration needed]
- [Environment variables]

## Testing

```bash
# Run tests
[test command]

# Manual verification
[steps]
```

## Common Customizations

### [Variation A]

[How to modify for this use case]

### [Variation B]

[How to modify for this use case]
```

---

## Minimal Skill Template

For simple, focused skills (single file, under 100 lines).

```markdown
---
name: [action]-[target]
description: [What it does]. Use when [specific trigger].
version: 0.1.0
---

# [Skill Name]

## Instructions

1. [Step one]
2. [Step two]
3. [Step three]

## Example

```typescript
[Concrete example]
```

## Best Practices

- [Practice 1]
- [Practice 2]
```

---

## CLI Integration Skill Template

For skills that wrap command-line tools.

```markdown
---
name: [tool-name]-integration
description: [Tool name] commands for [purpose]. Use when [trigger].
allowed-tools: Read, Bash
version: 0.1.0
---

# [Tool Name] Integration

## Quick Start

```bash
# Basic usage
[command]

# Common operation
[command]
```

## Commands Reference

| Command | Purpose |
|---------|---------|
| `[cmd]` | [Description] |
| `[cmd]` | [Description] |

## Workflows

### [Workflow A]

```bash
[step 1]
[step 2]
```

### [Workflow B]

```bash
[steps]
```

## Configuration

```bash
# Configure [aspect]
[command or file content]
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| [Problem] | [Fix] |
| [Problem] | [Fix] |
```

---

## Template Selection Guide

| Skill Type | When to Use | Template |
|------------|-------------|----------|
| Architecture | Repeatable implementation patterns | Architecture Pattern |
| Debugging | Systematic troubleshooting | Debugging Protocol |
| Workflow | Multi-step feature addition | Implementation Workflow |
| Simple | Single focused capability | Minimal |
| CLI | Command-line tool wrapper | CLI Integration |

## Frontmatter Quick Reference

```yaml
---
name: lowercase-with-hyphens    # Max 64 chars
description: What + When        # Max 1024 chars
allowed-tools: Read, Write      # Optional tool restriction
version: 0.1.0                  # Semantic versioning
---
```
