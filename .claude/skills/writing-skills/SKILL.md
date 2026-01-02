---
name: writing-skills
description: Create effective Claude Code skills from breakthrough moments and successful implementations. Guides through identifying when skills are needed, structuring with proper YAML frontmatter and progressive disclosure, and following official best practices. Use after solving complex problems, discovering non-obvious patterns, implementing successful architectures, or developing specialized workflows that should be reusable.
version: 0.1.0
---

# Writing Skills

Transform breakthrough moments and successful implementations into reusable skills that accelerate future problem-solving and ensure consistent architecture patterns.

## When to Create a Skill

Create a skill when you've:

1. **Successfully implemented a complex architecture** - Patterns that worked well and should be repeated
2. **Discovered non-obvious solutions** - Solutions that aren't immediately clear from error messages
3. **Developed multi-step protocols** - Systematic approaches that prevent common mistakes
4. **Found comparative insights** - "Do X, not Y" wisdom from experience
5. **Experienced layer confusion** - Problems where symptoms appear in one layer but root cause is elsewhere
6. **Spent >15min on something that should take 5min** - Time-wasting loops worth preventing

**Timing**: Create skills **after successful implementation**, not during architecture planning. You need battle-tested patterns, not theoretical approaches.

**Don't create skills for**:
- Standard library usage (already documented)
- Simple single-command operations
- Framework basics covered in official docs
- One-off project-specific fixes
- Unproven architectures

## Progressive Disclosure: Three Levels

Skills leverage Claude's filesystem-based architecture with three loading levels:

### Level 1: Metadata (Always Loaded - ~100 tokens)

The YAML frontmatter is included in Claude's system prompt at startup:

```yaml
---
name: your-skill-name
description: What it does + When to use it
---
```

Claude knows your skill exists without loading full content.

### Level 2: Instructions (Loaded When Triggered - <5k tokens)

The main SKILL.md body loads when Claude determines the skill is relevant:

```markdown
# Your Skill Name

## Core Principle
[Key insight]

## Protocol
[Step-by-step guidance]

## Examples
[Concrete code examples]
```

### Level 3: Resources (Loaded As Needed - Unlimited)

Additional files load only when referenced:

```
skill-name/
├── SKILL.md          (Level 2)
├── TEMPLATES.md      (Level 3: scaffolding)
├── EXAMPLES.md       (Level 3: extended examples)
├── TROUBLESHOOTING.md (Level 3: common issues)
└── scripts/
    └── helper.py     (Level 3: executable)
```

**Key insight**: Only the script's output consumes tokens, not the code itself.

## Required YAML Frontmatter

### name (max 64 characters)

**Format**: lowercase letters, numbers, and hyphens only

**Good examples**:
- `creating-sse-routes`
- `debugging-api-endpoints`
- `implementing-cqrs-patterns`

**Bad examples**:
- `APIs` (not lowercase, too vague)
- `How to Debug` (spaces, not lowercase)
- `debugging` (too broad)

### description (max 1024 characters)

**Structure**:
1. **What it does** (first ~50%)
2. **When to use it** (second ~50% - CRITICAL for discovery)

**Best practices**:
- Include specific triggers: "Use when implementing real-time updates"
- Mention file types: "Use when working with PDF files"
- Reference error patterns: "when getting 404 despite routes being defined"

**Example**:
```yaml
description: Implement generic SSE real-time routes with query invalidation pattern. Creates backend SSE endpoints, RR7 proxies, and React Query hooks. Use when adding real-time updates to new entities, implementing SSE multiplexing, or creating data streaming endpoints.
```

### allowed-tools (optional)

Restrict which tools Claude can use when the skill is active:

```yaml
---
name: safe-code-reviewer
description: Review code without making changes. Read-only analysis.
allowed-tools: Read, Grep, Glob
---
```

**Common patterns**:
- **Read-only skills**: `Read, Grep, Glob`
- **Documentation skills**: `Read, Write`
- **Implementation skills**: `Read, Write, Edit, Bash`

## Skill Structure Template

```markdown
---
name: [lowercase-with-hyphens]
description: [What it does + When to use it - max 1024 chars]
version: 0.1.0
---

# [Skill Name]

[One paragraph: What problem does this solve and why it matters]

## Core Principle

[The key insight that makes this skill valuable - one sentence]

## Protocol / Architecture / Steps

[Systematic approach - numbered steps or architectural pattern]

## Implementation Details

[Critical code patterns, configuration, gotchas]

## Examples

[Concrete code examples showing right vs wrong approaches]

## Common Pitfalls

[Mistakes to avoid based on experience]

## When to Use This Skill

[Specific triggers: file types, error messages, architectural needs]

## Success Metrics

[How to know the skill was applied correctly]

## Files Affected

[List of files typically created/modified]
```

## Skill Locations

### Personal Skills (~/.claude/skills/)

Available across all your projects:

```bash
mkdir -p ~/.claude/skills/my-skill-name
```

**Use for**: Individual workflows, experimental skills, personal productivity tools

### Project Skills (.claude/skills/)

Shared with your team via git:

```bash
mkdir -p .claude/skills/my-skill-name
```

