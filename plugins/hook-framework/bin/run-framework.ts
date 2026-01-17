#!/usr/bin/env bun
/**
 * Hook Framework Plugin Entry Point
 *
 * Runs the hook framework with configuration from:
 * 1. Project's hooks.yaml (if exists)
 * 2. Plugin's default hooks.yaml (fallback)
 *
 * This script is called by Claude Code for each hook event.
 */

import * as fs from 'fs';
import * as path from 'path';

// Get paths
const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.dirname(path.dirname(import.meta.path));
const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// Config search order
const configPaths = [
  path.join(projectDir, 'hooks.yaml'),
  path.join(projectDir, 'hooks.yml'),
  path.join(projectDir, '.claude', 'hooks.yaml'),
  path.join(projectDir, '.claude', 'hooks.yml'),
  path.join(pluginRoot, 'hooks.yaml'), // Plugin's default
];

// Find first existing config
let configPath: string | undefined;
for (const p of configPaths) {
  if (fs.existsSync(p)) {
    configPath = p;
    break;
  }
}

if (!configPath) {
  // No config found - output empty and exit
  console.log('');
  process.exit(0);
}

// Import and run the framework
// We need to dynamically import from the SDK or use the bundled version
async function main() {
  try {
    // Try to load from installed SDK first
    const sdkPaths = [
      path.join(projectDir, 'node_modules', 'claude-code-sdk', 'bin', 'hooks.ts'),
      path.join(pluginRoot, '..', '..', 'bin', 'hooks.ts'), // If plugin is in SDK repo
    ];

    let sdkHooksPath: string | undefined;
    for (const p of sdkPaths) {
      if (fs.existsSync(p)) {
        sdkHooksPath = p;
        break;
      }
    }

    if (sdkHooksPath) {
      // Use the SDK's hooks CLI
      const { spawn } = await import('child_process');
      const child = spawn('bun', [sdkHooksPath, '--config', configPath], {
        stdio: ['pipe', 'pipe', 'inherit'],
        env: process.env,
      });

      // Pipe stdin to child
      process.stdin.pipe(child.stdin);

      // Collect stdout
      let output = '';
      child.stdout.on('data', (data) => {
        output += data.toString();
      });

      child.on('close', (code) => {
        if (output) {
          process.stdout.write(output);
        }
        process.exit(code || 0);
      });

      child.on('error', () => {
        // Fallback: run embedded framework
        runEmbeddedFramework();
      });
    } else {
      // No SDK found - run embedded framework
      runEmbeddedFramework();
    }
  } catch (error) {
    console.error(`[hook-framework] Error: ${error}`);
    console.log('');
    process.exit(0);
  }
}

async function runEmbeddedFramework() {
  // Embedded minimal framework for when SDK is not installed
  // This provides basic session-naming and turn-tracker functionality

  const input = await Bun.stdin.text();
  if (!input.trim()) {
    console.log('');
    return;
  }

  try {
    const event = JSON.parse(input);
    const eventType = event.hook_event_name;

    // Minimal response based on event type
    if (eventType === 'SessionStart') {
      // Generate a simple session name
      const adjectives = ['brave', 'calm', 'eager', 'fair', 'gentle', 'happy', 'keen', 'lively'];
      const animals = ['bear', 'cat', 'dog', 'eagle', 'fox', 'hawk', 'lion', 'owl'];
      const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
      const animal = animals[Math.floor(Math.random() * animals.length)];
      const sessionName = `${adj}-${animal}`;

      console.log(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: `Your session name is: ${sessionName}`,
        },
      }));
    } else {
      // Other events - just pass through
      console.log('');
    }
  } catch {
    console.log('');
  }
}

main();
