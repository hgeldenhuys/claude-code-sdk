/**
 * Coherence Checker
 *
 * Detects cross-dimensional contradictions and inconsistencies in the Weave knowledge base.
 * Analyzes cross-refs, temporal consistency, and semantic conflicts.
 *
 * Issue Types:
 * - contradiction: Two entries directly conflict with each other
 * - orphan: Cross-ref points to non-existent entry
 * - stale: Entry hasn't been validated in a long time
 * - gap: Expected knowledge is missing (e.g., entity without mereology)
 *
 * @module weave/coherence-checker
 */

import type {
  Dimension,
  CrossDimensionalRef,
  Provenance,
  CorticalLayer,
} from './types';
import { DIMENSION_LAYERS, ALL_DIMENSIONS } from './types';
import type { CoherenceIssue } from './debug-format';

// ============================================================================
// Types
// ============================================================================

export interface KnowledgeEntry {
  id: string;
  dimension: Dimension;
  data: Record<string, unknown>;
  confidence?: number;
  provenance?: Provenance;
  relatedEntries?: CrossDimensionalRef[];
  lastUpdated?: string;
  status?: 'active' | 'deprecated' | 'superseded';
}

export interface CoherenceCheckResult {
  /** Overall coherence score (0-1) */
  score: number;
  /** Health status based on score */
  status: 'excellent' | 'good' | 'developing' | 'poor';
  /** List of detected issues */
  issues: CoherenceIssue[];
  /** Timestamp of check */
  checkedAt: string;
  /** Number of entries checked */
  entriesChecked: number;
  /** Summary statistics */
  stats: {
    contradictions: number;
    orphans: number;
    staleEntries: number;
    gaps: number;
  };
}

export interface CoherenceCheckerOptions {
  /** Days after which an entry is considered stale (default: 30) */
  staleDays?: number;
  /** Minimum confidence threshold for flagging low-confidence entries */
  minConfidence?: number;
  /** Check for expected cross-dimensional relationships */
  checkExpectedRelations?: boolean;
  /** Dimensions to check (default: all) */
  dimensions?: Dimension[];
}

// ============================================================================
// Expected Relationships
// ============================================================================

/**
 * Expected relationships between dimensions.
 * If an entry exists in one dimension, we might expect related entries in others.
 */
const EXPECTED_RELATIONS: Array<{
  from: Dimension;
  to: Dimension;
  description: string;
  required: boolean;
}> = [
  // Entities should have mereology (composition) info
  { from: 'O', to: 'M', description: 'Entity should have composition info', required: false },
  // Patterns should have evidence
  { from: 'E', to: 'O', description: 'Pattern should reference entities', required: false },
  // Pain points should have causes
  { from: 'Q', to: 'C', description: 'Pain point should have root cause', required: false },
  // Decisions should have teleology (purpose)
  { from: 'A', to: 'T', description: 'Value judgment should have purpose', required: false },
];

// ============================================================================
// Coherence Checker Class
// ============================================================================

export class CoherenceChecker {
  private options: Required<CoherenceCheckerOptions>;

  constructor(options: CoherenceCheckerOptions = {}) {
    this.options = {
      staleDays: options.staleDays ?? 30,
      minConfidence: options.minConfidence ?? 0.3,
      checkExpectedRelations: options.checkExpectedRelations ?? true,
      dimensions: options.dimensions ?? [...ALL_DIMENSIONS],
    };
  }

