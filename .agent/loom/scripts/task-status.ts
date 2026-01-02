#!/usr/bin/env bun
/**
 * Task Status Update Script
 *
 * Updates task status via Board CLI (Trak).
 *
 * Usage:
 *   bun .agent/loom/scripts/task-status.ts <task-id> <status> [notes]
 *
 * Examples:
 *   bun .agent/loom/scripts/task-status.ts abc123 completed
 *   bun .agent/loom/scripts/task-status.ts abc123 blocked "Waiting on API"
 *   bun .agent/loom/scripts/task-status.ts abc123 in_progress
 *
 * Note: Task ID is the UUID from board task list, not the display code (T-001).
 *       To find task ID: board task list -s STORY-ID --json
 */

import { $ } from 'bun';

const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('Usage: task-status.ts <task-id> <status> [notes]');
  console.error('Status: pending | in_progress | completed | blocked | cancelled');
  console.error('');
  console.error('Note: Use the task UUID from "board task list -s STORY --json"');
  process.exit(1);
}

const [taskId, status, notes] = args;

// Validate status (Trak v0.4.0 statuses use underscores)
const validStatuses = ['pending', 'in_progress', 'completed', 'blocked', 'cancelled'];
if (!validStatuses.includes(status)) {
  console.error(`Invalid status: ${status}`);
  console.error(`Valid statuses: ${validStatuses.join(', ')}`);
  process.exit(1);
}

try {
  // Update task via Board CLI
  const result = await $`board task update ${taskId} -s ${status} --json`.quiet();
  const response = JSON.parse(result.text());

  // Response has { before, after } structure
  const task = response.after || response;
  const oldStatus = response.before?.status || 'unknown';

  console.log(`✅ Task updated: ${oldStatus} → ${status}`);
  console.log(`   Title: ${task.title}`);

  if (notes) {
    console.log(`   Notes: ${notes}`);
  }

  // Get story to show overall progress
  if (task.storyId) {
    const taskListResult = await $`board task list -s ${task.storyId} --json`.quiet().catch(() => null);
    if (taskListResult) {
      const tasks = JSON.parse(taskListResult.text());
      const completed = tasks.filter((t: any) => t.status === 'completed').length;
      const inProgress = tasks.filter((t: any) => t.status === 'in_progress').length;
      const pending = tasks.filter((t: any) => t.status === 'pending').length;
      const blocked = tasks.filter((t: any) => t.status === 'blocked').length;

      console.log(`📊 Progress: ${completed}/${tasks.length} completed, ${inProgress} in-progress, ${pending} pending, ${blocked} blocked`);
    }
  }

} catch (error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error(`❌ Failed to update task: ${errorMessage}`);
  console.error('');
  console.error('Tip: Make sure you are using the task UUID, not the display code.');
  console.error('Run: board task list -s STORY-ID --json');
  process.exit(1);
}
