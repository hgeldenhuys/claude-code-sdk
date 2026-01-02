---
description: Extract knowledge from files into Weave Q+E+O+M knowledge base
---

Extract knowledge from the git changed files in this repository and update the Weave knowledge base.

**Instructions:**

1. Check if Weave is installed: look for `.agent/weave/` directory
2. If not installed, tell the user to run: `bun .agent/weave/weave.ts install`
3. Find git changed files: `git diff --name-only HEAD`
4. Filter to source files (.ts, .tsx, .js, .jsx, .py, etc.)
5. Read the content of those files
6. Analyze the files and extract knowledge in these dimensions:

**ONTOLOGY (O)** - What exists:
- Entities: classes, functions, modules, types, interfaces
- Relationships: uses, extends, implements, contains
- Return as: `[{"id": "unique-id", "name": "EntityName", "type": "class|function|module", "description": "...", "confidence": 0.9}]`

**MEREOLOGY (M)** - How things compose:
- Part-whole relationships
- Component hierarchies
- Module structures
- Return as: `[{"wholeId": "parent-id", "partId": "child-id", "relationship": "contains|uses", "confidence": 0.8}]`

**EPISTEMOLOGY (E)** - How we know:
- Design patterns used
- Architectural patterns
- Key insights about how this works
- Return as: `[{"id": "knowledge-id", "concept": "...", "description": "...", "pattern": "...", "confidence": 0.9}]`

**QUALIA (Q)** - Experience and practice:
- Pain points this solves
- Workflows it enables
- Best practices demonstrated
- Return as: `[{"id": "exp-id", "type": "painPoint|workflow|bestPractice", "description": "...", "solution": "..."}]`

7. Update the Weave JSON files at `.agent/weave/`:
   - Read existing `ontology.json`, `mereology.json`, `epistemology.json`, `qualia.json`, `meta.json`
   - Merge new knowledge (avoid duplicates by ID)
   - Update `meta.stats.totalSessions` and `meta.stats.lastUpdate`
   - Write files back

8. Report results:
   - Number of entities added
   - Number of compositions added
   - Number of knowledge items added
   - Number of experiences added

**Important:**
- Work directly with the files in this Claude Code session
- Don't spawn external processes
- Merge with existing knowledge, don't overwrite
- Use kebab-case for IDs (e.g., "user-authentication-module")