  /**
   * Run full coherence check on a set of knowledge entries.
   */
  check(entries: KnowledgeEntry[]): CoherenceCheckResult {
    const issues: CoherenceIssue[] = [];
    const now = new Date();

    // Build index for quick lookups
    const entryIndex = new Map<string, KnowledgeEntry>();
    const entriesByDimension = new Map<Dimension, KnowledgeEntry[]>();

    for (const entry of entries) {
      entryIndex.set(entry.id, entry);
      const dimEntries = entriesByDimension.get(entry.dimension) || [];
      dimEntries.push(entry);
      entriesByDimension.set(entry.dimension, dimEntries);
    }

    // Check 1: Orphaned cross-references
    const orphanIssues = this.checkOrphanedRefs(entries, entryIndex);
    issues.push(...orphanIssues);

    // Check 2: Stale entries
    const staleIssues = this.checkStaleEntries(entries, now);
    issues.push(...staleIssues);

    // Check 3: Low confidence entries
    const lowConfidenceIssues = this.checkLowConfidence(entries);
    issues.push(...lowConfidenceIssues);

    // Check 4: Expected relationships
    if (this.options.checkExpectedRelations) {
      const gapIssues = this.checkExpectedRelationships(entries, entriesByDimension);
      issues.push(...gapIssues);
    }

    // Check 5: Superseded without replacement
    const supersededIssues = this.checkSupersededEntries(entries, entryIndex);
    issues.push(...supersededIssues);

    // Check 6: Cross-layer contradictions
    const contradictionIssues = this.checkCrossLayerContradictions(entries);
    issues.push(...contradictionIssues);

    // Calculate score
    const score = this.calculateScore(issues, entries.length);
    const status = this.scoreToStatus(score);

    return {
      score,
      status,
      issues,
      checkedAt: now.toISOString(),
      entriesChecked: entries.length,
      stats: {
        contradictions: issues.filter(i => i.type === 'contradiction').length,
        orphans: issues.filter(i => i.type === 'orphan').length,
        staleEntries: issues.filter(i => i.type === 'stale').length,
        gaps: issues.filter(i => i.type === 'gap').length,
      },
    };
  }

  /**
   * Check for orphaned cross-references.
   */
  private checkOrphanedRefs(entries: KnowledgeEntry[], index: Map<string, KnowledgeEntry>): CoherenceIssue[] {
    const issues: CoherenceIssue[] = [];

    for (const entry of entries) {
      if (!entry.relatedEntries) continue;

      for (const ref of entry.relatedEntries) {
        if (!index.has(ref.entryId)) {
          issues.push({
            type: 'orphan',
            severity: 'medium',
            description: `Entry "${entry.id}" references non-existent entry "${ref.entryId}" in ${ref.dimension}`,
            entries: [entry.id, ref.entryId],
            suggestion: `Remove orphaned reference or create missing entry in ${ref.dimension}`,
          });
        }
      }
    }

    return issues;
  }

  /**
   * Check for stale entries that haven't been updated recently.
   */
  private checkStaleEntries(entries: KnowledgeEntry[], now: Date): CoherenceIssue[] {
    const issues: CoherenceIssue[] = [];
    const staleThreshold = this.options.staleDays * 24 * 60 * 60 * 1000;

    for (const entry of entries) {
      if (!entry.lastUpdated && !entry.provenance?.timestamp) continue;

      const lastUpdate = new Date(entry.lastUpdated || entry.provenance?.timestamp || '');
      const age = now.getTime() - lastUpdate.getTime();

      if (age > staleThreshold) {
        const daysSinceUpdate = Math.floor(age / (24 * 60 * 60 * 1000));
        issues.push({
          type: 'stale',
          severity: daysSinceUpdate > 90 ? 'high' : 'low',
          description: `Entry "${entry.id}" hasn't been updated in ${daysSinceUpdate} days`,
          entries: [entry.id],
          suggestion: `Review and validate or deprecate entry "${entry.id}"`,
        });
      }
    }

    return issues;
  }

  /**
   * Check for low confidence entries.
   */
  private checkLowConfidence(entries: KnowledgeEntry[]): CoherenceIssue[] {
    const issues: CoherenceIssue[] = [];

    for (const entry of entries) {
      const confidence = entry.confidence ?? entry.provenance?.confidence;
      if (confidence !== undefined && confidence < this.options.minConfidence) {
        issues.push({
          type: 'gap',
          severity: confidence < 0.1 ? 'high' : 'low',
          description: `Entry "${entry.id}" has very low confidence (${Math.round(confidence * 100)}%)`,
          entries: [entry.id],
          suggestion: `Validate or remove low-confidence entry "${entry.id}"`,
        });
      }
    }

    return issues;
  }

  /**
   * Check for expected relationships between dimensions.
   */
  private checkExpectedRelationships(
    entries: KnowledgeEntry[],
    byDimension: Map<Dimension, KnowledgeEntry[]>
  ): CoherenceIssue[] {
    const issues: CoherenceIssue[] = [];

    for (const relation of EXPECTED_RELATIONS) {
      const fromEntries = byDimension.get(relation.from) || [];
      const toEntries = byDimension.get(relation.to) || [];

      // Simple heuristic: if we have many entries in 'from' but few in 'to', flag it
      if (fromEntries.length > 5 && toEntries.length < fromEntries.length * 0.2) {
        issues.push({
          type: 'gap',
          severity: relation.required ? 'high' : 'low',
          description: `${relation.description}: ${fromEntries.length} entries in ${relation.from} but only ${toEntries.length} in ${relation.to}`,
          entries: [],
          suggestion: `Consider adding ${relation.to} entries to support ${relation.from} entries`,
        });
      }
    }

    return issues;
  }

