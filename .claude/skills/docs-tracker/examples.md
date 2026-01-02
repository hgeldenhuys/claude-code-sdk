# DocsTracker Examples

## Common Workflows

### 1. Initial Setup - Fetch All Documentation

```bash
# First time setup - fetches 23 docs (~5 seconds, 330KB)
bun run docs:fetch
```

Output:
```
Fetching Claude Code documentation...

Fetch Complete:
  Total: 23
  Success: 23
  Failed: 0
  Changes Detected: 0
  Duration: 5.4s
```

### 2. Check for Documentation Updates

```bash
# Check if any docs changed since last fetch
bun run docs:check
```

Output when no changes:
```
Checking for documentation changes...

No changes detected in any documents.
```

Output when changes detected:
```
Checking for documentation changes...

Found 2 document(s) with changes:

  https://code.claude.com/docs/en/hooks.md
    +15/-3 lines, 1 new sections
    New sections: ## New Hook Event

  https://code.claude.com/docs/en/plugins.md
    +8/-2 lines
```

### 3. Search Documentation

```bash
# Search for hooks-related content
bun run docs search "PreToolUse"
```

Output:
```
Searching for "PreToolUse"...

Found 4 document(s) with matches:

Hooks reference
    `PreToolUse`, `PermissionRequest`, and `PostToolUse`)
    * **PreToolUse**: Make context-aware permission decisions
    ### PreToolUse
    ... and 7 more matches

Get started with Claude Code hooks
    * **PreToolUse**: Runs before tool calls (can block them)
    ... and 2 more matches
```

### 4. List Documentation by Category

```bash
# List all development docs
bun run docs list development
```

Output:
```
Documents in category "development":

[DEVELOPMENT]
  Hooks reference
    URL: https://code.claude.com/docs/en/hooks.md
    Version: 1 | Last fetched: 12/14/2025
  Agent Skills
    URL: https://code.claude.com/docs/en/skills.md
    Version: 1 | Last fetched: 12/14/2025
  ...
```

### 5. View Cache Status

```bash
bun run docs:status
```

Output:
```
Documentation Cache Status:

  Total documents: 23
  Docs with changes: 0
  Cache size: 331.3 KB
  Last update: 12/14/2025, 10:39:05 PM
  Oldest doc: 12/14/2025, 10:39:00 PM
  Newest doc: 12/14/2025, 10:39:05 PM

  Registered sources: 23
```

## Programmatic Examples

### Basic Usage

```typescript
import { DocsTracker } from 'claude-code-sdk';

const tracker = new DocsTracker();
await tracker.init();

// Get cache status
const status = await tracker.getCacheStatus();
console.log(`Cached: ${status.totalDocs} docs (${status.cacheSizeBytes} bytes)`);
```

### Fetch and Check for Changes

```typescript
import { DocsTracker } from 'claude-code-sdk';

const tracker = new DocsTracker();
await tracker.init();

// Fetch all documentation
const fetchResult = await tracker.fetchAll();
console.log(`Fetched ${fetchResult.successCount}/${fetchResult.totalDocs} docs`);
console.log(`Changes detected: ${fetchResult.changesDetected}`);

// Later, check for changes
const deltas = await tracker.checkAllForChanges();
const changed = deltas.filter(d => d.hasChanges);

if (changed.length > 0) {
  console.log('Documentation has been updated:');
  for (const delta of changed) {
    console.log(`  ${delta.url}`);
    if (delta.diffSummary) {
      console.log(`    ${delta.diffSummary.summary}`);
    }
  }
}
```

### Search Documentation

```typescript
import { DocsTracker } from 'claude-code-sdk';

const tracker = new DocsTracker();
await tracker.init();

// Search for specific content
const results = await tracker.searchContent('SessionStart');

for (const result of results) {
  const meta = tracker.getMetadata(result.url);
  console.log(`\n${meta?.title}:`);
  for (const match of result.matches.slice(0, 3)) {
    console.log(`  - ${match.substring(0, 80)}...`);
  }
}
```

### Filter by Category

```typescript
import { DocsTracker } from 'claude-code-sdk';

const tracker = new DocsTracker();
await tracker.init();

// Get all development documentation
const devDocs = tracker.getByCategory('development');
console.log('Development docs:');
for (const doc of devDocs) {
  console.log(`  ${doc.title} (v${doc.version})`);
}

// Get docs by tag
const hookDocs = tracker.getByTag('hooks');
console.log('\nHooks-related docs:');
for (const doc of hookDocs) {
  console.log(`  ${doc.title}`);
}
```

### Read Cached Content

```typescript
import { DocsTracker } from 'claude-code-sdk';

const tracker = new DocsTracker();
await tracker.init();

// Get cached content for a specific doc
const hooksContent = await tracker.getCachedContent(
  'https://code.claude.com/docs/en/hooks.md'
);

if (hooksContent) {
  // Extract specific section
  const lines = hooksContent.split('\n');
  const preToolUseSection = [];
  let inSection = false;

  for (const line of lines) {
    if (line.startsWith('### PreToolUse')) {
      inSection = true;
    } else if (line.startsWith('### ') && inSection) {
      break;
    }
    if (inSection) {
      preToolUseSection.push(line);
    }
  }

  console.log(preToolUseSection.join('\n'));
}
```

### Generate Documentation Index

```typescript
import { DocsTracker } from 'claude-code-sdk';

const tracker = new DocsTracker();
await tracker.init();

const index = await tracker.generateIndex();

console.log('Documentation Index');
console.log(`Total: ${index.documents.length} documents`);
console.log('\nBy category:');
for (const [category, count] of Object.entries(index.categories)) {
  if (count > 0) {
    console.log(`  ${category}: ${count}`);
  }
}

// Find docs with unreviewed changes
const changed = index.documents.filter(d => d.hasUnreviewedChanges);
if (changed.length > 0) {
  console.log('\nDocs with unreviewed changes:');
  for (const doc of changed) {
    console.log(`  - ${doc.title}`);
  }
}
```

## Monitoring Workflow

Set up a daily check for documentation changes:

```typescript
import { DocsTracker } from 'claude-code-sdk';

async function checkForDocUpdates() {
  const tracker = new DocsTracker();
  await tracker.init();

  // Check if we need to refresh (default: 24 hours)
  const status = await tracker.getCacheStatus();
  const hoursSinceUpdate = status.lastFullUpdate
    ? (Date.now() - status.lastFullUpdate.getTime()) / (1000 * 60 * 60)
    : Infinity;

  if (hoursSinceUpdate >= 24) {
    console.log('Checking for documentation updates...');
    const result = await tracker.fetchAll();

    if (result.changesDetected > 0) {
      console.log(`Found ${result.changesDetected} updated documents!`);

      // Get changed docs
      const changedDocs = tracker.getChangedDocs();
      for (const doc of changedDocs) {
        console.log(`  - ${doc.title} (v${doc.version})`);
      }
    } else {
      console.log('No documentation changes detected.');
    }
  }
}
```
