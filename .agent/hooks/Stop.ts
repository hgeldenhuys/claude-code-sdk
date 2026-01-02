#!/usr/bin/env bun

/**
 * Stop Hook - Automatic knowledge extraction from edited files
 *
 * This hook runs when the main agent finishes responding.
 * It receives the list of files edited during the transaction and
 * triggers knowledge extraction only on those specific files.
 *
 * Benefits:
 * - Fast: Only processes files actually edited in this turn
 * - Reliable: Works even if files were committed during the session
 * - Efficient: No git diff needed, exact file list from hook SDK
 */

interface StopInput {
  hook_event_name: 'Stop';
  session_id: string;
  cwd: string;
  timestamp: string;
  context?: {
    transactionId?: string;
    conversationId?: string;
    editedFiles?: string[];
  };
}

async function readStdin(): Promise<StopInput> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const input = Buffer.concat(chunks).toString('utf-8');
  return JSON.parse(input);
}

async function log(message: string, cwd: string) {
  try {
    const { appendFileSync } = await import('fs');
    const { join } = await import('path');
    const logPath = join(cwd, '.agent/weave.log');
    const timestamp = new Date().toISOString();
    appendFileSync(logPath, `[${timestamp}] ${message}\n`);
  } catch (error) {
    // Silently fail if logging fails - don't break the hook
  }
}

async function main() {
  try {
    const input = await readStdin();

    await log(`Stop hook fired - sessionId: ${input.session_id}, txId: ${input.context?.transactionId}`, input.cwd);

    // Check if Weave is installed
    const { existsSync } = await import('fs');
    const { join } = await import('path');
    const weavePath = join(input.cwd, '.agent/weave');

    if (!existsSync(weavePath)) {
      // Weave not installed, continue without extraction
      await log('Weave not installed - skipping extraction', input.cwd);
      console.log(JSON.stringify({
        continue: true,
        exitCode: 0
      }));
      return;
    }

    // Get edited files from context
    const editedFiles = input.context?.editedFiles;

    if (!editedFiles || editedFiles.length === 0) {
      // No files edited, nothing to extract
      await log('No edited files - skipping extraction', input.cwd);
      console.log(JSON.stringify({
        continue: true,
        exitCode: 0
      }));
      return;
    }

    await log(`Edited files (${editedFiles.length}): ${editedFiles.join(', ')}`, input.cwd);

    // Run extraction on edited files only
    const { spawnSync } = await import('child_process');
    const extractScript = join(weavePath, 'weave.ts');

    await log(`Running: bun ${extractScript} extract ${editedFiles.join(' ')}`, input.cwd);

    // Pass the specific files to extract
    const result = spawnSync('bun', [extractScript, 'extract', ...editedFiles], {
      cwd: input.cwd,
      encoding: 'utf-8',
      timeout: 30000 // 30 second timeout
    });

    if (result.error) {
      await log(`Extraction failed: ${result.error.message}`, input.cwd);
      console.log(JSON.stringify({
        continue: true,
        exitCode: 1,
        stdout: `[Weave Stop] Extraction failed: ${result.error.message}`
      }));
      return;
    }

    // Log extraction output
    if (result.stdout) {
      await log(`Extraction stdout: ${result.stdout.trim()}`, input.cwd);
    }
    if (result.stderr) {
      await log(`Extraction stderr: ${result.stderr.trim()}`, input.cwd);
    }
    await log(`Extraction exit code: ${result.status}`, input.cwd);

    // Success - extraction completed
    await log(`✓ Extraction completed - processed ${editedFiles.length} file(s)`, input.cwd);

    // Update Librarian index for changed backend files
    try {
      const librarianScript = join(input.cwd, '.agent/librarian/update-incremental.ts');

      if (existsSync(librarianScript)) {
        await log('Running librarian incremental update...', input.cwd);

        const libResult = spawnSync('bun', [librarianScript, ...editedFiles], {
          cwd: input.cwd,
          encoding: 'utf-8',
          timeout: 10000 // 10 second timeout
        });

        if (libResult.stdout) {
          await log(`Librarian: ${libResult.stdout.trim()}`, input.cwd);
        }
      }
    } catch (libError) {
      // Don't fail the hook if librarian update fails
      await log(`Librarian update failed (non-fatal): ${libError instanceof Error ? libError.message : String(libError)}`, input.cwd);
    }

    console.log(JSON.stringify({
      continue: true,
      exitCode: 0,
      stdout: `[Weave Stop] ✓ Extracted knowledge from ${editedFiles.length} file(s)`,
      output: {
        sessionId: input.session_id,
        transactionId: input.context?.transactionId,
        filesProcessed: editedFiles.length
      }
    }));
  } catch (error) {
    await log(`Error in Stop hook: ${error instanceof Error ? error.message : String(error)}`, input.cwd).catch(() => {});
    console.log(JSON.stringify({
      continue: true,
      exitCode: 1,
      stdout: `[Weave Stop] Error: ${error instanceof Error ? error.message : String(error)}`
    }));
  }
}

main();
