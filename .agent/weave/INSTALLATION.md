# Weave Installation Guide

Complete guide for installing and configuring the Weave Q+E+O+M knowledge system.

## Quick Install (Recommended)

```bash
# Navigate to your project
cd /path/to/your-project

# Install Weave using the CLI
bun /path/to/weave.ts install

# Verify installation
bun .agent/weave/test.ts

# Start monitoring (optional)
bun .agent/weave/weave.ts monitor
```

That's it! Weave is now installed and ready to capture knowledge automatically.

---

## Prerequisites

### Required

- **Bun**: v1.0.0 or higher
  ```bash
  curl -fsSL https://bun.sh/install | bash
  ```

- **Git**: For commit tracking
  ```bash
  git --version  # Should show 2.x or higher
  ```

### Optional

- **Claude Code CLI**: For automatic knowledge extraction via hooks
  ```bash
  # Installation instructions at https://github.com/anthropics/claude-code
  ```

---

## Installation Methods

### Method 1: Using weave.ts CLI (Easiest)

The `weave.ts` script is a unified installer and monitor:

```bash
# Install in current directory
bun /path/to/weave.ts install

# Install in specific directory
bun /path/to/weave.ts install /path/to/target

# Install from already-installed copy
bun /path/to/existing/.agent/weave/weave.ts install /path/to/new-project
```

**What it does**:
1. Creates `.agent/weave/` and `.agent/hooks/` directories
2. Copies all core Weave files
3. Initializes JSON knowledge files
4. Creates SessionEnd.ts hook
5. Makes hook executable

**See**: [WEAVE-CLI.md](./WEAVE-CLI.md) for full CLI documentation.

---

### Method 2: Manual Installation (For Development)

If you need to modify Weave or understand the internals:

#### 1. Create Directory Structure

```bash
cd /path/to/your-project
mkdir -p .agent/weave
mkdir -p .agent/hooks
```

#### 2. Copy Core Files

```bash
# From Weave source
WEAVE_SOURCE=/path/to/weave-source/.agent/weave

cp $WEAVE_SOURCE/types.ts .agent/weave/
cp $WEAVE_SOURCE/index.ts .agent/weave/
cp $WEAVE_SOURCE/extraction.ts .agent/weave/
cp $WEAVE_SOURCE/session-update.ts .agent/weave/
cp $WEAVE_SOURCE/test.ts .agent/weave/
cp $WEAVE_SOURCE/test-e2e.ts .agent/weave/
cp $WEAVE_SOURCE/weave.ts .agent/weave/
cp $WEAVE_SOURCE/README.md .agent/weave/
cp $WEAVE_SOURCE/SCHEMA.md .agent/weave/
```

#### 3. Copy Documentation (Optional)

```bash
cp $WEAVE_SOURCE/INSTALLATION.md .agent/weave/
cp $WEAVE_SOURCE/WEAVE-CLI.md .agent/weave/
cp $WEAVE_SOURCE/DISTRIBUTION.md .agent/weave/
cp $WEAVE_SOURCE/QUICK-START-TESTING.md .agent/weave/
cp $WEAVE_SOURCE/README-TESTING.md .agent/weave/
cp $WEAVE_SOURCE/TEST-QUESTIONS.md .agent/weave/
cp $WEAVE_SOURCE/TESTING-SUMMARY.md .agent/weave/
cp $WEAVE_SOURCE/WORK-TASKS.md .agent/weave/
```

#### 4. Initialize Knowledge Base

Create these JSON files in `.agent/weave/`:

**ontology.json**:
```json
{
  "$schema": "./SCHEMA.md#ontology",
  "title": "Ontology",
  "description": "What exists - entities, relations, constraints",
  "version": "1.0.0",
  "lastUpdated": "2024-11-20T00:00:00Z",
  "entities": {},
  "relations": {},
  "constraints": {},
  "metadata": {
    "totalEntities": 0,
    "totalRelations": 0,
    "totalConstraints": 0,
    "averageConfidence": 0,
    "lastCompaction": null
  }
}
```