**Use for**: Team workflows, architecture patterns, shared utilities

**Workflow**:
```bash
git add .claude/skills/
git commit -m "Add SSE real-time routes architecture skill"
git push
# Team members get it automatically on next pull
```

### Plugin Skills

Skills bundled with Claude Code plugins for marketplace distribution.

## Content Guidelines

### 1. Start with the Breakthrough

For debugging skills:
```markdown
## Core Principle

**Don't trust the symptom location.** A 404 error doesn't mean
the route is missing. Always verify through logs.
```

For architecture skills:
```markdown
## Core Architecture

**Query invalidation pattern**: SSE doesn't transport data, it signals
React Query to refetch. This separates real-time transport from data loading.
```

### 2. Create Actionable Protocols

Transform solutions into repeatable steps:

```markdown
### 1. Create Backend SSE Endpoint

```typescript
// apps/api/src/routes/stream.ts
export async function streamHandler(c: Context) {
  const table = c.req.query('table');
  // ... implementation
}
```

**Why**: Generic endpoint works for all tables
**Watch for**: Table whitelist security
```

### 3. Show Concrete Comparisons

Include actual wrong vs right patterns:

```typescript
// ❌ WRONG - Individual endpoints per entity
// apps/api/src/routes/workspaces-stream.ts
// apps/api/src/routes/personas-stream.ts

// ✅ CORRECT - One generic endpoint
// apps/api/src/routes/stream.ts
export async function streamHandler(c: Context) {
  const table = c.req.query('table'); // Any table!
}
```

### 4. Document Common Pitfalls

```markdown
## Common Pitfalls

1. **Creating table-specific SSE endpoints** - Use generic endpoint instead
2. **Not using RR7 proxy** - Direct SSE fails with MIME type errors
3. **Transporting data via SSE** - Use query invalidation pattern instead
```

## Quick Creation Workflow

### After Successful Implementation (30 min total):

**1. Capture the architecture** (5 min):
```bash
echo "## Architecture: [pattern name]" >> notes.md
echo "Key files: [list]" >> notes.md
echo "Key decisions: [what and why]" >> notes.md
```

**2. Extract the protocol** (10 min):
- List the files created/modified
- Identify the key architectural decisions
- Note the order of implementation
- Document testing approach

**3. Write the skill** (15 min):
- Fill in the template
- Add concrete code examples
- Include file structure and locations
- Document the "why" behind key decisions

## Quality Checklist

Before saving a skill:

- [ ] Name is lowercase-with-hyphens and under 64 characters
- [ ] Description explains both WHAT and WHEN (under 1024 chars)
- [ ] Description includes specific triggers
- [ ] Core principle/architecture stated clearly
- [ ] Protocol has clear steps or pattern
- [ ] At least one concrete code example (right vs wrong)
- [ ] Common pitfalls section included
- [ ] "When to use" section has specific triggers
- [ ] Main SKILL.md is under 500 lines
- [ ] Complex details moved to supplementary files

See [TEMPLATES.md](TEMPLATES.md) for skill scaffolding templates.
See [EXAMPLES.md](EXAMPLES.md) for real-world examples from this project.
See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for common issues.

## Testing Your Skill

```bash
# 1. Check skill exists
ls -la .claude/skills/your-skill-name/

# 2. Verify YAML frontmatter
head -n 10 .claude/skills/your-skill-name/SKILL.md

# 3. Test in new session
# Ask Claude: "What skills are available?"

# 4. Trigger the skill
# Ask a question matching your description triggers

# 5. Verify it loaded
# Look for skill content in Claude's responses
```

**Iterate if**:
- Claude doesn't use the skill when expected → Make description more specific
- Steps are unclear → Add concrete examples
- Missing decision points → Include architectural rationale

## Marketplace Distribution

### Versioning Convention

- `v0.1.x` - Draft versions (pre-GitHub publish)
- `v1.0.0+` - Stable releases for marketplace

### DocsTracker Integration

Before creating skills, consult official documentation:

```bash
bun run docs:fetch              # Update cache
bun run docs search "skills"    # Search for patterns
bun run docs list development   # List dev docs
```

### Plugin Distribution

For marketplace distribution, bundle skills with Claude Code plugins:

1. Create plugin with skills in the `skills/` directory
2. Add to marketplace
3. Team members install the plugin
4. Skills automatically available

## Skill Types

### Architecture Pattern Skills

For successful implementations that should be repeated:
- Core Architecture section with pattern explanation
- Files Structure showing what to create
- Implementation Steps with code
- Key Decisions with rationale

### Debugging Protocol Skills

For systematic troubleshooting:
- Core Principle with key insight
- Protocol steps for layer-by-layer debugging
- Examples with symptom/cause/solution
- allowed-tools restriction (Read, Bash, Grep)

### Implementation Workflow Skills

For complex multi-file changes:
- Workflow steps in order
- Template file references
- Dependencies between steps

## References

- [Claude Code Skills Guide](https://code.claude.com/docs/en/skills)
- [Agent Skills Overview](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview)
- [Agent Skills Best Practices](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/best-practices)
