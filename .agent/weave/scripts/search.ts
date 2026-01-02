#!/usr/bin/env bun
import { readFileSync } from 'fs';
import path from 'path';

// Usage: bun search.ts "<term>"
// Usage: bun search.ts --dimension=q "<term>"
// Example: bun search.ts "delegation"
// Example: bun search.ts --dimension=π "context"

const weaveDir = path.join(import.meta.dir, '..');
const args = process.argv.slice(2);

let dimensionFilter: string | null = null;
let searchTerm: string | null = null;

for (const arg of args) {
  if (arg.startsWith('--dimension=')) {
    const abbrev = arg.split('=')[1].toLowerCase();
    const dimensionMap: Record<string, string> = {
      'q': 'qualia', 'e': 'epistemology', 'o': 'ontology', 'm': 'mereology',
      'c': 'causation', 'a': 'axiology', 't': 'teleology',
      'h': 'history', 'η': 'history',
      'p': 'praxeology', 'π': 'praxeology',
      'mod': 'modality', 'μ': 'modality',
      'd': 'deontics', 'δ': 'deontics'
    };
    dimensionFilter = dimensionMap[abbrev] || abbrev;
  } else {
    searchTerm = arg;
  }
}

if (!searchTerm) {
  console.error('Usage: bun search.ts [--dimension=<dim>] "<term>"');
  process.exit(1);
}

const dimensions = dimensionFilter
  ? [dimensionFilter]
  : ['qualia', 'epistemology', 'ontology', 'mereology', 'causation', 'axiology', 'teleology', 'history', 'praxeology', 'modality', 'deontics'];

let totalResults = 0;

for (const dimension of dimensions) {
  try {
    const filePath = path.join(weaveDir, `${dimension}.json`);
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));

    for (const [collection, items] of Object.entries(data)) {
      if (collection === 'metadata' || collection === '$schema' || typeof items !== 'object') continue;

      for (const [id, item] of Object.entries(items as Record<string, any>)) {
        const itemStr = JSON.stringify(item).toLowerCase();
        if (itemStr.includes(searchTerm.toLowerCase())) {
          console.log(`\n📍 ${dimension}.${collection}.${id}`);
          console.log(`   ${item.title || item.name || item.description || id}`);
          totalResults++;
        }
      }
    }
  } catch (error) {
    // Skip missing dimensions
  }
}

console.log(`\n✅ Found ${totalResults} results for "${searchTerm}"`);