**mereology.json**:
```json
{
  "$schema": "./SCHEMA.md#mereology",
  "title": "Mereology",
  "description": "How parts compose - components, compositions, hierarchy",
  "version": "1.0.0",
  "lastUpdated": "2024-11-20T00:00:00Z",
  "components": {},
  "compositions": {},
  "hierarchy": {
    "root": null,
    "layers": [],
    "modules": []
  },
  "partWholeRelations": {},
  "metadata": {
    "totalComponents": 0,
    "totalCompositions": 0,
    "totalParts": 0,
    "maxDepth": 0,
    "averageConfidence": 0,
    "lastCompaction": null
  }
}
```

**epistemology.json**:
```json
{
  "$schema": "./SCHEMA.md#epistemology",
  "title": "Epistemology",
  "description": "How we know - knowledge confidence and provenance",
  "version": "1.0.0",
  "lastUpdated": "2024-11-20T00:00:00Z",
  "knowledge": {},
  "patterns": {},
  "validations": {},
  "confidenceModel": {
    "scale": {},
    "updateRules": {},
    "bayesianParameters": {
      "priorWeight": 0.3,
      "evidenceWeight": 0.7,
      "minObservations": 1
    }
  },
  "knowledgeGaps": [],
  "metadata": {
    "totalConcepts": 0,
    "totalPatterns": 0,
    "totalValidations": 0,
    "averageConfidence": 0,
    "highConfidenceConcepts": 0,
    "lowConfidenceConcepts": 0,
    "knowledgeGaps": 0,
    "lastValidation": "2024-11-20T00:00:00Z"
  }
}
```

**qualia.json**:
```json
{
  "$schema": "./SCHEMA.md#qualia",
  "title": "Qualia",
  "description": "What it's like - experiential knowledge, pain points, solutions",
  "version": "1.0.0",
  "lastUpdated": "2024-11-20T00:00:00Z",
  "experiences": {},
  "painPoints": {},
  "solutions": {},
  "workflows": {},
  "bestPractices": {},
  "contextualKnowledge": {},
  "patterns": {
    "development": [],
    "debugging": [],
    "collaboration": []
  },
  "cognitiveLoad": {},
  "metadata": {
    "totalExperiences": 0,
    "totalPainPoints": 0,
    "totalSolutions": 0,
    "totalWorkflows": 0,
    "totalBestPractices": 0,
    "totalPatterns": 0,
    "lastUpdated": "2024-11-20T00:00:00Z"
  }
}
```

**meta.json**:
```json
{
  "version": "1.0.0",
  "createdAt": "2024-11-20T00:00:00Z",
  "lastUpdated": null,
  "stats": {
    "totalEntities": 0,
    "totalRelations": 0,
    "totalComponents": 0,
    "totalPatterns": 0,
    "totalPainPoints": 0,
    "averageConfidence": 0,
    "totalSessions": 0
  },
  "health": {
    "ontologyCoverage": 0,
    "epistemicConfidence": 0,
    "qualiaDepth": 0,
    "lastCompaction": null
  }
}
```

#### 5. Create SessionEnd Hook

Copy the hook:
```bash
cp $WEAVE_SOURCE/../hooks/SessionEnd.ts .agent/hooks/
chmod +x .agent/hooks/SessionEnd.ts
```

