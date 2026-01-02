/**
 * Session Update Integration
 *
 * Connects the extraction pipeline to the Weave, implementing
 * the Enhanced Version 2 update pattern with clear semantic alignment.
 */

import { Weave } from './index';
import { KnowledgeExtractor } from './extraction';
import type { Session, KnowledgeUpdate } from './types';

// ============================================================================
// Main Update Function - Enhanced Version 2
// ============================================================================

/**
 * Updates Weave knowledge from a Claude Code session.
 * This is the main entry point for learning from development sessions.
 *
 * Follows the Enhanced Version 2 pattern:
 * - Semantic clarity over performance
 * - Different signals update different dimensions
 * - Provenance and confidence as first-class concerns
 */
export async function updateWeaveFromSession(
  session: Session,
  weave: Weave = new Weave()
): Promise<UpdateResult> {
  const startTime = Date.now();
  const extractor = new KnowledgeExtractor();

  try {
    // Load existing knowledge
    await weave.load();

    // Extract knowledge updates from session
    console.log(`[Weave] Extracting knowledge from session ${session.id}...`);
    const updates = await extractor.extractFromSession(session);

    // Group updates by dimension for semantic clarity
    const updatesByDimension = groupUpdatesByDimension(updates);

    // Apply updates with semantic alignment
    await applySemanticUpdates(weave, updatesByDimension, session);

    // Save updated knowledge
    await weave.save();

    // Calculate metrics
    const endTime = Date.now();
    const result: UpdateResult = {
      success: true,
      sessionId: session.id,
      updatesApplied: updates.length,
      dimensionsUpdated: Object.keys(updatesByDimension),
      processingTime: endTime - startTime,
      newConcepts: countNewConcepts(updates),
      confidenceUpdates: countConfidenceUpdates(updates),
      selfAwareness: await weave.getSelfAwareness()
    };

    console.log(`[Weave] Session update complete:`, result);
    return result;

  } catch (error) {
    console.error(`[Weave] Failed to update from session:`, error);
    return {
      success: false,
      sessionId: session.id,
      error: error instanceof Error ? error.message : 'Unknown error',
      updatesApplied: 0,
      dimensionsUpdated: [],
      processingTime: Date.now() - startTime,
      newConcepts: 0,
      confidenceUpdates: 0
    };
  }
}

// ============================================================================
// Semantic Update Application
// ============================================================================

/**
 * Apply updates with semantic clarity - different experiences
 * update different knowledge dimensions.
 */
async function applySemanticUpdates(
  weave: Weave,
  updatesByDimension: GroupedUpdates,
  session: Session
): Promise<void> {

  // Update Structural Knowledge (O+M)
  // What exists and how it's composed
  if (updatesByDimension.O || updatesByDimension.M) {
    console.log('[Weave] Updating structural knowledge (O+M)...');
    await updateStructuralKnowledge(
      weave,
      [...(updatesByDimension.O || []), ...(updatesByDimension.M || [])],
      session
    );
  }

  // Update Epistemic Knowledge (E)
  // What we know and how certain we are
  if (updatesByDimension.E) {
    console.log('[Weave] Updating epistemic knowledge (E)...');
    await updateEpistemicKnowledge(
      weave,
      updatesByDimension.E,
      session
    );
  }

  // Update Experiential Knowledge (Q)
  // What it's like to work with this
  if (updatesByDimension.Q) {
    console.log('[Weave] Updating experiential knowledge (Q)...');
    await updateExperientialKnowledge(
      weave,
      updatesByDimension.Q,
      session
    );
  }
}

// ============================================================================
// Dimension-Specific Updates (Enhanced Version 2)
// ============================================================================

async function updateStructuralKnowledge(
  weave: Weave,
  updates: KnowledgeUpdate[],
  session: Session
): Promise<void> {
  // Meaning: "Code changes teach us about structure"

  for (const update of updates) {
    // Add session context to provenance
    update.provenance.source = `session-${session.id}`;

    // Apply with semantic meaning
    await weave.update([update]);

    console.log(`  - ${update.dimension}: ${update.operation} ${
      update.data.id || update.data.name || 'concept'
    }`);
  }
}

async function updateEpistemicKnowledge(
  weave: Weave,
  updates: KnowledgeUpdate[],
  session: Session
): Promise<void> {
  // Meaning: "Repeated observations increase certainty"

  for (const update of updates) {
    // Bayesian confidence update happens in Weave.update()
    update.provenance.source = `session-${session.id}`;

    await weave.update([update]);

    console.log(`  - E: ${update.data.reason || 'confidence update'} for ${
      update.data.id || 'concept'
    }`);
  }
}

async function updateExperientialKnowledge(
  weave: Weave,
  updates: KnowledgeUpdate[],
  session: Session
): Promise<void> {
  // Meaning: "Errors and fixes teach us experiential lessons"

  for (const update of updates) {
    update.provenance.source = `session-${session.id}`;

    // Qualia accumulates over time
    await weave.update([update]);

    console.log(`  - Q: ${update.operation} experience from ${
      update.data.concept || 'development'
    }`);
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function groupUpdatesByDimension(updates: KnowledgeUpdate[]): GroupedUpdates {
  const grouped: GroupedUpdates = {};

  for (const update of updates) {
    if (!grouped[update.dimension]) {
      grouped[update.dimension] = [];
    }
    grouped[update.dimension].push(update);
  }

  return grouped;
}

function countNewConcepts(updates: KnowledgeUpdate[]): number {
  return updates.filter(u =>
    u.operation === 'add' && (u.dimension === 'O' || u.dimension === 'M')
  ).length;
}

function countConfidenceUpdates(updates: KnowledgeUpdate[]): number {
  return updates.filter(u =>
    u.operation === 'update' && u.dimension === 'E'
  ).length;
}

// ============================================================================
// Session-End Hook Integration
// ============================================================================

/**
 * Claude Code hook integration - call this from session-end.ts
 */
export async function onSessionEnd(event: any): Promise<void> {
  // Parse session from hook event
  const session = parseSessionFromHookEvent(event);

  if (!session) {
    console.error('[Weave] Could not parse session from hook event');
    return;
  }

  // Update Weave with session knowledge
  const result = await updateWeaveFromSession(session);

  // Log self-awareness after update
  if (result.success && result.selfAwareness) {
    console.log('[Weave] Knowledge health:', result.selfAwareness.health);
    console.log('[Weave] Coverage:', result.selfAwareness.coverage);
    console.log('[Weave] Confidence distribution:', result.selfAwareness.confidence);
  }
}

function parseSessionFromHookEvent(event: any): Session | null {
  try {
    return {
      id: event.sessionId || `session-${Date.now()}`,
      startedAt: event.startedAt || new Date().toISOString(),
      endedAt: event.endedAt || new Date().toISOString(),
      filesChanged: event.filesChanged || [],
      toolUses: event.toolUses || [],
      errors: event.errors || [],
      fixes: event.fixes || [],
      commit: event.commit,
      patterns: []
    };
  } catch (error) {
    console.error('[Weave] Failed to parse session:', error);
    return null;
  }
}

// ============================================================================
// Type Definitions
// ============================================================================

interface UpdateResult {
  success: boolean;
  sessionId: string;
  updatesApplied: number;
  dimensionsUpdated: string[];
  processingTime: number;
  newConcepts: number;
  confidenceUpdates: number;
  error?: string;
  selfAwareness?: any;
}

interface GroupedUpdates {
  [dimension: string]: KnowledgeUpdate[];
}

// ============================================================================
// Exports
// ============================================================================

export { UpdateResult };