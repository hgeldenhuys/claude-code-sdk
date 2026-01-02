#!/usr/bin/env bun
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';

const weaveDir = path.join(import.meta.dir, '..');

const dimensions = ['qualia', 'epistemology', 'ontology', 'mereology', 'causation', 'axiology', 'teleology', 'history', 'praxeology', 'modality', 'deontics'];

console.log('📊 Generating summary.md from dimension files...\n');

const stats: Record<string, any> = {};

for (const dim of dimensions) {
  const filePath = path.join(weaveDir, `${dim}.json`);
  const data = JSON.parse(readFileSync(filePath, 'utf-8'));
  stats[dim] = data.metadata || {};
}

const summary = `# Weave Knowledge Summary

**Framework:** 11 dimensions (Q+E+O+M+C+A+T+Η+Π+Μ+Δ)
**Version:** 2.0.0
**Last Updated:** ${new Date().toISOString().split('T')[0]}

## Quick Stats

${dimensions.map(dim => {
  const meta = stats[dim];
  const symbol = getSymbol(dim);
  return `- **${symbol} (${capitalize(dim)}):** ${formatStats(meta)}`;
}).join('\n')}

## Query for Details

Use query scripts for detailed information:
- \`bun .agent/weave/scripts/query.ts <dimension>:<entity-id>\` - Get specific entity
- \`bun .agent/weave/scripts/search.ts "<term>"\` - Search across dimensions
- \`bun .agent/weave/scripts/related.ts <id>\` - Find related knowledge

*This summary represents ~2.8% of full knowledge base. Query full dimensions when needed.*
`;

writeFileSync(path.join(weaveDir, 'summary.md'), summary);
console.log('✅ Generated summary.md');
console.log(`📊 Token estimate: ~${Math.floor(summary.length / 4)} tokens`);

function getSymbol(dim: string): string {
  const map: Record<string, string> = {
    'qualia': 'Q', 'epistemology': 'E', 'ontology': 'O', 'mereology': 'M',
    'causation': 'C', 'axiology': 'A', 'teleology': 'T',
    'history': 'Η', 'praxeology': 'Π', 'modality': 'Μ', 'deontics': 'Δ'
  };
  return map[dim] || '?';
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatStats(meta: any): string {
  const keys = Object.keys(meta).filter(k => k.startsWith('total'));
  return keys.map(k => `${meta[k]} ${k.replace('total', '').toLowerCase()}`).join(', ');
}
