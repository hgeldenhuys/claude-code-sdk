# Skill Troubleshooting

Common issues when creating and using Claude Code skills.

## Claude Doesn't Use My Skill

### Symptom
You ask a relevant question but Claude doesn't invoke your skill.

### Check 1: Is the description specific enough?

**Problem**: Vague descriptions make discovery difficult.

```yaml
# ❌ Too vague
description: Helps with documents

# ✅ Specific with triggers
description: Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files or when the user mentions PDFs, forms, or document extraction.
```

**Fix**: Include both WHAT it does and WHEN to use it. Add specific trigger words that users would mention.

### Check 2: Is the YAML valid?

**Problem**: Invalid YAML prevents the skill from loading.

```bash
# View frontmatter
head -n 10 .claude/skills/my-skill/SKILL.md

# Common issues to check:
# - Missing opening or closing ---
# - Tabs instead of spaces
# - Unquoted strings with special characters
# - Missing colon after field name
```

**Fix**: Ensure:
- Opening `---` on line 1
- Closing `---` before markdown content
- Spaces (not tabs) for indentation
- Quotes around strings with special characters

### Check 3: Is the skill in the correct location?

**Problem**: Skill is in wrong directory.

```bash
# Personal skills
ls ~/.claude/skills/*/SKILL.md

# Project skills
ls .claude/skills/*/SKILL.md
```

**Fix**: Ensure SKILL.md is in a subdirectory:
- Personal: `~/.claude/skills/my-skill/SKILL.md`
- Project: `.claude/skills/my-skill/SKILL.md`

### Check 4: Is the name valid?

**Problem**: Name doesn't follow naming rules.

```yaml
# ❌ Invalid names
name: My Skill           # Spaces not allowed
name: MySkill            # Uppercase not allowed
name: my_skill           # Underscores not allowed
name: this-is-a-very-long-skill-name-that-exceeds-sixty-four-characters  # Too long

# ✅ Valid names
name: my-skill
name: pdf-processor
name: debugging-api-endpoints
```

**Fix**: Use lowercase letters, numbers, and hyphens only. Max 64 characters.

---

## Skill Has Errors

### Symptom
The skill loads but doesn't work correctly.

### Check 1: Are dependencies available?

**Problem**: Required packages not installed.

```bash
# Check if package is installed
pip list | grep pypdf
bun pm ls | grep typescript
```

**Fix**: Install dependencies and document them in SKILL.md:
```markdown
## Requirements

```bash
pip install pypdf pdfplumber
```
```

### Check 2: Do scripts have execute permissions?

**Problem**: Scripts fail to run.

```bash
chmod +x .claude/skills/my-skill/scripts/*.py
chmod +x .claude/skills/my-skill/scripts/*.sh
```

### Check 3: Are file paths correct?

**Problem**: Paths use wrong format.

```markdown
# ❌ Wrong (Windows style)
See [reference](scripts\helper.py)

# ✅ Correct (Unix style)
See [reference](scripts/helper.py)
```

**Fix**: Always use forward slashes in paths.

---

## Multiple Skills Conflict

### Symptom
Claude uses the wrong skill or seems confused between similar skills.

### Cause
Descriptions are too similar, making it hard to distinguish.

```yaml
# ❌ Too similar
# Skill 1
description: For data analysis

# Skill 2
description: For analyzing data
```

### Fix
Make descriptions distinct with specific trigger terms:

```yaml
# ✅ Distinct
# Skill 1
description: Analyze sales data in Excel files and CRM exports. Use for sales reports, pipeline analysis, and revenue tracking.

# Skill 2
description: Analyze log files and system metrics data. Use for performance monitoring, debugging, and system diagnostics.
```

---

## Skill Is Too Large

### Symptom
Skill file exceeds 500 lines or consumes too many tokens.

### Solution 1: Extract templates to subfiles

```
my-skill/
├── SKILL.md              # Core protocol (~200 lines)
├── TEMPLATES.md          # Code templates
└── EXAMPLES.md           # Extended examples
```

Reference from SKILL.md:
```markdown
See [TEMPLATES.md](TEMPLATES.md) for code templates.
```

### Solution 2: Move scripts to separate files

```
my-skill/
├── SKILL.md
└── scripts/
    ├── helper.py         # Script code (not loaded as tokens)
    └── validate.sh
```

Only the script **output** consumes tokens, not the script code itself.

### Solution 3: Use progressive disclosure

Put detailed API docs in a subfile:

```markdown
For complete API reference, see [API.md](API.md).
```

Claude loads API.md only when explicitly needed.

---

## Skill Not Found After Creation

### Symptom
`ls` shows the skill exists but Claude doesn't see it.

### Check 1: Restart Claude Code

Skills are loaded at startup. After creating a new skill:
```bash
# Exit and restart
exit
claude
```

### Check 2: Verify directory structure

```bash
# Correct structure
.claude/skills/my-skill/SKILL.md

# Wrong structures
.claude/skills/SKILL.md           # Missing subdirectory
.claude/skills/my-skill.md        # Not in directory
.claude/my-skill/SKILL.md         # Wrong parent
```

### Check 3: Check for hidden characters

```bash
# View file with hidden characters
cat -A .claude/skills/my-skill/SKILL.md | head -5

# Should show:
# ---$
# name: my-skill$
```

Look for unexpected characters or encoding issues.

---

## allowed-tools Not Working

### Symptom
Claude still asks for permission despite `allowed-tools` being set.

### Check 1: Tool names are correct

```yaml
# ❌ Wrong tool names
allowed-tools: read, write         # Lowercase
allowed-tools: ReadFile, WriteFile # Wrong names

# ✅ Correct tool names
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
```

### Check 2: Skill is actually active

The skill must be triggered for `allowed-tools` to apply. If Claude is doing something unrelated to your skill, normal permission rules apply.

---

## Subfiles Not Loading

### Symptom
Referenced files like `EXAMPLES.md` aren't being read.

### Check 1: Links are correct

```markdown
# ❌ Wrong
See [examples](./EXAMPLES.md)     # Don't use ./
See [examples](examples.md)        # Case sensitive

# ✅ Correct
See [EXAMPLES.md](EXAMPLES.md)
```

### Check 2: Files exist in skill directory

```bash
ls .claude/skills/my-skill/
# Should show: SKILL.md EXAMPLES.md etc.
```

### Check 3: Content is actually needed

Claude only loads subfiles when they're relevant to the current task. If you just mention a file exists, Claude won't load it preemptively.

---

## Version Field Not Recognized

### Symptom
Version field in frontmatter causes issues.

### Note
The `version` field is for documentation purposes only. It's not validated by Claude Code.

```yaml
---
name: my-skill
description: Does something useful.
version: 0.1.0               # Optional, for tracking
---
```

Use standard semver for your own tracking:
- `0.1.x` - Draft/development
- `1.0.0+` - Stable release

---

## Quick Diagnostic Commands

```bash
# Check if skill exists
ls -la ~/.claude/skills/*/SKILL.md
ls -la .claude/skills/*/SKILL.md

# Validate YAML frontmatter
head -n 10 .claude/skills/my-skill/SKILL.md

# Check for encoding issues
file .claude/skills/my-skill/SKILL.md

# View with line numbers
cat -n .claude/skills/my-skill/SKILL.md | head -20

# Run Claude in debug mode
claude --debug
```
