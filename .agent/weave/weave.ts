#!/usr/bin/env bun
/**
 * Weave - Q+E+O+M Knowledge Framework
 * Version 2.1.0 - File-based extraction with automatic hooks
 *
 * Commands:
 *   bun weave.ts install [path]  - Install Weave system (default: ./)
 *   bun weave.ts extract         - Extract knowledge from files
 *   bun weave.ts monitor         - Real-time QOEM monitoring dashboard
 *
 * Hooks:
 *   PreCompact    - Suggests running /weave:extract before context compaction
 *   SessionEnd    - Automatically runs extraction at session end
 */

import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, statSync, chmodSync } from 'fs';
import { join, dirname, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const VERSION = '2.1.0';

// ============================================================================
// Installation
// ============================================================================

interface InstallOptions {
  targetPath: string;
  sourceWeaveDir: string;
}

async function install(targetPath: string = './'): Promise<void> {
  const absoluteTarget = resolve(targetPath);

  console.log('🌊 Weave Installation');
  console.log('='.repeat(50));
  console.log(`Target: ${absoluteTarget}`);

  // Verify target is a directory
  if (existsSync(absoluteTarget) && !statSync(absoluteTarget).isDirectory()) {
    console.error('❌ Error: Target path must be a directory');
    process.exit(1);
  }

  // Create target directory if needed
  if (!existsSync(absoluteTarget)) {
    console.log(`Creating target directory: ${absoluteTarget}`);
    mkdirSync(absoluteTarget, { recursive: true });
  }

  // Source is current weave directory
  const sourceWeaveDir = __dirname;
  const targetWeaveDir = join(absoluteTarget, '.agent/weave');
  const targetHooksDir = join(absoluteTarget, '.agent/hooks');

  console.log('\n📦 Installing Weave System...\n');

  // Create directories
  console.log('Creating directories...');
  mkdirSync(targetWeaveDir, { recursive: true });
  mkdirSync(targetHooksDir, { recursive: true });
  console.log('  ✓ .agent/weave/');
  console.log('  ✓ .agent/hooks/');
  console.log('  ✓ .claude/commands/weave/');

  // Core Weave files to copy
  const coreFiles = [
    'types.ts',
    'index.ts',
    'extraction.ts',
    'session-update.ts',
    'session-start.ts',
    'session-end.ts',
    'test.ts',
    'test-e2e.ts',
    'weave.ts',
    'monitor-simple.ts',
    'debug-format.ts',      // US-003: Debug output formatting
    'coherence-checker.ts', // US-003: Coherence checking
    'prompt-coach.ts',      // Prompt quality analysis
    'README.md',
    'SCHEMA.md'
  ];

  // Analytics files to copy
  const analyticsFiles = [
    'analytics/event-logger.ts',  // Hook event logging
    'analytics/export.ts',        // Analytics export tool
  ];

  // Documentation files (optional)
  const docFiles = [
    'INSTALLATION.md',
    'QUICK-START-TESTING.md',
    'README-TESTING.md',
    'TEST-QUESTIONS.md',
    'TESTING-SUMMARY.md',
    'WORK-TASKS.md'
  ];

  // Copy core files
  console.log('\nCopying core files...');
  for (const file of coreFiles) {
    const sourcePath = join(sourceWeaveDir, file);
    const targetPath = join(targetWeaveDir, file);

    if (existsSync(sourcePath)) {
      copyFileSync(sourcePath, targetPath);
      console.log(`  ✓ ${file}`);
    }
  }

  // Copy analytics files
  console.log('\nCopying analytics tools...');
  const analyticsDir = join(targetWeaveDir, 'analytics');
  mkdirSync(analyticsDir, { recursive: true });
  for (const file of analyticsFiles) {
    const sourcePath = join(sourceWeaveDir, file);
    const targetPath = join(targetWeaveDir, file);
    const targetDir = join(targetWeaveDir, file.split('/')[0]);

    if (existsSync(sourcePath)) {
      mkdirSync(targetDir, { recursive: true });
      copyFileSync(sourcePath, targetPath);
      console.log(`  ✓ ${file}`);
    }
  }

  // Copy documentation files (if they exist)
  console.log('\nCopying documentation...');
  for (const file of docFiles) {
    const sourcePath = join(sourceWeaveDir, file);
    const targetPath = join(targetWeaveDir, file);

    if (existsSync(sourcePath)) {
      copyFileSync(sourcePath, targetPath);
      console.log(`  ✓ ${file}`);
    }
  }

  // Initialize JSON files if they don't exist
  console.log('\nInitializing knowledge base...');
  initializeJsonFile(join(targetWeaveDir, 'ontology.json'), {
    $schema: './SCHEMA.md#ontology',
    title: 'Ontology',
    description: 'What exists - entities, relations, constraints',
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    entities: {},
    relations: {},
    constraints: {},
    metadata: {
      totalEntities: 0,
      totalRelations: 0,
      totalConstraints: 0,
      averageConfidence: 0,
      lastCompaction: null
    }
  });

  initializeJsonFile(join(targetWeaveDir, 'mereology.json'), {
    $schema: './SCHEMA.md#mereology',
    title: 'Mereology',
    description: 'How parts compose - components, compositions, hierarchy',
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    components: {},
    compositions: {},
    hierarchy: {
      root: null,
      layers: [],
      modules: []
    },
    partWholeRelations: {},
    metadata: {
      totalComponents: 0,
      totalCompositions: 0,
      totalParts: 0,
      maxDepth: 0,
      averageConfidence: 0,
      lastCompaction: null
    }
  });

  initializeJsonFile(join(targetWeaveDir, 'epistemology.json'), {
    $schema: './SCHEMA.md#epistemology',
    title: 'Epistemology',
    description: 'How we know - knowledge confidence and provenance',
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    knowledge: {},
    patterns: {},
    validations: {},
    confidenceModel: {
      scale: {
        'speculative': '0.0-0.3',
        'uncertain': '0.3-0.5',
        'probable': '0.5-0.7',
        'confident': '0.7-0.85',
        'highly_confident': '0.85-0.95',
        'certain': '0.95-1.0'
      },
      updateRules: {
        'observation': 'Bayesian update with prior=0.3, evidence=0.7',
        'validation': 'Increase confidence by validation factor',
        'contradiction': 'Decrease confidence, add uncertainty'
      },
      bayesianParameters: {
        priorWeight: 0.3,
        evidenceWeight: 0.7,
        minObservations: 1
      }
    },
    knowledgeGaps: [],
    metadata: {
      totalConcepts: 0,
      totalPatterns: 0,
      totalValidations: 0,
      averageConfidence: 0,
      highConfidenceConcepts: 0,
      lowConfidenceConcepts: 0,
      knowledgeGaps: 0,
      lastValidation: new Date().toISOString()
    }
  });

  initializeJsonFile(join(targetWeaveDir, 'qualia.json'), {
    $schema: './SCHEMA.md#qualia',
    title: 'Qualia',
    description: 'What it\'s like - experiential knowledge, pain points, solutions',
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    experiences: {},
    painPoints: {},
    solutions: {},
    workflows: {},
    bestPractices: {},
    contextualKnowledge: {},
    patterns: {
      development: [],
      debugging: [],
      collaboration: []
    },
    cognitiveLoad: {},
    metadata: {
      totalExperiences: 0,
      totalPainPoints: 0,
      totalSolutions: 0,
      totalWorkflows: 0,
      totalBestPractices: 0,
      totalPatterns: 0,
      lastUpdated: new Date().toISOString()
    }
  });

  // Initialize C+A+T dimensions
  initializeJsonFile(join(targetWeaveDir, 'causation.json'), {
    $schema: './SCHEMA.md#causation',
    title: 'Causation (Etiology)',
    description: 'What caused what - causal chains, root causes, mechanisms',
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    causalChains: {},
    rootCauses: {},
    mechanisms: {},
    metadata: {
      totalCausalChains: 0,
      totalRootCauses: 0,
      totalMechanisms: 0,
      averageConfidence: 0,
      lastCompaction: null
    }
  });

  initializeJsonFile(join(targetWeaveDir, 'axiology.json'), {
    $schema: './SCHEMA.md#axiology',
    title: 'Axiology (Value)',
    description: 'What is valuable - quality judgments, trade-offs, worth',
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    valueJudgments: {},
    tradeoffs: {},
    qualityMetrics: {},
    metadata: {
      totalValueJudgments: 0,
      totalTradeoffs: 0,
      totalQualityMetrics: 0,
      averageConfidence: 0,
      lastCompaction: null
    }
  });

  initializeJsonFile(join(targetWeaveDir, 'teleology.json'), {
    $schema: './SCHEMA.md#teleology',
    title: 'Teleology (Purpose)',
    description: 'What is this for - intent, goals, purposes, functions',
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    purposes: {},
    goals: {},
    intents: {},
    metadata: {
      totalPurposes: 0,
      totalGoals: 0,
      totalIntents: 0,
      averageConfidence: 0,
      lastCompaction: null
    }
  });

  // Initialize Η+Π+Μ+Δ dimensions (11D expansion)
  initializeJsonFile(join(targetWeaveDir, 'history.json'), {
    $schema: './SCHEMA.md#history',
    title: 'History (Η)',
    description: 'How we got here - evolutions, timelines, legacy patterns',
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    evolutions: {},
    timelines: {},
    legacyPatterns: {},
    metadata: {
      totalEvolutions: 0,
      totalTimelines: 0,
      totalLegacyPatterns: 0,
      averageConfidence: 0,
      lastCompaction: null
    }
  });

  initializeJsonFile(join(targetWeaveDir, 'praxeology.json'), {
    $schema: './SCHEMA.md#praxeology',
    title: 'Praxeology (Π)',
    description: 'How we work - WoW patterns, delegation strategies, best practices',
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    wowPatterns: {},
    delegationStrategies: {},
    bestPractices: {},
    metadata: {
      totalWowPatterns: 0,
      totalDelegationStrategies: 0,
      totalBestPractices: 0,
      averageConfidence: 0,
      lastCompaction: null
    }
  });

  initializeJsonFile(join(targetWeaveDir, 'modality.json'), {
    $schema: './SCHEMA.md#modality',
    title: 'Modality (Μ)',
    description: 'What could be - alternatives, rejected options, possible futures',
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    alternatives: {},
    rejectedOptions: {},
    possibleFutures: {},
    metadata: {
      totalAlternatives: 0,
      totalRejectedOptions: 0,
      totalPossibleFutures: 0,
      averageConfidence: 0,
      lastCompaction: null
    }
  });

  initializeJsonFile(join(targetWeaveDir, 'deontics.json'), {
    $schema: './SCHEMA.md#deontics',
    title: 'Deontics (Δ)',
    description: 'What must/can/cannot be done - obligations, permissions, prohibitions',
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    obligations: {},
    permissions: {},
    prohibitions: {},
    metadata: {
      totalObligations: 0,
      totalPermissions: 0,
      totalProhibitions: 0,
      averageConfidence: 0,
      lastCompaction: null
    }
  });

  initializeJsonFile(join(targetWeaveDir, 'meta.json'), {
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    stats: {
      totalEntities: 0,
      totalRelations: 0,
      totalComponents: 0,
      totalPatterns: 0,
      totalPainPoints: 0,
      totalCausalChains: 0,
      totalValueJudgments: 0,
      totalPurposes: 0,
      averageConfidence: 0,
      totalSessions: 0
    },
    health: {
      ontologyCoverage: 0,
      epistemicConfidence: 0,
      qualiaDepth: 0,
      causationDepth: 0,
      axiologyDepth: 0,
      teleologyDepth: 0,
      lastCompaction: null
    }
  });

  // Initialize Shadow Advisor storage
  console.log('\nInitializing Shadow Advisor...');
  initializeJsonFile(join(targetWeaveDir, 'shadow.json'), {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "sessions": {},
    "notes": "Shadow advisor agents keyed by session_id. Each session creates a persistent Haiku subagent with Weave dimensions cached."
  });

  // Initialize Librarian storage and directory structure
  console.log('\nInitializing Librarian...');
  const targetLibrarianDir = join(absoluteTarget, '.agent', 'librarian');
  const targetLibrarianShardsDir = join(targetLibrarianDir, 'shards');
  mkdirSync(targetLibrarianShardsDir, { recursive: true });

  initializeJsonFile(join(targetLibrarianDir, 'librarian.json'), {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "sessions": {},
    "notes": "Librarian agents keyed by session_id. Each session creates a persistent Haiku subagent with Library index cached."
  });

  // Copy Librarian catalog and shards if they exist
  const sourceLibrarianDir = join(dirname(sourceWeaveDir), 'librarian');
  const sourceLibrarianShardsDir = join(sourceLibrarianDir, 'shards');

  if (existsSync(sourceLibrarianShardsDir)) {
    const shardFiles = readdirSync(sourceLibrarianShardsDir);
    for (const shardFile of shardFiles) {
      copyFileSync(
        join(sourceLibrarianShardsDir, shardFile),
        join(targetLibrarianShardsDir, shardFile)
      );
    }
    console.log(`  ✓ librarian/shards/ (${shardFiles.length} files)`);
  }

  // Copy Librarian README if it exists
  const librarianReadme = join(sourceLibrarianDir, 'README.md');
  if (existsSync(librarianReadme)) {
    copyFileSync(librarianReadme, join(targetLibrarianDir, 'README.md'));
    console.log(`  ✓ librarian/README.md`);
  }

  // Copy hooks
  console.log('\nCopying hooks...');
  const sourceHooksDir = join(dirname(sourceWeaveDir), 'hooks');
  const hookFiles = ['Stop.ts', 'weave-hooks.ts', 'conversation-logger.ts', 'weave-analytics.ts'];

  for (const hookFile of hookFiles) {
    const sourcePath = join(sourceHooksDir, hookFile);
    const targetPath = join(targetHooksDir, hookFile);

    if (existsSync(sourcePath)) {
      copyFileSync(sourcePath, targetPath);
      // Make executable
      chmodSync(targetPath, 0o755);
      console.log(`  ✓ ${hookFile}`);
    }
  }

  // Copy conversation viewer script
  const sourceScriptDir = join(dirname(sourceWeaveDir), 'scripts');
  const targetClaudeScriptsDir = join(absoluteTarget, '.claude', 'scripts');
  mkdirSync(targetClaudeScriptsDir, { recursive: true });

  const viewerScript = 'conversation-viewer.ts';
  const viewerSource = join(sourceScriptDir, viewerScript);
  const viewerTarget = join(targetClaudeScriptsDir, viewerScript);

  if (existsSync(viewerSource)) {
    copyFileSync(viewerSource, viewerTarget);
    chmodSync(viewerTarget, 0o755);
    console.log(`  ✓ .claude/scripts/${viewerScript}`);
  }

  // Create logs directory and initialize log file
  const logsDir = join(absoluteTarget, '.claude', 'logs');
  mkdirSync(logsDir, { recursive: true });
  const logFile = join(logsDir, 'conversation.jsonl');
  if (!existsSync(logFile)) {
    writeFileSync(logFile, '');
  }
  console.log(`  ✓ .claude/logs/conversation.jsonl (initialized)`)

  // Install claude-hooks-sdk dependency
  console.log('\nInstalling claude-hooks-sdk...');
  const targetPackageJson = join(absoluteTarget, 'package.json');

  // Create package.json if it doesn't exist
  if (!existsSync(targetPackageJson)) {
    console.log('  Creating package.json...');
    writeFileSync(targetPackageJson, JSON.stringify({
      name: 'weave-project',
      version: '1.0.0',
      type: 'module',
      dependencies: {}
    }, null, 2));
  }

  const pkgJson = JSON.parse(readFileSync(targetPackageJson, 'utf-8'));
  const hasSdk = pkgJson.dependencies?.['claude-hooks-sdk'] || pkgJson.devDependencies?.['claude-hooks-sdk'];

  if (!hasSdk) {
    console.log('  Installing claude-hooks-sdk...');
    const result = Bun.spawnSync(['bun', 'add', 'claude-hooks-sdk'], {
      cwd: absoluteTarget,
      stdio: ['inherit', 'pipe', 'pipe']
    });

    if (result.exitCode === 0) {
      console.log('  ✓ claude-hooks-sdk installed');
    } else {
      console.log('  ⚠️  Failed to install claude-hooks-sdk');
      console.log('  Run manually: cd ' + absoluteTarget + ' && bun add claude-hooks-sdk');
      if (result.stderr) {
        console.log('  Error:', new TextDecoder().decode(result.stderr));
      }
    }
  } else {
    console.log('  ✓ claude-hooks-sdk already installed');
  }

  // Copy slash commands
  console.log('\nCopying slash commands...');
  // FIX: Commands are in commands/ not .claude/commands/
  const sourceCommandsDir = join(dirname(sourceWeaveDir), 'commands', 'weave');
  const targetCommandsDir = join(absoluteTarget, '.claude', 'commands', 'weave');
  const commandFiles = ['extract.md', 'reflect.md', 'remember.md', 'shadow.md', 'observe.md'];

  // Create target commands directory if it doesn't exist
  mkdirSync(targetCommandsDir, { recursive: true });

  for (const commandFile of commandFiles) {
    const sourcePath = join(sourceCommandsDir, commandFile);
    const targetPath = join(targetCommandsDir, commandFile);

    if (existsSync(sourcePath)) {
      copyFileSync(sourcePath, targetPath);
      console.log(`  ✓ weave/${commandFile}`);
    }
  }

  // Copy Librarian slash commands
  const sourceLibrarianCommandsDir = join(dirname(sourceWeaveDir), 'commands', 'librarian');
  const targetLibrarianCommandsDir = join(absoluteTarget, '.claude', 'commands', 'librarian');
  const librarianCommandFiles = ['ask.md', 'find.md', 'index.md'];

  if (existsSync(sourceLibrarianCommandsDir)) {
    mkdirSync(targetLibrarianCommandsDir, { recursive: true });

    for (const commandFile of librarianCommandFiles) {
      const sourcePath = join(sourceLibrarianCommandsDir, commandFile);
      const targetPath = join(targetLibrarianCommandsDir, commandFile);

      if (existsSync(sourcePath)) {
        copyFileSync(sourcePath, targetPath);
        console.log(`  ✓ librarian/${commandFile}`);
      }
    }
  }

  // Copy agent definitions
  console.log('\nCopying agent definitions...');
  // FIX: Agents are in agents/ not .claude/agents/
  const sourceAgentsDir = join(dirname(sourceWeaveDir), 'agents');
  const targetAgentsDir = join(absoluteTarget, '.claude', 'agents');
  const agentFiles = ['shadow-advisor.md', 'librarian.md'];

  mkdirSync(targetAgentsDir, { recursive: true });

  for (const agentFile of agentFiles) {
    const sourcePath = join(sourceAgentsDir, agentFile);
    const targetPath = join(targetAgentsDir, agentFile);

    if (existsSync(sourcePath)) {
      copyFileSync(sourcePath, targetPath);
      console.log(`  ✓ ${agentFile}`);
    }
  }

  // Copy skills
  console.log('\nCopying skills...');
  // FIX: Skills are in skills/ not .claude/skills/
  const sourceSkillsDir = join(dirname(sourceWeaveDir), 'skills');
  const targetSkillsDir = join(absoluteTarget, '.claude', 'skills');
  const skillFiles = ['shadow-advisor.md', 'librarian.md'];

  mkdirSync(targetSkillsDir, { recursive: true });

  for (const skillFile of skillFiles) {
    const sourcePath = join(sourceSkillsDir, skillFile);
    const targetPath = join(targetSkillsDir, skillFile);

    if (existsSync(sourcePath)) {
      copyFileSync(sourcePath, targetPath);
      console.log(`  ✓ ${skillFile}`);
    }
  }

  // Copy Phase 2 components (progressive disclosure)
  console.log('\nCopying progressive disclosure components...');

  // Copy query scripts
  const targetScriptsDir = join(targetWeaveDir, 'scripts');
  const sourceScriptsDir = join(sourceWeaveDir, 'scripts');
  if (existsSync(sourceScriptsDir)) {
    mkdirSync(targetScriptsDir, { recursive: true });
    const scriptFiles = readdirSync(sourceScriptsDir);
    for (const scriptFile of scriptFiles) {
      const sourcePath = join(sourceScriptsDir, scriptFile);
      const targetPath = join(targetScriptsDir, scriptFile);
      if (statSync(sourcePath).isFile()) {
        copyFileSync(sourcePath, targetPath);
        if (scriptFile.endsWith('.ts')) {
          chmodSync(targetPath, 0o755);
        }
        console.log(`  ✓ scripts/${scriptFile}`);
      }
    }
  }

  // Copy dimension shards
  const targetDimensionsDir = join(targetWeaveDir, 'dimensions');
  const sourceDimensionsDir = join(sourceWeaveDir, 'dimensions');
  if (existsSync(sourceDimensionsDir)) {
    mkdirSync(targetDimensionsDir, { recursive: true });
    const dimFiles = readdirSync(sourceDimensionsDir);
    for (const dimFile of dimFiles) {
      copyFileSync(join(sourceDimensionsDir, dimFile), join(targetDimensionsDir, dimFile));
    }
    console.log(`  ✓ dimensions/ (${dimFiles.length} shards)`);
  }

  // Copy domain shards
  const targetDomainsDir = join(targetWeaveDir, 'domains');
  const sourceDomainsDir = join(sourceWeaveDir, 'domains');
  if (existsSync(sourceDomainsDir)) {
    mkdirSync(targetDomainsDir, { recursive: true });
    const domainFiles = readdirSync(sourceDomainsDir).filter(f => f.endsWith('.md'));
    for (const domainFile of domainFiles) {
      copyFileSync(join(sourceDomainsDir, domainFile), join(targetDomainsDir, domainFile));
    }
    console.log(`  ✓ domains/ (${domainFiles.length} shards)`);
  }

  // Copy analytics engine
  console.log('\nCopying analytics engine...');
  const sourceAnalyticsDir = join(sourceWeaveDir, 'analytics');
  const targetAnalyticsDir = join(targetWeaveDir, 'analytics');
  if (existsSync(sourceAnalyticsDir)) {
    mkdirSync(targetAnalyticsDir, { recursive: true });
    const analyticsFiles = readdirSync(sourceAnalyticsDir).filter(f => f.endsWith('.ts'));
    for (const analyticsFile of analyticsFiles) {
      copyFileSync(join(sourceAnalyticsDir, analyticsFile), join(targetAnalyticsDir, analyticsFile));
      console.log(`  ✓ analytics/${analyticsFile}`);
    }
  }

  // Copy manifest and install guide
  const manifestFiles = ['manifest.json', 'INSTALL.md', 'summary.md'];
  for (const file of manifestFiles) {
    const sourcePath = join(sourceWeaveDir, file);
    const targetPath = join(targetWeaveDir, file);
    if (existsSync(sourcePath)) {
      copyFileSync(sourcePath, targetPath);
      console.log(`  ✓ ${file}`);
    }
  }

  // Add Weave summary to CLAUDE.md (automatic loading)
  console.log('\nConfiguring automatic knowledge loading...');
  await addWeaveToClaudeMd(absoluteTarget, targetWeaveDir);

  // Wire hooks into .claude/settings.json
  console.log('\nWiring hooks into .claude/settings.json...');
  // Wire Stop hook (for Weave), conversation logger, and analytics hooks
  await wireHooksIntoSettings(absoluteTarget, [
    { name: 'Stop', hookFile: 'Stop.ts' },
    { name: 'SessionStart', hookFile: 'conversation-logger.ts' },
    { name: 'UserPromptSubmit', hookFile: 'conversation-logger.ts' },
    { name: 'Stop', hookFile: 'conversation-logger.ts' },
    { name: 'SessionEnd', hookFile: 'conversation-logger.ts' },
    // Analytics hooks for field testing
    { name: 'SessionStart', hookFile: 'weave-analytics.ts' },
    { name: 'UserPromptSubmit', hookFile: 'weave-analytics.ts' },
    { name: 'PreToolUse', hookFile: 'weave-analytics.ts' },
    { name: 'PostToolUse', hookFile: 'weave-analytics.ts' },
    { name: 'Stop', hookFile: 'weave-analytics.ts' },
    { name: 'SessionEnd', hookFile: 'weave-analytics.ts' },
  ]);

  // Success!
  console.log('\n' + '='.repeat(50));
  console.log('✅ Weave installed successfully!');
  console.log('\n📦 Components installed:');
  console.log('  • 11D Knowledge Framework (Q+E+O+M+C+A+T+Η+Π+Μ+Δ)');
  console.log('  • Bayesian Fact Tracking (observe, reinforce, validate, contradict)');
  console.log('  • Shadow Advisor (institutional knowledge query agent)');
  console.log('  • Librarian (structural knowledge / file discovery agent)');
  console.log('  • Analytics Engine (knowledge health, tech debt heatmap)');
  console.log('  • Progressive disclosure (sharded access patterns)');
  console.log('  • Auto-capture hooks (SessionStart, Stop)');
  console.log('  • Conversation Logger (all events → .claude/logs/conversation.jsonl)');
  console.log('  • Weave Analytics (session metrics, prompt quality, tool usage)');
  console.log('  • claude-hooks-sdk (hook management dependency)');
  console.log('\nNext steps:');
  console.log('  1. Start a Claude Code session in this directory');
  console.log('  2. Work on tasks (the hook will capture knowledge automatically)');
  console.log('  3. Record facts: /weave:observe <fact>');
  console.log(`  4. Run analytics: bun ${join(relative(absoluteTarget, targetWeaveDir), 'analytics/cli.ts')}`);
  console.log('\nQuery Knowledge:');
  console.log('  • /weave:shadow create - Create Shadow Advisor for this session');
  console.log('  • /weave:shadow <question> - Query institutional knowledge');
  console.log('  • /weave:observe <fact> - Record a fact with Bayesian tracking');
  console.log('  • /librarian:index - Build semantic file index (optional, one-time)');
  console.log('  • /librarian:ask create - Create Librarian for this session');
  console.log('  • /librarian:ask <question> - Find files by concept/domain/pattern');
  console.log('\nMonitoring:');
  console.log(`  • Analytics: bun ${join(relative(absoluteTarget, targetWeaveDir), 'analytics/cli.ts')}`);
  console.log(`  • Real-time: bun ${join(relative(absoluteTarget, targetWeaveDir), 'weave.ts')} monitor`);
  console.log(`  • Quick check: bun ${join(relative(absoluteTarget, targetWeaveDir), 'test.ts')}`);
  console.log('\nConversation Logs:');
  console.log('  • View: tail -f .claude/logs/conversation.jsonl | bun .claude/scripts/conversation-viewer.ts');
  console.log('  • Log location: .claude/logs/conversation.jsonl');
  console.log('\nSession Analytics (field testing):');
  console.log(`  • Summary: bun ${join(relative(absoluteTarget, targetWeaveDir), 'analytics/export.ts')} summary`);
  console.log(`  • Prompts: bun ${join(relative(absoluteTarget, targetWeaveDir), 'analytics/export.ts')} prompts`);
  console.log(`  • Tools:   bun ${join(relative(absoluteTarget, targetWeaveDir), 'analytics/export.ts')} tools`);
  console.log(`  • Files:   bun ${join(relative(absoluteTarget, targetWeaveDir), 'analytics/export.ts')} files`);
  console.log(`  • Weave:   bun ${join(relative(absoluteTarget, targetWeaveDir), 'analytics/export.ts')} weave`);
  console.log('  • Data location: .agent/weave/analytics/');
  console.log('\nDocumentation:');
  console.log(`  • ${join(relative(absoluteTarget, targetWeaveDir), 'README.md')}`);
  console.log(`  • ${join(relative(absoluteTarget, targetWeaveDir), 'QUICK-START-TESTING.md')}`);
  console.log(`  • Skill: shadow-advisor (comprehensive Shadow usage guide)`);
  console.log(`  • Skill: librarian (comprehensive Librarian usage guide)`);
}

function initializeJsonFile(path: string, defaultContent: any): void {
  if (!existsSync(path)) {
    writeFileSync(path, JSON.stringify(defaultContent, null, 2));
    console.log(`  ✓ ${relative(dirname(dirname(path)), path)} (initialized)`);
  } else {
    console.log(`  ⊙ ${relative(dirname(dirname(path)), path)} (exists)`);
  }
}

// ============================================================================
// Loom SDLC Installation
// ============================================================================

async function installLoom(targetPath: string, sourcePackageDir: string): Promise<void> {
  const sourceLoomDir = join(sourcePackageDir, 'loom');
  const targetLoomDir = join(targetPath, '.agent', 'loom');
  const targetLoomDataDir = join(targetPath, '.claude', 'loom');

  // Check if Loom source exists
  if (!existsSync(sourceLoomDir)) {
    console.log('  ⊙ Loom source not found (skipped)');
    return;
  }

  // Create directories
  mkdirSync(targetLoomDir, { recursive: true });
  mkdirSync(join(targetLoomDir, 'scripts'), { recursive: true });
  mkdirSync(join(targetLoomDir, 'templates', 'agents'), { recursive: true });
  mkdirSync(targetLoomDataDir, { recursive: true });
  mkdirSync(join(targetLoomDataDir, 'features'), { recursive: true });
  mkdirSync(join(targetLoomDataDir, 'archive'), { recursive: true });
  mkdirSync(join(targetLoomDataDir, 'ideas'), { recursive: true });
  console.log('  ✓ .agent/loom/ directories');
  console.log('  ✓ .claude/loom/ directories');

  // Copy README
  const readmePath = join(sourceLoomDir, 'README.md');
  if (existsSync(readmePath)) {
    copyFileSync(readmePath, join(targetLoomDir, 'README.md'));
    console.log('  ✓ loom/README.md');
  }

  // Copy scripts
  const sourceScriptsDir = join(sourceLoomDir, 'scripts');
  if (existsSync(sourceScriptsDir)) {
    const scriptFiles = readdirSync(sourceScriptsDir).filter(f => f.endsWith('.ts'));
    for (const scriptFile of scriptFiles) {
      copyFileSync(
        join(sourceScriptsDir, scriptFile),
        join(targetLoomDir, 'scripts', scriptFile)
      );
    }
    console.log(`  ✓ loom/scripts/ (${scriptFiles.length} files)`);
  }

  // Copy agent templates
  const sourceTemplatesDir = join(sourceLoomDir, 'templates', 'agents');
  if (existsSync(sourceTemplatesDir)) {
    const templateFiles = readdirSync(sourceTemplatesDir).filter(f => f.endsWith('.md'));
    for (const templateFile of templateFiles) {
      copyFileSync(
        join(sourceTemplatesDir, templateFile),
        join(targetLoomDir, 'templates', 'agents', templateFile)
      );
    }
    console.log(`  ✓ loom/templates/agents/ (${templateFiles.length} files)`);
  }

  // Initialize config.json if it doesn't exist
  const targetConfigPath = join(targetLoomDir, 'config.json');
  if (!existsSync(targetConfigPath)) {
    const defaultConfig = {
      version: '1.0.0',
      initialized: new Date().toISOString(),
      project: {
        name: 'unknown',
        path: targetPath
      },
      stack: {
        runtime: 'bun',
        packageManager: 'bun',
        backend: [],
        frontend: [],
        database: [],
        testing: [],
        other: []
      },
      patterns: {},
      wayOfWorking: {
        testingApproach: 'test-after',
        prReviewProcess: 'optional',
        workflowStyle: 'autonomous',
        documentationLevel: 'standard'
      },
      definitionOfDone: [
        'All tasks completed',
        'All acceptance criteria tested and passing',
        'Code committed to repository',
        'Documentation updated',
        'Tests written and passing',
        'Retrospective generated',
        'Learnings extracted to Weave'
      ],
      roles: [
        'main-agent',
        'backend-dev',
        'backend-qa',
        'frontend-dev',
        'frontend-qa',
        'system-architect'
      ],
      storyCounter: 0,
      taskCounter: 0
    };
    writeFileSync(targetConfigPath, JSON.stringify(defaultConfig, null, 2));
    console.log('  ✓ loom/config.json (initialized)');
  } else {
    console.log('  ⊙ loom/config.json (exists)');
  }

  // Copy Loom slash commands
  const sourceCommandsDir = join(sourcePackageDir, 'commands', 'loom');
  const targetCommandsDir = join(targetPath, '.claude', 'commands', 'loom');

  if (existsSync(sourceCommandsDir)) {
    mkdirSync(targetCommandsDir, { recursive: true });
    const commandFiles = readdirSync(sourceCommandsDir).filter(f => f.endsWith('.md'));
    for (const commandFile of commandFiles) {
      copyFileSync(
        join(sourceCommandsDir, commandFile),
        join(targetCommandsDir, commandFile)
      );
    }
    console.log(`  ✓ .claude/commands/loom/ (${commandFiles.length} commands)`);
  }

  // Copy Loom agent definitions
  const sourceAgentsDir = join(sourcePackageDir, 'agents');
  const targetAgentsDir = join(targetPath, '.claude', 'agents');

  if (existsSync(sourceAgentsDir)) {
    mkdirSync(targetAgentsDir, { recursive: true });
    const agentFiles = readdirSync(sourceAgentsDir).filter(f => f.startsWith('loom-') && f.endsWith('.md'));
    for (const agentFile of agentFiles) {
      copyFileSync(
        join(sourceAgentsDir, agentFile),
        join(targetAgentsDir, agentFile)
      );
    }
    console.log(`  ✓ .claude/agents/loom-*.md (${agentFiles.length} agents)`);
  }

  console.log('  ✓ Loom SDLC orchestration installed');
}

// ============================================================================
// CLAUDE.md Integration
// ============================================================================

async function addWeaveToClaudeMd(targetPath: string, weaveDir: string): Promise<void> {
  const claudeMdPath = join(targetPath, '.claude', 'CLAUDE.md');
  const summaryPath = join(weaveDir, 'summary.md');

  // Generate summary.md if it doesn't exist
  if (!existsSync(summaryPath)) {
    console.log('  • Generating summary.md from dimensions...');
    await generateSummaryMd(weaveDir);
  }

  // Read summary content
  const summaryContent = readFileSync(summaryPath, 'utf-8');

  // Create .claude directory if needed
  const claudeDir = dirname(claudeMdPath);
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true});
  }

  // Check if CLAUDE.md exists
  if (!existsSync(claudeMdPath)) {
    // Create new CLAUDE.md with Weave summary
    const content = `# Project - Claude Code Configuration

This file provides context and instructions for Claude Code when working in this repository.

---

## 📚 Institutional Knowledge (Weave Framework)

${summaryContent}

---

## Project Overview

Add your project-specific context here.
`;
    writeFileSync(claudeMdPath, content);
    console.log('  ✓ Created CLAUDE.md with Weave summary');
    return;
  }

  // CLAUDE.md exists - check if Weave summary already present
  const existingContent = readFileSync(claudeMdPath, 'utf-8');

  // Check for marker text to see if already added
  if (existingContent.includes('Institutional Knowledge (Weave Framework)')) {
    console.log('  ⊙ CLAUDE.md already contains Weave summary (skipped)');
    return;
  }

  // Add Weave summary to existing CLAUDE.md
  // Insert after first heading or at beginning
  const lines = existingContent.split('\n');
  let insertIndex = 0;

  // Find first heading
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('#')) {
      // Insert after first paragraph following heading
      insertIndex = i + 1;
      // Skip to next blank line
      while (insertIndex < lines.length && lines[insertIndex].trim() !== '') {
        insertIndex++;
      }
      break;
    }
  }

  const weaveSection = `
---

## 📚 Institutional Knowledge (Weave Framework)

${summaryContent}

---
`;

  // Insert Weave section
  lines.splice(insertIndex, 0, weaveSection);
  writeFileSync(claudeMdPath, lines.join('\n'));
  console.log('  ✓ Added Weave summary to existing CLAUDE.md');
}

