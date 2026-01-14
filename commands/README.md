# Distributable Commands

Slash commands that can be installed from this SDK.

## Installation

Copy commands to your Claude Code commands directory:

```bash
# User-level (available in all projects)
cp commands/sdk-plugins.md ~/.claude/commands/

# Project-level (shared with team)
cp commands/sdk-plugins.md .claude/commands/
```

## Available Commands

| Command | Description | Usage |
|---------|-------------|-------|
| `/sdk-plugins` | List all skills from claude-code-sdk | `/sdk-plugins [extension\|user\|advanced]` |

## Usage Examples

```bash
# List all skills
/sdk-plugins

# List only extension development skills
/sdk-plugins extension

# List only user-focused skills
/sdk-plugins user

# List only advanced workflow skills
/sdk-plugins advanced
```