Or create manually - see [Hook Integration](#hook-integration) section below.

#### 6. Verify Installation

```bash
bun .agent/weave/test.ts
```

---

## Hook Integration

The SessionEnd hook enables automatic knowledge extraction when Claude Code sessions end.

### Claude Code Hook Setup

The hook uses stdin/stdout communication (Claude Code standard):

```typescript
#!/usr/bin/env bun
// .agent/hooks/SessionEnd.ts

interface SessionEndInput {
  session_id: string;
  cwd: string;
  transcript_path: string;
  hook_event_name: 'SessionEnd';
  reason: 'clear' | 'logout' | 'prompt_input_exit' | 'other';
}

interface SessionEndOutput {
  continue?: boolean;
}

async function main(): Promise<void> {
  // Read stdin
  const stdinBuffer: Buffer[] = [];
  for await (const chunk of process.stdin) {
    stdinBuffer.push(chunk);
  }
  const input: SessionEndInput = JSON.parse(
    Buffer.concat(stdinBuffer).toString('utf-8')
  );

  // Extract knowledge from session
  const { session_id, cwd, transcript_path } = input;
  // ... knowledge extraction logic ...

  // Import and call Weave
  const { updateWeaveFromSession } = await import(
    join(cwd, '.agent/weave/session-update.ts')
  );
  await updateWeaveFromSession(sessionData);

  // Return success
  process.stdout.write(JSON.stringify({ continue: true }) + '\n');
  process.exit(0);
}

main();
```

**Make it executable**:
```bash
chmod +x .agent/hooks/SessionEnd.ts
```

**Test it**:
```bash
# Verify it's executable
ls -la .agent/hooks/SessionEnd.ts
# Should show: -rwxr-xr-x

# End a Claude Code session and look for output:
# [Weave SessionEnd] Session ending: <session-id>
# [Weave SessionEnd] ✅ Knowledge updated
```

---

## Configuration

### Adjusting Confidence Parameters

Edit `.agent/weave/epistemology.json`:

```json
{
  "confidenceModel": {
    "bayesianParameters": {
      "priorWeight": 0.3,      // Weight given to existing belief (0-1)
      "evidenceWeight": 0.7,   // Weight given to new evidence (0-1)
      "minObservations": 1     // Minimum observations before high confidence
    }
  }
}
```

**Recommendations**:
- **Conservative**: `priorWeight: 0.5, evidenceWeight: 0.5` - Slower learning, more stable
- **Aggressive**: `priorWeight: 0.2, evidenceWeight: 0.8` - Faster learning, less stable
- **Default**: `priorWeight: 0.3, evidenceWeight: 0.7` - Balanced

### Excluding Files from Knowledge

Add to `.gitignore` or create `.weave ignore` (future feature):

```
# Don't learn from these
/secrets/
*.secret.*
.env
.env.*
```

---

## Verification

### Check Installation

```bash
cd /path/to/your-project

# Directory structure
ls -la .agent/weave/
# Should show: types.ts, index.ts, extraction.ts, etc.

ls -la .agent/hooks/
# Should show: SessionEnd.ts (executable)

# JSON files initialized
cat .agent/weave/meta.json | jq .
# Should show version, stats, health

# Test system
bun .agent/weave/test.ts
# Should pass 7 tests
```

### Test Knowledge Extraction

```bash
# Run E2E test
bun .agent/weave/test-e2e.ts

# Expected output:
# ✅ Session extraction test passed
# ✅ Ontology update test passed
# ✅ Mereology update test passed
# ✅ Epistemology update test passed
# ✅ Qualia update test passed
```

### Monitor Real-Time

```bash
# Start monitor
bun .agent/weave/weave.ts monitor

# Open Claude Code in another terminal
# Work on tasks
# End session with /clear
# Watch monitor update!
```

---

## Post-Installation

### Start Using Weave

1. **Open Claude Code** in your project directory
2. **Work normally** - Weave captures automatically
3. **End session** with `/clear` or logout
4. **Check knowledge**: `bun .agent/weave/test.ts`

### Monitor Progress

```bash
# Real-time dashboard
bun .agent/weave/weave.ts monitor

# Quick check
bun .agent/weave/test.ts

# View specific dimension
cat .agent/weave/ontology.json | jq '.entities | keys'
cat .agent/weave/qualia.json | jq '.painPoints'
```

### Testing Learning

For comprehensive testing, use the work tasks:

```bash
# View available test tasks
cat .agent/weave/WORK-TASKS.md

# Or use guided questions
cat .agent/weave/TEST-QUESTIONS.md
```

See [QUICK-START-TESTING.md](./QUICK-START-TESTING.md) for details.

---

## Troubleshooting

### Installation Issues

**Problem**: `bun weave.ts install` fails with "permission denied"

**Solution**:
```bash
# Make weave.ts executable
chmod +x /path/to/weave.ts

# Or run directly
bun /path/to/weave.ts install
```

---

**Problem**: Files copied but hook not working

**Solution**:
```bash
# Verify hook is executable
ls -la .agent/hooks/SessionEnd.ts

# Fix permissions
chmod +x .agent/hooks/SessionEnd.ts

# Check shebang
head -1 .agent/hooks/SessionEnd.ts
# Should be: #!/usr/bin/env bun
```

---

### Runtime Issues

**Problem**: SessionEnd hook not firing

**Solution**:
1. Check Claude Code hook configuration
2. Verify hook permissions: `ls -la .agent/hooks/`
3. Test manually: `echo '{"session_id":"test","cwd":"'$(pwd)'","transcript_path":"/tmp/test.jsonl","hook_event_name":"SessionEnd","reason":"clear"}' | bun .agent/hooks/SessionEnd.ts`

---

**Problem**: Monitor shows "Weave not found"

**Solution**:
```bash
# Must run from directory with Weave installed
cd /path/to/project-with-weave
bun .agent/weave/weave.ts monitor
```

---

**Problem**: Knowledge not updating

**Solution**:
1. Check hook output when ending sessions
2. Verify JSON file timestamps: `ls -lt .agent/weave/*.json`
3. Run manual test: `bun .agent/weave/test-e2e.ts`
4. Check for errors in transcript

---

### Test Failures

**Problem**: `test.ts` fails with "undefined is not an object"

**Solution**:
This is expected on empty knowledge base. It's testing update functionality. Add some knowledge first by running a Claude Code session, or ignore this particular test.

---

**Problem**: `test-e2e.ts` fails

**Solution**:
```bash
# Ensure all dependencies available
bun install

# Check Bun version
bun --version
# Should be 1.0.0 or higher

# Verify file permissions
ls -la .agent/weave/*.ts
# All should be readable
```

---

## Uninstallation

### Remove Weave

```bash
# Remove all Weave files
rm -rf .agent/weave
rm -rf .agent/hooks/SessionEnd.ts

# Or keep knowledge, remove system
rm .agent/weave/{types,index,extraction,session-update,test,test-e2e,weave}.ts
rm .agent/weave/{README,SCHEMA,*.md}
# Keeps .json files
```

### Backup Knowledge Before Removal

```bash
# Backup knowledge
mkdir -p ~/weave-backups/$(basename $(pwd))
cp .agent/weave/*.json ~/weave-backups/$(basename $(pwd))/

# Later restore
cp ~/weave-backups/project-name/*.json .agent/weave/
```

---

## Advanced Configuration

### Custom Knowledge Location

By default, knowledge is stored in `.agent/weave/*.json`. To use a different location:

1. Edit `.agent/hooks/SessionEnd.ts`:
   ```typescript
   const weavePath = join(cwd, 'custom/path/to/weave');
   ```

2. Update all paths in hook and core files

3. Set environment variable:
   ```bash
   export WEAVE_PATH=/custom/path
   ```

### Integration with Other Tools

Weave can integrate with:

- **CI/CD**: Archive knowledge as build artifacts
- **Documentation**: Generate docs from Qualia pain points
- **Testing**: Use Epistemology confidence for test prioritization
- **Onboarding**: Share knowledge with new team members

See individual tool documentation for integration examples.

---

## Next Steps

After installation:

1. **Read**: [README.md](./README.md) - Weave API and concepts
2. **Test**: [QUICK-START-TESTING.md](./QUICK-START-TESTING.md) - Test learning
3. **Monitor**: [WEAVE-CLI.md](./WEAVE-CLI.md) - CLI usage
4. **Distribute**: [DISTRIBUTION.md](./DISTRIBUTION.md) - Install in more projects

---

**Version**: 1.0.0
**Last Updated**: November 2024
**Maintainer**: Weave Development Team