async function generateSummaryMd(weaveDir: string): Promise<void> {
  // Read all dimension files
  const dimensions = [
    'qualia', 'epistemology', 'ontology', 'mereology',
    'causation', 'axiology', 'teleology',
    'history', 'praxeology', 'modality', 'deontics'
  ];

  const stats: any = {};

  for (const dim of dimensions) {
    const filePath = join(weaveDir, `${dim}.json`);
    if (existsSync(filePath)) {
      const data = JSON.parse(readFileSync(filePath, 'utf-8'));
      stats[dim] = data.metadata || {};
    }
  }

  const getSymbol = (dim: string): string => {
    const map: Record<string, string> = {
      'qualia': 'Q', 'epistemology': 'E', 'ontology': 'O', 'mereology': 'M',
      'causation': 'C', 'axiology': 'A', 'teleology': 'T',
      'history': 'Η', 'praxeology': 'Π', 'modality': 'Μ', 'deontics': 'Δ'
    };
    return map[dim] || '?';
  };

  const formatStats = (meta: any): string => {
    const keys = Object.keys(meta).filter(k => k.startsWith('total') && !k.includes('Updated'));
    return keys.map(k => `${meta[k]} ${k.replace('total', '').replace(/([A-Z])/g, ' $1').toLowerCase().trim()}`).join(', ');
  };

  const summary = `**Framework:** 11 dimensions (Q+E+O+M+C+A+T+Η+Π+Μ+Δ)
**Version:** 2.0.0
**Last Updated:** ${new Date().toISOString().split('T')[0]}

### Quick Stats

${dimensions.map(dim => {
    const meta = stats[dim];
    const symbol = getSymbol(dim);
    const dimName = dim.charAt(0).toUpperCase() + dim.slice(1);
    return `- **${symbol} (${dimName}):** ${formatStats(meta)}`;
  }).join('\n')}

**Query for Details:**
- \`bun .agent/weave/scripts/query.ts <dimension>:<entity-id>\` - Get specific entity
- \`bun .agent/weave/scripts/search.ts "<term>"\` - Search across dimensions
- \`bun .agent/weave/scripts/related.ts <id>\` - Find related knowledge

*This summary represents ~2.8% of full knowledge base. Query full dimensions when needed.*`;

  writeFileSync(join(weaveDir, 'summary.md'), summary);
}

