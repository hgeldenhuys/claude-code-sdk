# Skill Examples

Real-world examples of skills from this project and official documentation.

## Example 1: docs-tracker (CLI Integration)

A CLI integration skill for tracking Claude Code documentation. Shows the pattern for command-line tool wrappers.

**Location**: `.claude/skills/docs-tracker/SKILL.md`

**Key Characteristics**:
- ~90 lines (concise)
- `allowed-tools: Read, Bash, Grep, Glob` (restricted to read-only + CLI)
- Quick Start with bash commands
- Table-based reference
- Links to api-reference.md and examples.md for depth

**Frontmatter**:
```yaml
---
name: docs-tracker
description: Track, cache, and detect changes in Claude Code documentation. Use when needing to check for doc updates, search documentation content, verify Claude Code capabilities, or understand what changed in official docs since last check.
allowed-tools: Read, Bash, Grep, Glob
---
```

**What Makes It Effective**:
1. Description has clear triggers: "check for doc updates", "search documentation", "verify capabilities"
2. Immediate value with Quick Start commands
3. Table for category reference
4. Programmatic usage example
5. Links to subfiles for deep dives

---

## Example 2: managing-agent-lifecycles (Complex Architecture)

A complex skill for agent lifecycle management. Shows the pattern for architecture decisions with multiple concepts.

**Location**: `.claude/skills/managing-agent-lifecycles/SKILL.md`

**Key Characteristics**:
- ~213 lines (medium complexity)
- No tool restrictions (full implementation capability)
- Decision tree for choosing options
- Multiple code patterns
- Hook integration example
- Links to patterns.md, api-reference.md, examples.md

**Frontmatter**:
```yaml
---
name: managing-agent-lifecycles
description: Implements persistent agent lifecycle management with 6 lifespans (ephemeral, turn, context, session, workflow, project). Use when creating agents that survive across turns, managing workflow-scoped execution, or needing automatic cleanup at lifecycle boundaries.
---
```

**What Makes It Effective**:
1. Description names all 6 lifespans (specific vocabulary)
2. Triggers are architectural: "agents that survive", "workflow-scoped", "automatic cleanup"
3. ASCII decision tree for quick selection
4. Implementation checklist
5. Common patterns section with real code
6. Hook integration shows full solution

---

## Example 3: Simple Commit Helper (From Official Docs)

A minimal skill for generating commit messages.

**Structure**:
```
commit-helper/
└── SKILL.md
```

**Full Content**:
```yaml
---
name: generating-commit-messages
description: Generates clear commit messages from git diffs. Use when writing commit messages or reviewing staged changes.
---

# Generating Commit Messages

## Instructions

1. Run `git diff --staged` to see changes
2. Suggest a commit message with:
   - Summary under 50 characters
   - Detailed description
   - Affected components

## Best practices

- Use present tense
- Explain what and why, not how
```

**What Makes It Effective**:
- Under 30 lines (minimal)
- Clear trigger: "writing commit messages", "staged changes"
- Actionable instructions
- Best practices for quality

---

## Example 4: Multi-File PDF Skill (From Official Docs)

A complex skill with scripts and progressive disclosure.

**Structure**:
```
pdf-processing/
├── SKILL.md
├── FORMS.md
├── REFERENCE.md
└── scripts/
    ├── fill_form.py
    └── validate.py
```

**SKILL.md**:
```yaml
---
name: pdf-processing
description: Extract text, fill forms, merge PDFs. Use when working with PDF files, forms, or document extraction. Requires pypdf and pdfplumber packages.
---

# PDF Processing

## Quick start

Extract text:
```python
import pdfplumber
with pdfplumber.open("doc.pdf") as pdf:
    text = pdf.pages[0].extract_text()
```

For form filling, see [FORMS.md](FORMS.md).
For detailed API reference, see [REFERENCE.md](REFERENCE.md).

## Requirements

Packages must be installed in your environment:
```bash
pip install pypdf pdfplumber
```
```

**What Makes It Effective**:
- Progressive disclosure: main file is short
- Scripts are Level 3 (output consumed, not code)
- Requirements clearly stated
- Links to subfiles for specialized tasks

---

## Example 5: Code Reviewer with Tool Restrictions

A read-only skill for code review without modifications.

```yaml
---
name: code-reviewer
description: Review code for best practices and potential issues. Use when reviewing code, checking PRs, or analyzing code quality.
allowed-tools: Read, Grep, Glob
---

# Code Reviewer

## Review checklist

1. Code organization and structure
2. Error handling
3. Performance considerations
4. Security concerns
5. Test coverage

## Instructions

1. Read the target files using Read tool
2. Search for patterns using Grep
3. Find related files using Glob
4. Provide detailed feedback on code quality
```

**What Makes It Effective**:
- `allowed-tools` restricts to read-only
- Checklist provides structure
- No Edit/Write/Bash means no accidental changes

---

## Pattern Comparison

| Skill | Lines | Tools | Subfiles | Use Case |
|-------|-------|-------|----------|----------|
| docs-tracker | ~90 | Restricted | Yes | CLI wrapper |
| managing-agent-lifecycles | ~213 | All | Yes | Complex architecture |
| commit-helper | ~30 | Default | No | Simple workflow |
| pdf-processing | ~40 | Default | Yes | Multi-file with scripts |
| code-reviewer | ~25 | Read-only | No | Restricted analysis |

## Frontmatter Pattern Summary

### CLI Integration Skills
```yaml
---
name: [tool]-integration
description: [Tool] commands for [purpose]. Use when [trigger].
allowed-tools: Read, Bash
---
```

### Architecture Skills
```yaml
---
name: [pattern]-architecture
description: Implements [pattern] with [key concepts]. Use when [architectural need].
---
```

### Debugging Skills
```yaml
---
name: debugging-[target]
description: Systematic troubleshooting for [problem]. Use when [error/symptom].
allowed-tools: Read, Bash, Grep, Glob
---
```

### Read-Only Analysis Skills
```yaml
---
name: [analysis]-skill
description: Analyze [what] for [purpose]. Use when [trigger].
allowed-tools: Read, Grep, Glob
---
```

## Creating Similar Skills

1. **Identify the pattern**: Which example is most similar to your need?
2. **Copy the structure**: Use the same section organization
3. **Adapt the content**: Replace with your specific details
4. **Test the triggers**: Verify Claude uses it when expected
5. **Iterate**: Refine based on actual usage
