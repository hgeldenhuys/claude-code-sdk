#!/usr/bin/env bun
import { readFileSync } from 'fs';
import path from 'path';

// Usage: bun related.ts <entity-id>
// Example: bun related.ts agios-platform
// Finds all references to this entity across all dimensions

const weaveDir = path.join(import.meta.dir, '..');
const [entityId] = process.argv.slice(2);

if (!entityId) {
  console.error('Usage: bun related.ts <entity-id>');
  process.exit(1);
}

const dimensions = ['qualia', 'epistemology', 'ontology', 'mereology', 'causation', 'axiology', 'teleology', 'history', 'praxeology', 'modality', 'deontics'];

console.log(`\n🔍 Finding knowledge related to: ${entityId}\n`);

for (const dimension of dimensions) {
  try {
    const filePath = path.join(weaveDir, `${dimension}.json`);
    const content = readFileSync(filePath, 'utf-8');

    if (content.includes(entityId)) {
      const data = JSON.parse(content);
      console.log(`📍 ${dimension.toUpperCase()}:`);

      for (const [collection, items] of Object.entries(data)) {
        if (collection === 'metadata' || collection === '$schema' || typeof items !== 'object') continue;

        for (const [id, item] of Object.entries(items as Record<string, any>)) {
          if (JSON.stringify(item).includes(entityId)) {
            console.log(`   - ${collection}.${id}: ${item.title || item.name || item.description || id}`);
          }
        }
      }
    }
  } catch (error) {
    // Skip errors
  }
}
