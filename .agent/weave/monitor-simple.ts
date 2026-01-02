#!/usr/bin/env bun
/**
 * Weave Real-Time Monitor - Zero Dependencies
 * Uses only built-in Node/Bun features
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Check for Weave installation
const weavePath = join(process.cwd(), '.agent/weave');
if (!existsSync(weavePath)) {
  console.error('\x1b[31m❌ Weave not found in current directory\x1b[0m');
  console.error('\x1b[90m   Expected: .agent/weave/\x1b[0m');
  console.error('\x1b[33m\nRun: bun weave.ts install\x1b[0m');
  process.exit(1);
}

// ANSI color codes
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  gray: '\x1b[90m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
};

// Read JSON helper
function readJson(path: string): any {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return {};
  }
}

// Get health icon and color
function getHealthDisplay(health: string): { icon: string; color: string } {
  switch (health) {
    case 'nascent': return { icon: '🌱', color: c.gray };
    case 'developing': return { icon: '🌿', color: c.yellow };
    case 'good': return { icon: '🌳', color: c.green };
    case 'excellent': return { icon: '🌲', color: c.cyan };
    default: return { icon: '❓', color: c.white };
  }
}

// Compact progress bar
function bar(value: number, max: number, width: number = 15): string {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;

  // Color gradient based on percentage
  let color = c.cyan;
  if (pct >= 80) color = c.green;
  else if (pct >= 50) color = c.cyan;
  else if (pct >= 25) color = c.yellow;
  else color = c.red;

  return color + '█'.repeat(filled) + c.gray + '░'.repeat(empty) + c.reset;
}

// Format compact metric row
function metric(label: string, value: number | string, max: number = 100): string {
  const lab = String(label).padEnd(18);
  const val = String(value).padStart(4);
  const numVal = typeof value === 'string' && value.includes('%')
    ? parseInt(value)
    : typeof value === 'number' ? value : 0;

  return `  ${c.dim}${lab}${c.reset} ${c.bold}${val}${c.reset}  ${bar(numVal, max)}`;
}

// Section header
function section(title: string, icon: string, color: string): string {
  return `${color}${c.bold}${icon} ${title}${c.reset}`;
}

// Render dashboard
function renderDashboard() {
  console.clear();

  // Read all knowledge files
  const ontology = readJson(join(weavePath, 'ontology.json'));
  const mereology = readJson(join(weavePath, 'mereology.json'));
  const epistemology = readJson(join(weavePath, 'epistemology.json'));
  const qualia = readJson(join(weavePath, 'qualia.json'));
  const causation = readJson(join(weavePath, 'causation.json'));
  const axiology = readJson(join(weavePath, 'axiology.json'));
  const teleology = readJson(join(weavePath, 'teleology.json'));
  const history = readJson(join(weavePath, 'history.json'));
  const praxeology = readJson(join(weavePath, 'praxeology.json'));
  const modality = readJson(join(weavePath, 'modality.json'));
  const deontics = readJson(join(weavePath, 'deontics.json'));
  const meta = readJson(join(weavePath, 'meta.json'));

  // Header
  const health = meta?.health?.status || 'unknown';
  const { icon, color } = getHealthDisplay(health);
  const lastUpdated = meta?.lastUpdated
    ? new Date(meta.lastUpdated).toLocaleTimeString()
    : c.gray + 'Never' + c.reset;

  console.log(`\n${c.cyan}${c.bold}🌊 WEAVE KNOWLEDGE MONITOR (Q+E+O+M+C+A+T+Η+Π+Μ+Δ)${c.reset} ${c.gray}━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`);
  console.log(`${c.dim}Status:${c.reset} ${color}${icon} ${health.toUpperCase()}${c.reset}  ${c.dim}│${c.reset}  ${c.dim}Updated:${c.reset} ${lastUpdated}`);

  // Extract metrics for all dimensions
  const oEntities = Object.keys(ontology?.entities || {}).length;
  const oRelations = Object.keys(ontology?.relations || {}).length;
  const oConstraints = Object.keys(ontology?.constraints || {}).length;
  const oConfidence = Math.round((ontology?.metadata?.averageConfidence || 0) * 100);

  const mComponents = Object.keys(mereology?.components || {}).length;
  const mCompositions = Object.keys(mereology?.compositions || {}).length;
  const mDepth = mereology?.metadata?.maxDepth || 0;
  const mConfidence = Math.round((mereology?.metadata?.averageConfidence || 0) * 100);

  const eKnowledge = Object.keys(epistemology?.knowledge || {}).length;
  const ePatterns = Object.keys(epistemology?.patterns || {}).length;
  const eValidations = Object.keys(epistemology?.validations || {}).length;
  const eConfidence = Math.round((epistemology?.metadata?.averageConfidence || 0) * 100);

  const qExperiences = Object.keys(qualia?.experiences || {}).length;
  const qPainPoints = Object.keys(qualia?.painPoints || {}).length;
  const qSolutions = Object.keys(qualia?.solutions || {}).length;
  const qBestPractices = Object.keys(qualia?.bestPractices || {}).length;

  const cCausalChains = Object.keys(causation?.causalChains || {}).length;
  const cRootCauses = Object.keys(causation?.rootCauses || {}).length;
  const cMechanisms = Object.keys(causation?.mechanisms || {}).length;
  const cConfidence = Math.round((causation?.metadata?.averageConfidence || 0) * 100);

  const aValueJudgments = Object.keys(axiology?.valueJudgments || {}).length;
  const aTradeoffs = Object.keys(axiology?.tradeoffs || {}).length;
  const aQualityMetrics = Object.keys(axiology?.qualityMetrics || {}).length;
  const aConfidence = Math.round((axiology?.metadata?.averageConfidence || 0) * 100);

  const tPurposes = Object.keys(teleology?.purposes || {}).length;
  const tGoals = Object.keys(teleology?.goals || {}).length;
  const tIntents = Object.keys(teleology?.intents || {}).length;
  const tConfidence = Math.round((teleology?.metadata?.averageConfidence || 0) * 100);

  const hEvolutions = Object.keys(history?.evolutions || {}).length;
  const hTimelines = Object.keys(history?.timelines || {}).length;
  const hLegacyPatterns = Object.keys(history?.legacyPatterns || {}).length;
  const hConfidence = Math.round((history?.metadata?.averageConfidence || 0) * 100);

  const pWowPatterns = Object.keys(praxeology?.wowPatterns || {}).length;
  const pDelegationStrategies = Object.keys(praxeology?.delegationStrategies || {}).length;
  const pBestPractices = Object.keys(praxeology?.bestPractices || {}).length;
  const pConfidence = Math.round((praxeology?.metadata?.averageConfidence || 0) * 100);

  const mAlternatives = Object.keys(modality?.alternatives || {}).length;
  const mRejectedOptions = Object.keys(modality?.rejectedOptions || {}).length;
  const mPossibleFutures = Object.keys(modality?.possibleFutures || {}).length;
  const mConfidenceModal = Math.round((modality?.metadata?.averageConfidence || 0) * 100);

  const dObligations = Object.keys(deontics?.obligations || {}).length;
  const dPermissions = Object.keys(deontics?.permissions || {}).length;
  const dProhibitions = Object.keys(deontics?.prohibitions || {}).length;
  const dConfidence = Math.round((deontics?.metadata?.averageConfidence || 0) * 100);

  // 3-column layout helper
  const col1Width = 38;
  const col2Width = 38;
  const col3Width = 38;

  // Strip ANSI codes for length calculation
  function stripAnsi(str: string): string {
    return str.replace(/\x1b\[[0-9;]*m/g, '');
  }

  function threeCol(left: string, middle: string, right: string): string {
    const leftVisibleLength = stripAnsi(left).length;
    const leftPaddingNeeded = col1Width - leftVisibleLength;
    const leftPadded = left + ' '.repeat(Math.max(0, leftPaddingNeeded));

    const middleVisibleLength = stripAnsi(middle).length;
    const middlePaddingNeeded = col2Width - middleVisibleLength;
    const middlePadded = middle + ' '.repeat(Math.max(0, middlePaddingNeeded));

    return `${leftPadded}${c.dim}│${c.reset} ${middlePadded}${c.dim}│${c.reset} ${right}`;
  }

  // Row 1: Q + E + O
  console.log('\n' + threeCol(
    section('QUALIA', '[Q]', c.yellow),
    section('EPISTEMOLOGY', '[E]', c.green),
    section('ONTOLOGY', '[O]', c.blue)
  ));
  console.log(threeCol(
    metric('Experiences', qExperiences, 20),
    metric('Knowledge Items', eKnowledge, 50),
    metric('Entities', oEntities, 100)
  ));
  console.log(threeCol(
    metric('Pain Points', qPainPoints, 30),
    metric('Patterns', ePatterns, 30),
    metric('Relations', oRelations, 50)
  ));
  console.log(threeCol(
    metric('Solutions', qSolutions, 30),
    metric('Validations', eValidations, 20),
    metric('Constraints', oConstraints, 20)
  ));
  console.log(threeCol(
    metric('Best Practices', qBestPractices, 25),
    metric('Confidence', `${eConfidence}%`, 100),
    metric('Confidence', `${oConfidence}%`, 100)
  ));

  // Row 2: M + C + A
  console.log('\n' + threeCol(
    section('MEREOLOGY', '[M]', c.magenta),
    section('CAUSATION', '[C]', c.red),
    section('AXIOLOGY', '[A]', c.cyan)
  ));
  console.log(threeCol(
    metric('Components', mComponents, 50),
    metric('Causal Chains', cCausalChains, 30),
    metric('Value Judgments', aValueJudgments, 30)
  ));
  console.log(threeCol(
    metric('Compositions', mCompositions, 30),
    metric('Root Causes', cRootCauses, 20),
    metric('Tradeoffs', aTradeoffs, 25)
  ));
  console.log(threeCol(
    metric('Max Depth', mDepth, 10),
    metric('Mechanisms', cMechanisms, 25),
    metric('Quality Metrics', aQualityMetrics, 20)
  ));
  console.log(threeCol(
    metric('Confidence', `${mConfidence}%`, 100),
    metric('Confidence', `${cConfidence}%`, 100),
    metric('Confidence', `${aConfidence}%`, 100)
  ));

  // Row 3: T + Η + Π
  console.log('\n' + threeCol(
    section('TELEOLOGY', '[T]', c.magenta),
    section('HISTORY', '[Η]', c.white),
    section('PRAXEOLOGY', '[Π]', c.green)
  ));
  console.log(threeCol(
    metric('Purposes', tPurposes, 30),
    metric('Evolutions', hEvolutions, 20),
    metric('WoW Patterns', pWowPatterns, 25)
  ));
  console.log(threeCol(
    metric('Goals', tGoals, 25),
    metric('Timelines', hTimelines, 15),
    metric('Delegations', pDelegationStrategies, 20)
  ));
  console.log(threeCol(
    metric('Intents', tIntents, 20),
    metric('Legacy Patterns', hLegacyPatterns, 15),
    metric('Best Practices', pBestPractices, 25)
  ));
  console.log(threeCol(
    metric('Confidence', `${tConfidence}%`, 100),
    metric('Confidence', `${hConfidence}%`, 100),
    metric('Confidence', `${pConfidence}%`, 100)
  ));

  // Row 4: Μ + Δ + System Health
  console.log('\n' + threeCol(
    section('MODALITY', '[Μ]', c.blue),
    section('DEONTICS', '[Δ]', c.yellow),
    section('SYSTEM HEALTH', '♥', c.green)
  ));

  const ontologyCoverage = Math.round((meta?.health?.ontologyCoverage || 0) * 100);
  const epistemicConf = Math.round((meta?.health?.epistemicConfidence || 0) * 100);
  const qualiaDepth = Math.round((meta?.health?.qualiaDepth || 0) * 100);
  const totalSessions = meta?.stats?.totalSessions || 0;

  console.log(threeCol(
    metric('Alternatives', mAlternatives, 25),
    metric('Obligations', dObligations, 20),
    metric('Onto Coverage', `${ontologyCoverage}%`, 100)
  ));
  console.log(threeCol(
    metric('Rejected Options', mRejectedOptions, 20),
    metric('Permissions', dPermissions, 20),
    metric('Epistemic Conf', `${epistemicConf}%`, 100)
  ));
  console.log(threeCol(
    metric('Possible Futures', mPossibleFutures, 20),
    metric('Prohibitions', dProhibitions, 20),
    metric('Qualia Depth', `${qualiaDepth}%`, 100)
  ));
  console.log(threeCol(
    metric('Confidence', `${mConfidenceModal}%`, 100),
    metric('Confidence', `${dConfidence}%`, 100),
    `  ${c.dim}${'Total Sessions'.padEnd(18)}${c.reset} ${c.bold}${String(totalSessions).padStart(4)}${c.reset}  ${c.gray}${'━'.repeat(15)}${c.reset}`
  ));

  // Footer
  console.log(`\n${c.gray}${'━'.repeat(120)}${c.reset}`);
  console.log(`${c.dim}Press ${c.reset}${c.bold}Ctrl+C${c.reset}${c.dim} to exit  │  Updates every 5 seconds  │  11 Dimensions: Q+E+O+M+C+A+T+Η+Π+Μ+Δ${c.reset}\n`);
}

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log(`\n${c.yellow}👋 Goodbye!${c.reset}\n`);
  process.exit(0);
});

// Initial render
renderDashboard();

// Update every 5 seconds
setInterval(renderDashboard, 5000);
