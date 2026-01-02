#!/usr/bin/env bun
/**
 * CLI for managing Claude Code documentation cache
 *
 * Commands:
 *   fetch    - Fetch all documentation
 *   check    - Check for documentation changes
 *   list     - List cached documents
 *   search   - Search documentation content
 *   status   - Show cache status
 *   clear    - Clear the cache
 *   diff     - Show changes for a specific document
 *   deltas   - Show recorded deltas (change history)
 */

import { DocsTracker } from '../docs/index.ts';
import type { DocCategory } from '../docs/types.ts';

const tracker = new DocsTracker({
  cacheDir: '.claude-code-sdk/docs-cache',
});

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'fetch':
      await fetchDocs(args.slice(1));
      break;
    case 'check':
      await checkChanges(args.slice(1));
      break;
    case 'list':
      await listDocs(args.slice(1));
      break;
    case 'search':
      await searchDocs(args.slice(1));
      break;
    case 'status':
      await showStatus();
      break;
    case 'clear':
      await clearCache();
      break;
    case 'diff':
      await showDiff(args.slice(1));
      break;
    case 'index':
      await generateIndex();
      break;
    case 'deltas':
      await showDeltas(args.slice(1));
      break;
    default:
      showHelp();
  }
}

async function fetchDocs(args: string[]): Promise<void> {
  console.log('Fetching Claude Code documentation...\n');

  await tracker.init();
  const result = await tracker.fetchAll();

  console.log('\nFetch Complete:');
  console.log(`  Total: ${result.totalDocs}`);
  console.log(`  Success: ${result.successCount}`);
  console.log(`  Failed: ${result.failureCount}`);
  console.log(`  Changes Detected: ${result.changesDetected}`);
  console.log(`  Duration: ${(result.duration / 1000).toFixed(1)}s`);

  if (result.failureCount > 0) {
    console.log('\nFailed documents:');
    for (const r of result.results) {
      if (!r.success) {
        console.log(`  - ${r.url}: ${r.error}`);
      }
    }
  }
}

async function checkChanges(args: string[]): Promise<void> {
  console.log('Checking for documentation changes...\n');

  await tracker.init();
  const results = await tracker.checkAllForChanges();

  const changed = results.filter((r) => r.hasChanges);

  if (changed.length === 0) {
    console.log('No changes detected in any documents.');
  } else {
    console.log(`Found ${changed.length} document(s) with changes:\n`);
    for (const result of changed) {
      console.log(`  ${result.url}`);
      if (result.diffSummary) {
        console.log(`    ${result.diffSummary.summary}`);
        if (result.diffSummary.changedSections.length > 0) {
          console.log(`    New sections: ${result.diffSummary.changedSections.join(', ')}`);
        }
      }
    }
  }
}

async function listDocs(args: string[]): Promise<void> {
  await tracker.init();
  const category = args[0] as DocCategory | undefined;

  let docs = tracker.getAllMetadata();
  if (category) {
    docs = tracker.getByCategory(category);
    console.log(`Documents in category "${category}":\n`);
  } else {
    console.log('All cached documents:\n');
  }

  if (docs.length === 0) {
    console.log('  No documents cached. Run "docs fetch" first.');
    return;
  }

  // Group by category
  const byCategory = new Map<DocCategory, typeof docs>();
  for (const doc of docs) {
    const existing = byCategory.get(doc.category) ?? [];
    existing.push(doc);
    byCategory.set(doc.category, existing);
  }

  for (const [cat, catDocs] of byCategory) {
    console.log(`\n[${cat.toUpperCase()}]`);
    for (const doc of catDocs) {
      const changed = doc.version > 1 ? ' (changed)' : '';
      console.log(`  ${doc.title}${changed}`);
      console.log(`    URL: ${doc.url}`);
      console.log(
        `    Version: ${doc.version} | Last fetched: ${doc.lastFetched.toLocaleDateString()}`
      );
    }
  }
}

async function searchDocs(args: string[]): Promise<void> {
  const query = args.join(' ');
  if (!query) {
    console.log('Usage: docs search <query>');
    return;
  }

  console.log(`Searching for "${query}"...\n`);

  await tracker.init();
  const results = await tracker.searchContent(query);

  if (results.length === 0) {
    console.log('No matches found.');
    return;
  }

  console.log(`Found ${results.length} document(s) with matches:\n`);
  for (const result of results) {
    const meta = tracker.getMetadata(result.url);
    console.log(`${meta?.title ?? result.url}`);
    for (const match of result.matches.slice(0, 3)) {
      console.log(`    ${match.substring(0, 100)}${match.length > 100 ? '...' : ''}`);
    }
    if (result.matches.length > 3) {
      console.log(`    ... and ${result.matches.length - 3} more matches`);
    }
    console.log('');
  }
}

async function showStatus(): Promise<void> {
  await tracker.init();
  const status = await tracker.getCacheStatus();

  console.log('Documentation Cache Status:\n');
  console.log(`  Total documents: ${status.totalDocs}`);
  console.log(`  Docs with changes: ${status.docsWithChanges}`);
  console.log(`  Cache size: ${(status.cacheSizeBytes / 1024).toFixed(1)} KB`);
  if (status.lastFullUpdate) {
    console.log(`  Last update: ${status.lastFullUpdate.toLocaleString()}`);
  }
  if (status.oldestDoc) {
    console.log(`  Oldest doc: ${status.oldestDoc.toLocaleString()}`);
  }
  if (status.newestDoc) {
    console.log(`  Newest doc: ${status.newestDoc.toLocaleString()}`);
  }

  // Show sources
  const sources = tracker.getSources();
  console.log(`\n  Registered sources: ${sources.length}`);
}