  /**
   * Check for entries marked as superseded without a replacement.
   */
  private checkSupersededEntries(
    entries: KnowledgeEntry[],
    index: Map<string, KnowledgeEntry>
  ): CoherenceIssue[] {
    const issues: CoherenceIssue[] = [];

    for (const entry of entries) {
      if (entry.status === 'superseded') {
        // Check if there's a 'supersedes' reference pointing here
        let hasReplacement = false;
        for (const [, otherEntry] of index) {
          if (otherEntry.relatedEntries?.some(
            ref => ref.entryId === entry.id && ref.relationship === 'supersedes'
          )) {
            hasReplacement = true;
            break;
          }
        }

        if (!hasReplacement) {
          issues.push({
            type: 'orphan',
            severity: 'medium',
            description: `Entry "${entry.id}" is marked as superseded but has no replacement`,
            entries: [entry.id],
            suggestion: `Either restore entry or create a replacement that supersedes it`,
          });
        }
      }
    }

    return issues;
  }

  /**
   * Check for potential contradictions across layers.
   * Layer 1 (substrate) should not be contradicted by Layer 2 (logic).
   */
  private checkCrossLayerContradictions(entries: KnowledgeEntry[]): CoherenceIssue[] {
    const issues: CoherenceIssue[] = [];

    // Group entries by layer
    const byLayer = new Map<CorticalLayer, KnowledgeEntry[]>();
    for (const entry of entries) {
      const layer = DIMENSION_LAYERS[entry.dimension];
      const layerEntries = byLayer.get(layer) || [];
      layerEntries.push(entry);
      byLayer.set(layer, layerEntries);
    }

    // Check for 'contradicts' relationships that cross layers inappropriately
    for (const entry of entries) {
      if (!entry.relatedEntries) continue;

      const entryLayer = DIMENSION_LAYERS[entry.dimension];

      for (const ref of entry.relatedEntries) {
        if (ref.relationship === 'contradicts') {
          const targetLayer = DIMENSION_LAYERS[ref.dimension];

          // Higher layers shouldn't contradict lower layers
          if (
            (entryLayer === 'logic' && targetLayer === 'substrate') ||
            (entryLayer === 'interface' && targetLayer === 'substrate')
          ) {
            issues.push({
              type: 'contradiction',
              severity: 'high',
              description: `${entryLayer} entry "${entry.id}" contradicts ${targetLayer} entry "${ref.entryId}"`,
              entries: [entry.id, ref.entryId],
              suggestion: `Review contradiction: higher-layer knowledge shouldn't contradict foundational substrate facts`,
            });
          }
        }
      }
    }

    return issues;
  }

  /**
   * Calculate overall coherence score.
   */
  private calculateScore(issues: CoherenceIssue[], entryCount: number): number {
    if (entryCount === 0) return 1; // Empty KB is coherent

    // Weight issues by severity
    const severityWeights = { critical: 0.2, high: 0.1, medium: 0.05, low: 0.02 };
    let penalty = 0;

    for (const issue of issues) {
      penalty += severityWeights[issue.severity];
    }

    // Normalize penalty by entry count
    const normalizedPenalty = Math.min(1, penalty / Math.sqrt(entryCount));

    return Math.max(0, 1 - normalizedPenalty);
  }

  /**
   * Convert score to status.
   */
  private scoreToStatus(score: number): 'excellent' | 'good' | 'developing' | 'poor' {
    if (score >= 0.9) return 'excellent';
    if (score >= 0.7) return 'good';
    if (score >= 0.5) return 'developing';
    return 'poor';
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new coherence checker.
 */
export function createCoherenceChecker(options?: CoherenceCheckerOptions): CoherenceChecker {
  return new CoherenceChecker(options);
}

/**
 * Quick check for coherence issues.
 */
export function checkCoherence(
  entries: KnowledgeEntry[],
  options?: CoherenceCheckerOptions
): CoherenceCheckResult {
  const checker = new CoherenceChecker(options);
  return checker.check(entries);
}

export default CoherenceChecker;