// ============================================================================
// Hook Configuration
// ============================================================================

interface HookConfig {
  name: string;
  hookFile: string;
}

async function wireHooksIntoSettings(targetPath: string, hookConfigs: HookConfig[]): Promise<void> {
  const claudeDir = join(targetPath, '.claude');
  const settingsPath = join(claudeDir, 'settings.json');

  // Create .claude directory if it doesn't exist
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true });
  }

  // Read existing settings or create default
  let settings: any = { hooks: {} };
  if (existsSync(settingsPath)) {
    const content = readFileSync(settingsPath, 'utf-8');
    settings = JSON.parse(content);
    if (!settings.hooks) {
      settings.hooks = {};
    }
  }

  // Add hook configurations
  for (const hookConfig of hookConfigs) {
    const { name: hookName, hookFile: hookFileName } = hookConfig;
    const hookPath = `"$CLAUDE_PROJECT_DIR"/.agent/hooks/${hookFileName}`;

    // Initialize hook array if it doesn't exist
    if (!settings.hooks[hookName]) {
      settings.hooks[hookName] = [];
    }

    // Check if this specific hook file is already wired for this event
    const existingHook = settings.hooks[hookName].find((h: any) =>
      h.matcher === '*' && h.hooks?.some((hh: any) =>
        hh.type === 'command' && hh.command.includes(hookFileName)
      )
    );

    if (!existingHook) {
      // Add new hook configuration
      settings.hooks[hookName].push({
        matcher: '*',
        hooks: [
          {
            type: 'command',
            command: `bun ${hookPath}`
          }
        ]
      });
      console.log(`  ✓ Wired ${hookName} → ${hookFileName}`);
    } else {
      console.log(`  ⊙ ${hookName} → ${hookFileName} (already wired)`);
    }
  }

  // Write updated settings
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