async function clearCache(): Promise<void> {
  console.log('Clearing documentation cache...');
  await tracker.init();
  await tracker.clearCache();
  console.log('Cache cleared.');
}

async function showDiff(args: string[]): Promise<void> {
  const url = args[0];
  if (!url) {
    console.log('Usage: docs diff <url>');
    return;
  }

  await tracker.init();

  try {
    const result = await tracker.checkForChanges(url);

    if (!result.hasChanges) {
      console.log('No changes detected for this document.');
      return;
    }

    console.log('Changes detected:\n');
    if (result.diffSummary) {
      console.log(`  Lines added: ${result.diffSummary.linesAdded}`);
      console.log(`  Lines removed: ${result.diffSummary.linesRemoved}`);
      if (result.diffSummary.changedSections.length > 0) {
        console.log('  Changed sections:');
        for (const section of result.diffSummary.changedSections) {
          console.log(`    - ${section}`);
        }
      }
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function generateIndex(): Promise<void> {
  console.log('Generating documentation index...\n');

  await tracker.init();
  const index = await tracker.generateIndex();

  console.log(`Documentation Index (${index.documents.length} documents)\n`);
  console.log(`Last updated: ${index.lastUpdated.toLocaleString()}\n`);

  console.log('Categories:');
  for (const [category, count] of Object.entries(index.categories)) {
    if (count > 0) {
      console.log(`  ${category}: ${count}`);
    }
  }

  console.log('\nDocuments with unreviewed changes:');
  const changed = index.documents.filter((d) => d.hasUnreviewedChanges);
  if (changed.length === 0) {
    console.log('  None');
  } else {
    for (const doc of changed) {
      console.log(`  - ${doc.title}`);
    }
  }
}

async function showDeltas(args: string[]): Promise<void> {
  await tracker.init();

  const subcommand = args[0];

  if (subcommand === 'review') {
    const deltaId = args[1];
    if (!deltaId) {
      console.log('Usage: docs deltas review <delta-id>');
      console.log('       docs deltas review-all');
      return;
    }
    const success = await tracker.markDeltaReviewed(deltaId);
    if (success) {
      console.log(`Delta ${deltaId} marked as reviewed.`);
    } else {
      console.log(`Delta ${deltaId} not found.`);
    }
    return;
  }

  if (subcommand === 'review-all') {
    const count = await tracker.markAllDeltasReviewed();
    console.log(`Marked ${count} delta(s) as reviewed.`);
    return;
  }

  const showUnreviewedOnly = args.includes('--unreviewed') || args.includes('-u');
  const deltas = showUnreviewedOnly ? tracker.getUnreviewedDeltas() : tracker.getDeltaHistory();

  if (deltas.length === 0) {
    if (showUnreviewedOnly) {
      console.log('No unreviewed deltas. All changes have been reviewed.');
    } else {
      console.log(
        'No deltas recorded yet. Run "docs fetch" after the cache exists to detect changes.'
      );
    }
    return;
  }

  const stats = tracker.getDeltaStats();
  console.log(`Delta History (${stats.total} total, ${stats.unreviewed} unreviewed)\n`);

  if (showUnreviewedOnly) {
    console.log('Showing unreviewed deltas only:\n');
  }

  // Group deltas by date
  const byDate = new Map<string, typeof deltas>();
  for (const delta of deltas) {
    const dateKey = delta.detectedAt.toLocaleDateString();
    const existing = byDate.get(dateKey) ?? [];
    existing.push(delta);
    byDate.set(dateKey, existing);
  }

  for (const [date, dateDeltas] of byDate) {
    console.log(`\n[${date}]`);
    for (const delta of dateDeltas) {
      const reviewed = delta.reviewed ? ' [reviewed]' : ' [NEW]';
      console.log(`  ${delta.title}${reviewed}`);
      console.log(`    Version: ${delta.previousVersion} -> ${delta.newVersion}`);
      console.log(`    Changes: ${delta.diffSummary.summary}`);
      if (delta.diffSummary.changedSections.length > 0) {
        console.log(
          `    New sections: ${delta.diffSummary.changedSections.slice(0, 3).join(', ')}${delta.diffSummary.changedSections.length > 3 ? '...' : ''}`
        );
      }
      console.log(`    ID: ${delta.id}`);
    }
  }

  console.log('\nCommands:');
  console.log('  docs deltas --unreviewed    Show only unreviewed deltas');
  console.log('  docs deltas review <id>     Mark a delta as reviewed');
  console.log('  docs deltas review-all      Mark all deltas as reviewed');
}

function showHelp(): void {
  console.log(`
Claude Code Documentation Tracker

Usage: bun src/cli/docs.ts <command> [options]

Commands:
  fetch           Fetch all registered documentation
  check           Check for changes without downloading
  list [category] List cached documents (optionally by category)
  search <query>  Search documentation content
  status          Show cache status
  clear           Clear the documentation cache
  diff <url>      Show changes for a specific document
  index           Generate documentation index
  deltas          Show recorded deltas (change history)
    --unreviewed    Show only unreviewed deltas
    review <id>     Mark a delta as reviewed
    review-all      Mark all deltas as reviewed

Categories:
  core, development, configuration, integration,
  reference, enterprise, ide, cicd, troubleshooting

Examples:
  bun src/cli/docs.ts fetch
  bun src/cli/docs.ts list development
  bun src/cli/docs.ts search "hooks"
  bun src/cli/docs.ts check
`);
}

main().catch(console.error);
