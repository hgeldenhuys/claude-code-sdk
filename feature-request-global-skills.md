# Feature Request: Global Skills for Sub-agents

## Summary

Skills should have an option to be automatically inherited by all sub-agents, similar to how CLAUDE.md is inherited. Currently, skills must be explicitly specified in each sub-agent's frontmatter, which doesn't scale for universal best practices.

## Problem

When you encode a best practice or coding standard as a skill, you want it applied universally across:
- Main agent ✅ (works today via auto-discovery)
- Built-in sub-agents (Explore, Plan, general-purpose) ❌
- Custom sub-agents ❌ (requires explicit `skills:` in each definition)
- Plugin sub-agents ❌

### Current Workaround

Put everything in CLAUDE.md, which:
- Becomes bloated over time
- Loses modularity of skills
- Can't be versioned/shared as easily
- Mixes project-specific info with universal practices

### Real-World Scenario

1. Team discovers "always use for-loops over forEach" improves code quality
2. They create `skills/coding-standards/SKILL.md` with this and other practices
3. Main agent learns it ✅
4. Sub-agent spawned for code review doesn't know it ❌
5. Team must update every sub-agent definition manually
6. Built-in agents (Explore, general-purpose) can never learn it ❌

## Proposed Solutions

### Option A: Global Skills Setting

```json
// ~/.claude/settings.json or .claude/settings.json
{
  "globalSkills": ["coding-standards", "best-practices", "security-rules"]
}
```

These skills would be injected into ALL agent contexts (main + sub-agents).

### Option B: Skill-Level Frontmatter

```markdown
---
name: coding-standards
global: true
---
# Coding Standards
Always use for-loops over forEach...
```

Skills marked `global: true` are auto-inherited by all sub-agents.

### Option C: Inheritance Flag in Sub-agent Config

```yaml
---
name: my-agent
inheritSkills: true  # Inherit all skills from parent context
skills:
  - additional-skill  # Plus any extras
---
```

### Option D: Skill Tiers

```yaml
# In skill frontmatter
---
name: coding-standards
tier: universal  # universal | project | task
---
```

- `universal` - Always injected into all agents
- `project` - Injected into main agent, available for sub-agents
- `task` - Only when explicitly requested

## Recommendation

**Option A (Global Skills Setting)** is the simplest and most flexible:
- Doesn't require modifying existing skills
- Works at user-level (`~/.claude/`) and project-level (`.claude/`)
- Clear precedence: project settings override user settings
- Easy to understand and implement

## Impact

This would make skills significantly more valuable by:
1. Enabling universal coding standards across all agents
2. Reducing maintenance burden (no manual sub-agent updates)
3. Allowing teams to share best practices that apply everywhere
4. Making the skills system more practical for real-world use

## Current Documentation Reference

From [Create custom subagents](https://code.claude.com/docs/en/sub-agents):

> `skills` | No | Skills to load into the subagent's context at startup. **The full skill content is injected, not just made available for invocation. Subagents don't inherit skills from the parent conversation**

This explicit statement confirms the current limitation.

---

**Tested with:** Claude Code 2.1.12
**Reproducible:** Yes - created canary skill, spawned sub-agent, confirmed skill content not present in sub-agent context.