// ============================================================================
// Monitoring Dashboard
// ============================================================================

async function monitor(): Promise<void> {
  const weavePath = join(process.cwd(), '.agent/weave');

  if (!existsSync(weavePath)) {
    console.error('❌ Weave not found in current directory');
    console.error('   Expected: .agent/weave/');
    console.error('\nRun: bun weave.ts install');
    process.exit(1);
  }

  // Clear screen
  console.clear();

  while (true) {
    // Read current state
    const ontology = readJson(join(weavePath, 'ontology.json'));
    const mereology = readJson(join(weavePath, 'mereology.json'));
    const epistemology = readJson(join(weavePath, 'epistemology.json'));
    const qualia = readJson(join(weavePath, 'qualia.json'));
    const meta = readJson(join(weavePath, 'meta.json'));

    // Move cursor to top
    process.stdout.write('\x1b[H');

    // Render dashboard
    renderDashboard({
      ontology,
      mereology,
      epistemology,
      qualia,
      meta
    });

    // Wait 2 seconds
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

function readJson(path: string): any {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return {};
  }
}

function renderDashboard(data: any): void {
  const { ontology, mereology, epistemology, qualia, meta } = data;

  const width = process.stdout.columns || 80;
  const hr = '═'.repeat(width);

  console.log(hr);
  console.log('🌊 WEAVE KNOWLEDGE MONITOR'.padEnd(width - 1));
  console.log(hr);
  console.log();

  // Status overview
  const health = meta?.health?.status || 'unknown';
  const healthIcon = getHealthIcon(health);
  console.log(`Status: ${healthIcon} ${health.toUpperCase()}`);
  console.log(`Last Updated: ${meta?.lastUpdated ? new Date(meta.lastUpdated).toLocaleString() : 'Never'}`);
  console.log();

  // QOEM Dimensions
  console.log('┌─ DIMENSIONS ─────────────────────────────────────────────────────┐');

  // Ontology (O)
  const oEntities = Object.keys(ontology?.entities || {}).length;
  const oRelations = Object.keys(ontology?.relations || {}).length;
  const oConstraints = Object.keys(ontology?.constraints || {}).length;
  const oConfidence = (ontology?.metadata?.averageConfidence || 0) * 100;

  console.log('│ [O] ONTOLOGY - What Exists                                       │');
  console.log(`│     Entities:    ${String(oEntities).padStart(4)} ${renderBar(oEntities, 100, 40)}│`);
  console.log(`│     Relations:   ${String(oRelations).padStart(4)} ${renderBar(oRelations, 50, 40)}│`);
  console.log(`│     Constraints: ${String(oConstraints).padStart(4)} ${renderBar(oConstraints, 20, 40)}│`);
  console.log(`│     Confidence:  ${oConfidence.toFixed(0).padStart(3)}% ${renderBar(oConfidence, 100, 40)}│`);
  console.log('│                                                                  │');

  // Mereology (M)
  const mComponents = Object.keys(mereology?.components || {}).length;
  const mCompositions = Object.keys(mereology?.compositions || {}).length;
  const mDepth = mereology?.metadata?.maxDepth || 0;
  const mConfidence = (mereology?.metadata?.averageConfidence || 0) * 100;

  console.log('│ [M] MEREOLOGY - How Parts Compose                               │');
  console.log(`│     Components:   ${String(mComponents).padStart(4)} ${renderBar(mComponents, 50, 40)}│`);
  console.log(`│     Compositions: ${String(mCompositions).padStart(4)} ${renderBar(mCompositions, 30, 40)}│`);
  console.log(`│     Max Depth:    ${String(mDepth).padStart(4)} ${renderBar(mDepth, 10, 40)}│`);
  console.log(`│     Confidence:   ${mConfidence.toFixed(0).padStart(3)}% ${renderBar(mConfidence, 100, 40)}│`);
  console.log('│                                                                  │');

  // Epistemology (E)
  const eKnowledge = Object.keys(epistemology?.knowledge || {}).length;
  const ePatterns = Object.keys(epistemology?.patterns || {}).length;
  const eValidations = Object.keys(epistemology?.validations || {}).length;
  const eConfidence = (epistemology?.metadata?.averageConfidence || 0) * 100;
  const eHighConf = epistemology?.metadata?.highConfidenceConcepts || 0;
  const eLowConf = epistemology?.metadata?.lowConfidenceConcepts || 0;

  console.log('│ [E] EPISTEMOLOGY - How We Know                                   │');
  console.log(`│     Knowledge:    ${String(eKnowledge).padStart(4)} ${renderBar(eKnowledge, 50, 40)}│`);
  console.log(`│     Patterns:     ${String(ePatterns).padStart(4)} ${renderBar(ePatterns, 30, 40)}│`);
  console.log(`│     Validations:  ${String(eValidations).padStart(4)} ${renderBar(eValidations, 20, 40)}│`);
  console.log(`│     Confidence:   ${eConfidence.toFixed(0).padStart(3)}% ${renderBar(eConfidence, 100, 40)}│`);
  console.log(`│     High/Low:     ${String(eHighConf).padStart(2)}/${String(eLowConf).padStart(2)}                                      │`);
  console.log('│                                                                  │');

  // Qualia (Q)
  const qExperiences = Object.keys(qualia?.experiences || {}).length;
  const qPainPoints = Object.keys(qualia?.painPoints || {}).length;
  const qSolutions = Object.keys(qualia?.solutions || {}).length;
  const qWorkflows = Object.keys(qualia?.workflows || {}).length;
  const qBestPractices = Object.keys(qualia?.bestPractices || {}).length;

  console.log('│ [Q] QUALIA - What It\'s Like (Experience)                         │');
  console.log(`│     Experiences:    ${String(qExperiences).padStart(4)} ${renderBar(qExperiences, 20, 37)}│`);
  console.log(`│     Pain Points:    ${String(qPainPoints).padStart(4)} ${renderBar(qPainPoints, 30, 37)}│`);
  console.log(`│     Solutions:      ${String(qSolutions).padStart(4)} ${renderBar(qSolutions, 30, 37)}│`);
  console.log(`│     Workflows:      ${String(qWorkflows).padStart(4)} ${renderBar(qWorkflows, 20, 37)}│`);
  console.log(`│     Best Practices: ${String(qBestPractices).padStart(4)} ${renderBar(qBestPractices, 25, 37)}│`);

  console.log('└──────────────────────────────────────────────────────────────────┘');
  console.log();

  // Knowledge health
  const ontologyCoverage = (meta?.health?.ontologyCoverage || 0) * 100;
  const epistemicConf = (meta?.health?.epistemicConfidence || 0) * 100;
  const qualiaDepth = (meta?.health?.qualiaDepth || 0) * 100;

  console.log('┌─ KNOWLEDGE HEALTH ───────────────────────────────────────────────┐');
  console.log(`│ Ontology Coverage:  ${ontologyCoverage.toFixed(0).padStart(3)}% ${renderBar(ontologyCoverage, 100, 40)}│`);
  console.log(`│ Epistemic Conf:     ${epistemicConf.toFixed(0).padStart(3)}% ${renderBar(epistemicConf, 100, 40)}│`);
  console.log(`│ Qualia Depth:       ${qualiaDepth.toFixed(0).padStart(3)}% ${renderBar(qualiaDepth, 100, 40)}│`);
  console.log('└──────────────────────────────────────────────────────────────────┘');
  console.log();

  // Recent activity
  const totalSessions = meta?.stats?.totalSessions || 0;
  console.log(`Sessions: ${totalSessions} | Press Ctrl+C to exit`);
}

function renderBar(value: number, max: number, width: number): string {
  const filled = Math.round((value / max) * width);
  const empty = width - filled;

  const bar = '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, empty));
  return bar.substring(0, width) + ' ';
}

function getHealthIcon(health: string): string {
  switch (health) {
    case 'nascent': return '🌱';
    case 'developing': return '🌿';
    case 'good': return '🌳';
    case 'excellent': return '🌲';
    default: return '❓';
  }
}

// ============================================================================
// File-based Knowledge Extraction
// ============================================================================

interface ExtractOptions {
  files?: string[];
  fullScan?: boolean;
}

async function extract(options: ExtractOptions = {}): Promise<void> {
  const weavePath = join(process.cwd(), '.agent/weave');

  if (!existsSync(weavePath)) {
    console.error('❌ Weave not found in current directory');
    console.error('   Expected: .agent/weave/');
    console.error('\nRun: bun weave.ts install');
    process.exit(1);
  }

  console.log(`🌊 Weave v${VERSION} - File-based Knowledge Extraction\n`);

  // Determine which files to process
  let filesToProcess: string[] = [];

  if (options.files && options.files.length > 0) {
    // Explicit files provided
    console.log(`📁 Processing ${options.files.length} explicit files...`);
    filesToProcess = options.files;
  } else if (options.fullScan) {
    // Full scan: all source files
    console.log('📁 Full scan: Finding all source files...');
    filesToProcess = await getSourceFiles(process.cwd());
    console.log(`   Found ${filesToProcess.length} source files`);
  } else {
    // Default: git changed files
    console.log('📁 Finding git changed files...');
    filesToProcess = await getGitChangedFiles(process.cwd());

    if (filesToProcess.length === 0) {
      console.log('   No changed files found');
      console.log('\nTip: Use --full-scan to extract from all source files');
      process.exit(0);
    }

    console.log(`   Found ${filesToProcess.length} changed files`);
  }

  // Read file contents
  console.log('\n📖 Reading files...');
  const fileContents: Array<{ path: string; content: string }> = [];

  for (const filePath of filesToProcess) {
    const absolutePath = join(process.cwd(), filePath);
    if (existsSync(absolutePath)) {
      const content = readFileSync(absolutePath, 'utf-8');
      fileContents.push({ path: filePath, content });
    }
  }

  if (fileContents.length === 0) {
    console.log('❌ No files to process');
    process.exit(1);
  }

  console.log(`   Read ${fileContents.length} files (${formatBytes(fileContents.reduce((sum, f) => sum + f.content.length, 0))})`);

  // Extract knowledge using LLM
  console.log('\n🧠 Extracting knowledge with LLM...');

  const { extractKnowledgeFromFiles } = await import(join(weavePath, 'extraction.ts'));
  const result = await extractKnowledgeFromFiles(fileContents);

  console.log('\n✅ Knowledge extracted successfully!\n');
  console.log(`Results:`);
  console.log(`  - Entities: +${result.ontology.length}`);
  console.log(`  - Compositions: +${result.mereology.length}`);
  console.log(`  - Knowledge items: +${result.epistemology.length}`);
  console.log(`  - Experiences: +${result.qualia.length}`);
  console.log(`  - Processing time: ${result.processingTimeMs}ms`);
  console.log('');
  console.log(`Run: bun .agent/weave/weave.ts monitor`);
}

async function getGitChangedFiles(cwd: string): Promise<string[]> {
  const { spawnSync } = await import('child_process');

  // Get uncommitted changes
  const result = spawnSync('git', ['diff', '--name-only', 'HEAD'], {
    cwd,
    encoding: 'utf-8'
  });

  if (result.error || result.status !== 0) {
    return [];
  }

  return result.stdout
    .split('\n')
    .filter(f => f.trim())
    .filter(f => isSourceFile(f));
}

async function getSourceFiles(cwd: string): Promise<string[]> {
  const { spawnSync } = await import('child_process');

  // Use git ls-files to get tracked source files
  const result = spawnSync('git', ['ls-files'], {
    cwd,
    encoding: 'utf-8'
  });

  if (result.error || result.status !== 0) {
    return [];
  }

  return result.stdout
    .split('\n')
    .filter(f => f.trim())
    .filter(f => isSourceFile(f));
}

function isSourceFile(path: string): boolean {
  const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp'];
  return sourceExtensions.some(ext => path.endsWith(ext));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ============================================================================
// Debug & Observability Commands (US-003)
// ============================================================================

/**
 * Get the Weave path - tries installed path first, falls back to source directory.
 * Checks for debug-format.ts to ensure the installation has US-003 features.
 */
function getWeavePath(): string {
  // Try installed path first - must have US-003 debug files
  const installedPath = join(process.cwd(), '.agent/weave');
  if (
    existsSync(installedPath) &&
    existsSync(join(installedPath, 'index.ts')) &&
    existsSync(join(installedPath, 'debug-format.ts'))
  ) {
    return installedPath;
  }

  // Fall back to source directory (for development)
  if (existsSync(join(__dirname, 'index.ts'))) {
    return __dirname;
  }

  console.error('❌ Weave not found or missing US-003 debug features');
  console.error('   Tried: .agent/weave/ and ' + __dirname);
  console.error('\nRun: bun weave.ts install to update');
  process.exit(1);
}

async function explain(query: string, options: { psyche?: boolean } = {}): Promise<void> {
  const weavePath = getWeavePath();

  // Import Weave and debug-format
  const { Weave } = await import(join(weavePath, 'index.ts'));
  const debugFormat = await import(join(weavePath, 'debug-format.ts'));

  const weave = new Weave(weavePath, false);
  await weave.load();

  if (options.psyche) {
    // Explain user model (Psyche dimension)
    const psycheResult = await weave.explainPsyche();

    console.log(debugFormat.headerBox('User Model (Psyche)', 60));

    if (psycheResult.status === 'not-initialized') {
      console.log(`\n${debugFormat.colors.yellow}${psycheResult.message}${debugFormat.colors.reset}`);
      console.log('\nThe user model builds automatically as you work.');
      console.log('It learns your expertise level, preferred interaction mode, and verbosity preferences.');
      return;
    }

    console.log(`\n${debugFormat.colors.green}${psycheResult.message}${debugFormat.colors.reset}`);

    if (psycheResult.volatileState) {
      console.log(debugFormat.subHeader('Current Session'));
      console.log(`  Focus: ${psycheResult.volatileState.currentFocus || 'none'}`);
      console.log(`  Session Start: ${psycheResult.volatileState.sessionStart}`);
    }

    if (psycheResult.profiles.length > 0) {
      console.log(debugFormat.sectionHeader('Profiles', psycheResult.profiles.length));

      for (const profile of psycheResult.profiles) {
        console.log(`\n  ${debugFormat.colors.bold}${profile.id}${debugFormat.colors.reset} [${profile.scope}]`);
        console.log(`  ${debugFormat.colors.dim}Expertise: ${profile.expertise} | Mode: ${profile.preferredMode} | Verbosity: ${profile.verbosity}${debugFormat.colors.reset}`);
        console.log(`  ${debugFormat.confidenceBadge(profile.confidence)} (${profile.observations} observations)`);

        if (profile.domainExpertise && Object.keys(profile.domainExpertise).length > 0) {
          console.log(`  ${debugFormat.colors.dim}Domain Expertise:${debugFormat.colors.reset}`);
          for (const [domain, level] of Object.entries(profile.domainExpertise)) {
            console.log(`    • ${domain}: ${level}`);
          }
        }
      }
    }

    return;
  }

  // Standard explain query
  const result = await weave.explainKnowledge(query);

  console.log(debugFormat.headerBox(`Weave Knowledge: "${query}"`, 60));

  if (result.totalEntries === 0) {
    console.log(`\n${debugFormat.colors.yellow}No knowledge found for "${query}"${debugFormat.colors.reset}`);
    console.log('\nTry a broader search term or check available dimensions with: bun weave.ts health');
    return;
  }

  console.log(`\n${debugFormat.colors.green}Found ${result.totalEntries} entries across ${Object.keys(result.byDimension).length} dimensions${debugFormat.colors.reset}`);

  // Display results by dimension
  for (const [dimension, entries] of Object.entries(result.byDimension)) {
    const dimEntries = entries.map(e => ({
      id: e.id,
      dimension: e.dimension,
      summary: e.summary,
      confidence: e.confidence,
      provenance: e.provenance,
      keywords: e.keywords,
      // Pass through rich data for pain points
      resolution: e.resolution,
      evidence: e.evidence,
      impact: e.impact,
    }));

    console.log(debugFormat.formatDimensionGroup(dimension as any, dimEntries));
  }
}

async function health(): Promise<void> {
  const weavePath = getWeavePath();

  // Import Weave and debug-format
  const { Weave } = await import(join(weavePath, 'index.ts'));
  const debugFormat = await import(join(weavePath, 'debug-format.ts'));

  const weave = new Weave(weavePath, false);
  const dashboard = await weave.getHealthDashboard();

  console.log(debugFormat.headerBox('Weave Health Dashboard', 60));

  // Overall status
  console.log(`\n${debugFormat.healthStatus(dashboard.status)}`);
  console.log(`Total Entries: ${dashboard.totalEntries}`);
  console.log(`Overall Confidence: ${debugFormat.progressBar(dashboard.overallConfidence * 100, 100, 30)}`);
  console.log(`Checked: ${dashboard.checkedAt}`);

  // Dimension coverage table
  console.log(debugFormat.sectionHeader('Dimension Coverage'));

  const columns = [
    { header: 'Dim', width: 4, align: 'left' as const },
    { header: 'Name', width: 14, align: 'left' as const },
    { header: 'Entries', width: 8, align: 'right' as const },
    { header: 'Confidence', width: 10, align: 'right' as const },
    { header: 'Stale', width: 6, align: 'right' as const },
    { header: 'Low Conf', width: 8, align: 'right' as const },
  ];

  const rows = Object.values(dashboard.dimensionCoverage).map(d => ({
    'Dim': d.dimension,
    'Name': d.name,
    'Entries': d.entryCount,
    'Confidence': `${Math.round(d.avgConfidence * 100)}%`,
    'Stale': d.staleCount,
    'Low Conf': d.lowConfidenceCount,
  }));

  console.log(debugFormat.formatTable(columns, rows));

  // Staleness
  console.log(debugFormat.sectionHeader('Staleness'));
  console.log(`Stale entries (>30 days): ${dashboard.staleness.totalStale} (${dashboard.staleness.percentStale.toFixed(1)}%)`);

  // Confidence distribution
  console.log(debugFormat.sectionHeader('Confidence Distribution'));
  const dist = dashboard.confidenceDistribution.distribution;
  if (dist) {
    console.log(`  Certain (≥95%):      ${dist.certain || 0}`);
    console.log(`  Highly Confident:    ${dist.highly_confident || 0}`);
    console.log(`  Confident (70-85%):  ${dist.confident || 0}`);
    console.log(`  Probable (50-70%):   ${dist.probable || 0}`);
    console.log(`  Uncertain (30-50%):  ${dist.uncertain || 0}`);
    console.log(`  Speculative (<30%):  ${dist.speculative || 0}`);
  }

  // Recommendations
  if (dashboard.recommendations.length > 0) {
    console.log(debugFormat.sectionHeader('Recommendations', dashboard.recommendations.length));
    for (const rec of dashboard.recommendations) {
      console.log(`  ${debugFormat.colors.yellow}•${debugFormat.colors.reset} ${rec}`);
    }
  }
}

async function coherence(): Promise<void> {
  const weavePath = getWeavePath();

  // Import modules
  const { Weave } = await import(join(weavePath, 'index.ts'));
  const { checkCoherence } = await import(join(weavePath, 'coherence-checker.ts'));
  const debugFormat = await import(join(weavePath, 'debug-format.ts'));

  const weave = new Weave(weavePath, false);
  await weave.load();
  const knowledge = await weave.getKnowledge();

  if (!knowledge) {
    console.error('❌ Could not load knowledge base');
    process.exit(1);
  }

  // Build entry list from all dimensions - with defensive null checks
  const entries: any[] = [];

  // Ontology entries
  for (const [id, entity] of Object.entries(knowledge.ontology.entities)) {
    entries.push({
      id,
      dimension: 'O',
      data: entity,
      confidence: entity.provenance?.confidence,
      provenance: entity.provenance,
      lastUpdated: entity.provenance?.timestamp,
    });
  }

  // Mereology entries
  for (const [id, comp] of Object.entries(knowledge.mereology.compositions)) {
    entries.push({
      id,
      dimension: 'M',
      data: comp,
      confidence: comp.provenance?.confidence,
      provenance: comp.provenance,
      lastUpdated: comp.provenance?.timestamp,
    });
  }

  // Epistemology entries
  for (const [id, k] of Object.entries(knowledge.epistemology.knowledge)) {
    entries.push({
      id,
      dimension: 'E',
      data: k,
      confidence: k.confidence,
      lastUpdated: k.evidence?.lastSeen,
    });
  }

  for (const [id, p] of Object.entries(knowledge.epistemology.patterns)) {
    entries.push({
      id,
      dimension: 'E',
      data: p,
      confidence: p.confidence,
      provenance: p.provenance,
      lastUpdated: p.provenance?.timestamp,
    });
  }

  // Qualia entries
  for (const [id, pp] of Object.entries(knowledge.qualia.painPoints)) {
    entries.push({
      id,
      dimension: 'Q',
      data: pp,
      confidence: pp.provenance?.confidence,
      provenance: pp.provenance,
      lastUpdated: pp.provenance?.timestamp,
    });
  }

  for (const [id, wf] of Object.entries(knowledge.qualia.workflows)) {
    entries.push({
      id,
      dimension: 'Q',
      data: wf,
      confidence: wf.provenance?.confidence,
      provenance: wf.provenance,
      lastUpdated: wf.provenance?.timestamp,
    });
  }

  for (const [id, bp] of Object.entries(knowledge.qualia.bestPractices)) {
    entries.push({
      id,
      dimension: 'Q',
      data: bp,
      confidence: bp.confidence,
      provenance: bp.provenance,
      lastUpdated: bp.provenance?.timestamp,
    });
  }

  // Run coherence check
  const result = checkCoherence(entries);

  // Display results
  console.log(debugFormat.headerBox('Coherence Check', 60));

  console.log(`\nStatus: ${debugFormat.healthStatus(result.status as any)}`);
  console.log(`Score: ${debugFormat.progressBar(result.score * 100, 100, 30)}`);
  console.log(`Entries Checked: ${result.entriesChecked}`);
  console.log(`Checked At: ${result.checkedAt}`);

  console.log(debugFormat.sectionHeader('Issue Summary'));
  console.log(`  Contradictions: ${result.stats.contradictions}`);
  console.log(`  Orphan References: ${result.stats.orphans}`);
  console.log(`  Stale Entries: ${result.stats.staleEntries}`);
  console.log(`  Knowledge Gaps: ${result.stats.gaps}`);

  if (result.issues.length > 0) {
    console.log(debugFormat.formatCoherenceReport(result.issues));
  } else {
    console.log(`\n${debugFormat.colors.green}✓ No coherence issues detected. Knowledge base is consistent.${debugFormat.colors.reset}`);
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

const command = process.argv[2];
const args = process.argv.slice(3);

switch (command) {
  case 'install':
    await install(args[0] || './');
    break;

  case 'extract':
    // Parse flags and files
    const fullScan = args.includes('--full-scan');
    const files = args.filter(arg => !arg.startsWith('--'));

    await extract({ files, fullScan });
    break;

  case 'monitor':
    // Use the zero-dependency monitor
    const { spawnSync } = await import('child_process');
    const monitorPath = join(__dirname, 'monitor-simple.ts');
    const result = spawnSync('bun', [monitorPath], {
      stdio: 'inherit',
      cwd: process.cwd()
    });
    process.exit(result.status || 0);
    break;

  case 'explain':
    // Parse --psyche flag
    const isPsyche = args.includes('--psyche');
    const queryParts = args.filter(arg => !arg.startsWith('--'));
    const query = queryParts.join(' ');

    if (!isPsyche && !query) {
      console.log('Usage: bun weave.ts explain <query>');
      console.log('       bun weave.ts explain --psyche');
      console.log('');
      console.log('Examples:');
      console.log('  bun weave.ts explain authentication');
      console.log('  bun weave.ts explain "database schema"');
      console.log('  bun weave.ts explain --psyche');
      process.exit(1);
    }

    await explain(query, { psyche: isPsyche });
    break;

  case 'health':
    await health();
    break;

  case 'coherence':
    await coherence();
    break;

  default:
    console.log('Weave - Q+E+O+M Knowledge Framework');
    console.log('');
    console.log('Usage:');
    console.log('  bun weave.ts install [path]           - Install Weave (default: ./)');
    console.log('  bun weave.ts extract                  - Extract from git changed files');
    console.log('  bun weave.ts extract --full-scan      - Extract from all source files');
    console.log('  bun weave.ts extract file1.ts file2.ts - Extract from specific files');
    console.log('  bun weave.ts monitor                  - Real-time QOEM monitoring');
    console.log('');
    console.log('Debug & Observability (US-003):');
    console.log('  bun weave.ts explain <query>          - Query what Weave knows');
    console.log('  bun weave.ts explain --psyche         - Show user model');
    console.log('  bun weave.ts health                   - Health dashboard');
    console.log('  bun weave.ts coherence                - Check for contradictions');
    console.log('');
    console.log('Examples:');
    console.log('  bun weave.ts install');
    console.log('  bun weave.ts extract');
    console.log('  bun weave.ts extract --full-scan');
    console.log('  bun weave.ts extract src/index.ts src/lib.ts');
    console.log('  bun weave.ts monitor');
    console.log('  bun weave.ts explain authentication');
    console.log('  bun weave.ts health');
    console.log('  bun weave.ts coherence');
    process.exit(1);
}
