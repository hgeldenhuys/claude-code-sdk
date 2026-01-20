#!/usr/bin/env bun
/**
 * Patch blessed library to suppress terminfo parsing errors
 *
 * The blessed library logs verbose errors when parsing certain terminal
 * capabilities (like Setulc for underline color). This patch silences
 * those errors by wrapping them in a try/catch that doesn't log.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const tputPath = join(import.meta.dir, '../node_modules/blessed/lib/tput.js');

if (!existsSync(tputPath)) {
  console.log('blessed not installed, skipping patch');
  process.exit(0);
}

const content = readFileSync(tputPath, 'utf-8');

// Check if already patched
if (content.includes('// PATCHED: suppress terminfo errors')) {
  console.log('blessed already patched');
  process.exit(0);
}

// Replace the console.error calls with silent handling
const patched = content.replace(
  /} catch \(e\) \{\s*console\.error\(''\);\s*console\.error\('Error on %s:', tkey\);\s*console\.error\(JSON\.stringify\(str\)\);\s*console\.error\(''\);\s*console\.error\(code\.replace\(\/\(,\|\;\)\/g, '\$1\\n'\)\);\s*e\.stack = e\.stack\.replace\(\/\\x1b\/g, '\\\\x1b'\);\s*throw e;/,
  `} catch (e) {
    // PATCHED: suppress terminfo errors (Setulc parsing on modern terminals)
    // Original code logged verbose errors and threw - we just return a noop function
    return function() { return ''; };`
);

if (patched === content) {
  console.log('Could not find pattern to patch in blessed/lib/tput.js');
  console.log('The library may have been updated. Manual review needed.');
  process.exit(1);
}

writeFileSync(tputPath, patched);
console.log('✓ Patched blessed to suppress terminfo errors');
