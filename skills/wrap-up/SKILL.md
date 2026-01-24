# Wrap-Up: Session Closing Ceremony

A scrum-master-style closing ritual for completing work sessions with continuous learning.

## Quick Reference

```bash
/wrap-up                    # Full ceremony (retro + docs + commit + push)
/wrap-up retro              # Just retrospective (no commit)
/wrap-up commit             # Just commit + push (skip retro)
/wrap-up --dry-run          # Preview what would happen
```

## The Ceremony

### Phase 1: Retrospective (Reflect)

**Generate session retrospective:**

1. **What was accomplished** - List key deliverables
2. **What went well** - Patterns, techniques, wins
3. **What could improve** - Friction, blockers, near-misses
4. **Key decisions** - Important choices with rationale
5. **Learnings** - Insights to carry forward

### Phase 2: Knowledge Capture (Learn)

**Extract and persist learnings:**

1. **Update CLAUDE.md** if significant patterns emerged
2. **Capture to Weave** if institutional memory applies
3. **Create skill** if work is repetitive (see [SKILL-DETECTION.md](SKILL-DETECTION.md))

### Phase 3: Documentation (Document)

**Update documentation if warranted:**

1. Check if README needs updates (new features, changed behavior)
2. Check if ARCHITECTURE.md needs updates (structural changes)
3. Check if API docs need updates (new endpoints, changed signatures)
4. **Only update if changes merit it** - not every session needs doc updates

### Phase 4: Commit (Ship)

**Create comprehensive commit:**

```
feat(area): Brief description

## What
- Key change 1
- Key change 2

## Why
Root motivation for this work

## Learnings (if applicable)
- Insight 1
- Insight 2

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

### Phase 5: Push (Share)

**Push to remote:**

```bash
git push origin HEAD
```

## Workflow

```
/wrap-up
    │
    ├─► Phase 1: Retrospective
    │   ├─ Analyze session work
    │   ├─ Identify patterns
    │   └─ Generate reflection
    │
    ├─► Phase 2: Knowledge Capture
    │   ├─ Update CLAUDE.md?
    │   ├─ Capture to Weave?
    │   └─ Create skill? (if repetitive)
    │
    ├─► Phase 3: Documentation
    │   ├─ README updates?
    │   ├─ ARCHITECTURE updates?
    │   └─ API doc updates?
    │
    ├─► Phase 4: Commit
    │   ├─ Stage changes
    │   ├─ Write comprehensive message
    │   └─ Create commit
    │
    └─► Phase 5: Push
        └─ Push to remote
```

## Output Format

```markdown
# Session Wrap-Up

## Retrospective

### What Was Accomplished
- Implemented feature X
- Fixed bug Y
- Created skill Z

### What Went Well
- Pattern A worked efficiently
- Technique B saved time

### What Could Improve
- Friction point 1
- Near-miss 2

### Key Decisions
- **Decision**: Rationale

### Learnings
- Insight 1
- Insight 2

## Knowledge Captured

- **CLAUDE.md**: Updated with [pattern]
- **Weave**: Added [dimension]: [entry]
- **New Skill**: Created `/skill-name` (see SKILL-DETECTION.md)

## Documentation Updates

- README.md: Updated [section]
- (or) No documentation updates needed

## Commit

```
abc1234 feat(area): Brief description
```

## Pushed

```
origin/main: abc1234
```

## Next Steps

- Consider [follow-up work]
- Review [related area]
```

## When to Use

Use `/wrap-up` when:

- Finishing a coding session
- Completing a feature or bug fix
- Ending a debugging session
- Wrapping up exploratory work
- Before switching to a different project

## Modes

### Full Ceremony (default)

```bash
/wrap-up
```

All five phases: retro, learn, document, commit, push.

### Retro Only

```bash
/wrap-up retro
```

Just generate retrospective, no commit/push. Good for:
- Mid-session reflection
- When work isn't ready to commit
- Capturing learnings without shipping

### Commit Only

```bash
/wrap-up commit
```

Skip retrospective, just commit and push. Good for:
- Quick commits
- When retro was already done
- Simple changes that don't need reflection

### Dry Run

```bash
/wrap-up --dry-run
```

Preview what would happen without making changes. Shows:
- What the retrospective would contain
- What documentation would be updated
- What the commit message would be

## Integration with Loom

If you're using Loom for story-based work:

- **Ad-hoc work**: Use `/wrap-up`
- **Story work**: Use `/loom:finalize`

`/wrap-up` is for general work sessions.
`/loom:finalize` is for completing Loom stories with ACs.

## Skill Detection

If this session's work matches patterns that could become a skill:

1. Repetitive structure (did same thing 3+ times)
2. Boilerplate reduction (could automate)
3. Consistency enforcement (prevent variation)

See [SKILL-DETECTION.md](SKILL-DETECTION.md) for detection criteria.

## Customization

### Per-Project Settings

In your project's CLAUDE.md:

```markdown
## Wrap-Up Preferences

- Push after commit: yes/no (default: yes)
- Create skills: prompt/auto/never (default: prompt)
- Update Weave: yes/no (default: yes if available)
- Commit style: conventional/semantic/simple
```

### Global Settings

In `~/.claude/CLAUDE.md`:

```markdown
## Wrap-Up Global Preferences

- Default branch: main
- Co-author: Claude Opus 4.5 <noreply@anthropic.com>
- Always push: yes
```

## Related

- [SKILL-DETECTION.md](SKILL-DETECTION.md) - When to create new skills
- [COMMIT-PATTERNS.md](COMMIT-PATTERNS.md) - Commit message conventions
- `/loom:finalize` - For Loom story completion
- `/weave:reflect` - For capturing to institutional memory
