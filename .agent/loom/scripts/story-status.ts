#!/usr/bin/env bun
/**
 * Story Status Update Script
 *
 * Updates story status via Board CLI (Trak).
 *
 * Usage:
 *   bun .agent/loom/scripts/story-status.ts <story-id> <status>
 *
 * Examples:
 *   bun .agent/loom/scripts/story-status.ts PROD-001 in_progress
 *   bun .agent/loom/scripts/story-status.ts PROD-001 completed
 *   bun .agent/loom/scripts/story-status.ts PROD-001 blocked
 */

import { $ } from 'bun';

const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('Usage: story-status.ts <story-id> <status>');
  console.error('Status: draft | planned | in_progress | completed | blocked | cancelled | archived');
  process.exit(1);
}

const [storyId, status] = args;

// Validate status (Trak v0.4.0 statuses use underscores)
const validStatuses = ['draft', 'planned', 'in_progress', 'completed', 'blocked', 'cancelled', 'archived'];
if (!validStatuses.includes(status)) {
  console.error(`Invalid status: ${status}`);
  console.error(`Valid statuses: ${validStatuses.join(', ')}`);
  process.exit(1);
}

try {
  // Update story via Board CLI
  const result = await $`board story update ${storyId} -s ${status} --json`.quiet();
  const story = JSON.parse(result.text());

  console.log(`✅ Story ${storyId}: status → ${status}`);

  // Get task and AC progress
  const taskResult = await $`board task list -s ${storyId} --json`.quiet();
  const tasks = JSON.parse(taskResult.text());

  const acResult = await $`board ac progress -s ${storyId} --json`.quiet();
  const acProgress = JSON.parse(acResult.text());

  // Calculate task stats
  const completed = tasks.filter((t: any) => t.status === 'completed').length;
  const inProgress = tasks.filter((t: any) => t.status === 'in_progress').length;
  const pending = tasks.filter((t: any) => t.status === 'pending').length;
  const blocked = tasks.filter((t: any) => t.status === 'blocked').length;

  console.log(`📊 Tasks: ${completed}/${tasks.length} completed, ${inProgress} in-progress, ${pending} pending, ${blocked} blocked`);
  console.log(`✓ ACs: ${acProgress.verified}/${acProgress.total} verified, ${acProgress.pending} pending, ${acProgress.failed} failed`);

} catch (error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error(`❌ Failed to update story: ${errorMessage}`);
  process.exit(1);
}
