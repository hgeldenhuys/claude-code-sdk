---
argument-hint: [extension|user|advanced]
description: List all skills from claude-code-sdk with optional category filter
---

# List Claude Code SDK Plugins

List all available skills from the claude-code-sdk marketplace. Optionally filter by category.

## Arguments

- `extension` - Extension development skills (hooks, MCP, plugins, etc.)
- `user` - User-focused skills (prompting, memory, debugging, etc.)
- `advanced` - Advanced workflow skills (testing, code review, etc.)
- No argument = list all skills grouped by category

## Categories

### Extension Development Skills (9 skills)

For building Claude Code extensions:

| Skill | Description | Install |
|-------|-------------|---------|
| claude-code-reference | Reference guide for extensions | `/plugin install claude-code-reference@claude-code-sdk` |
| creating-hooks | All 10 hook events | `/plugin install creating-hooks@claude-code-sdk` |
| creating-mcp-servers | MCP server development | `/plugin install creating-mcp-servers@claude-code-sdk` |
| creating-plugins | Full plugin bundling | `/plugin install creating-plugins@claude-code-sdk` |
| creating-subagents | Custom Task tool agents | `/plugin install creating-subagents@claude-code-sdk` |
| custom-slash-commands | Create slash commands | `/plugin install custom-slash-commands@claude-code-sdk` |
| headless-mode | CLI flags and SDKs | `/plugin install headless-mode@claude-code-sdk` |
| transcript-intelligence | Search transcripts | `/plugin install transcript-intelligence@claude-code-sdk` |
| writing-skills | Create effective skills | `/plugin install writing-skills@claude-code-sdk` |

### User-Focused Skills (8 skills)

For everyday Claude Code usage:

| Skill | Description | Install |
|-------|-------------|---------|
| chrome-integration | Browser automation | `/plugin install chrome-integration@claude-code-sdk` |
| effective-prompting | @ mentions, thinking modes | `/plugin install effective-prompting@claude-code-sdk` |
| memory-management | CLAUDE.md, rules, memory | `/plugin install memory-management@claude-code-sdk` |
| debugging-claude-code | Diagnostics, recovery | `/plugin install debugging-claude-code@claude-code-sdk` |
| project-setup | Configuration, permissions | `/plugin install project-setup@claude-code-sdk` |
| git-workflows | Commits, PRs, branches | `/plugin install git-workflows@claude-code-sdk` |
| context-optimization | /compact, /clear | `/plugin install context-optimization@claude-code-sdk` |
| permission-patterns | Permission modes | `/plugin install permission-patterns@claude-code-sdk` |

### Advanced Workflow Skills (14 skills)

For advanced development workflows:

| Skill | Description | Install |
|-------|-------------|---------|
| testing-patterns | TDD, test generation | `/plugin install testing-patterns@claude-code-sdk` |
| code-review | PR workflows, checklists | `/plugin install code-review@claude-code-sdk` |
| refactoring-safely | Large-scale changes | `/plugin install refactoring-safely@claude-code-sdk` |
| multi-file-editing | Coordinated changes | `/plugin install multi-file-editing@claude-code-sdk` |
| cost-optimization | Token strategies, monitoring | `/plugin install cost-optimization@claude-code-sdk` |
| ide-integration | VS Code, JetBrains | `/plugin install ide-integration@claude-code-sdk` |
| team-workflows | Shared configs, onboarding | `/plugin install team-workflows@claude-code-sdk` |
| documentation-generation | READMEs, API docs | `/plugin install documentation-generation@claude-code-sdk` |
| database-workflows | Schema, migrations | `/plugin install database-workflows@claude-code-sdk` |
| error-recovery | Error types, recovery | `/plugin install error-recovery@claude-code-sdk` |
| migration-guides | Version upgrades | `/plugin install migration-guides@claude-code-sdk` |
| security-practices | Vulnerability prevention | `/plugin install security-practices@claude-code-sdk` |
| monorepo-patterns | Navigation, tooling | `/plugin install monorepo-patterns@claude-code-sdk` |
| ci-cd-integration | GitHub Actions, pipelines | `/plugin install ci-cd-integration@claude-code-sdk` |

## Instructions

Based on $ARGUMENTS:

1. **If `extension`**: Show only Extension Development Skills table
2. **If `user`**: Show only User-Focused Skills table
3. **If `advanced`**: Show only Advanced Workflow Skills table
4. **If empty or `all`**: Show all three tables with category headers

Format the output as clean markdown tables. Include the totals:
- Total: 31 skills
- Extension: 9 skills
- User: 8 skills
- Advanced: 14 skills

## Quick Install All

To install all skills at once:

```bash
# Add the marketplace first
/plugin marketplace add hgeldenhuys/claude-code-sdk

# Then install individual skills or browse with
/plugin discover
```
