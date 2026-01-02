/**
 * Weave - 17-Dimensional Cortical Knowledge Framework Types
 *
 * Core type definitions for the three-layer cortical knowledge representation system:
 *
 * Layer 1 - Substrate (Physical Reality)
 * - Ontology (O): What exists - formal structure and relationships
 * - Mereology (M): How parts compose - part-whole composition
 * - History (H): How we got here - temporal evolution
 *
 * Layer 2 - Logic (Reasoning & Ethics)
 * - Epistemology (E): How we know - knowledge confidence and provenance
 * - Causation (C): What caused what - causal chains and mechanisms
 * - Deontics (D): What must/can/cannot - obligations and permissions
 * - Praxeology (P): How we work - work patterns and strategies
 * - Teleology (T): What is this for - purposes and goals
 * - Axiology (A): What is valuable - value judgments and quality
 * - Modality (Mo): What could be - alternatives and possibilities
 *
 * Layer 3 - Interface (Human-AI Symbiosis)
 * - Qualia (Q): What it's like - experiential, subjective knowledge
 * - Psyche (Psi): User model - understanding the human collaborator
 * - Oikonomia (Oi): Resource economy - tokens, time, compute budgets
 * - Semiotics (Si): Meaning layer - signs, symbols, interpretation
 * - Kairos (Ka): Opportune moment - timing and context sensitivity
 * - Hyposchesin (Hy): Commitments - promises and expectations
 * - Anamnesis (An): Recall/memory - session and long-term memory
 */

// ============================================================================
// Common Types
// ============================================================================

/**
 * Branded type for confidence values, ensuring they are always 0-1.
 * Use the `confidence()` factory function to create validated instances.
 */
export type Confidence = number & { readonly __brand: 'Confidence' };

/**
 * Create a validated Confidence value.
 * @param value - Number between 0 and 1
 * @throws Error if value is outside 0-1 range
 */
export function confidence(value: number): Confidence {
  if (value < 0 || value > 1) {
    throw new Error(`Confidence must be between 0 and 1, got: ${value}`);
  }
  return value as Confidence;
}

/**
 * Safely create a confidence value, clamping to valid range.
 * Use when you want to avoid exceptions.
 */
export function confidenceSafe(value: number): Confidence {
  return Math.max(0, Math.min(1, value)) as Confidence;
}

/**
 * Check if a value is a valid confidence (0-1 range).
 */
export function isValidConfidence(value: number): value is Confidence {
  return typeof value === 'number' && value >= 0 && value <= 1 && !isNaN(value);
}

/**
 * Confidence level descriptors for human-readable output.
 */
export type ConfidenceLevel = 'speculative' | 'uncertain' | 'probable' | 'confident' | 'highly_confident' | 'certain';

/**
 * Convert numeric confidence to descriptive level.
 */
export function confidenceToLevel(conf: Confidence | number): ConfidenceLevel {
  const value = conf as number;
  if (value < 0.3) return 'speculative';
  if (value < 0.5) return 'uncertain';
  if (value < 0.7) return 'probable';
  if (value < 0.85) return 'confident';
  if (value < 0.95) return 'highly_confident';
  return 'certain';
}

/**
 * Convert confidence level to numeric value (midpoint of range).
 */
export function levelToConfidence(level: ConfidenceLevel): Confidence {
  const map: Record<ConfidenceLevel, number> = {
    'speculative': 0.15,
    'uncertain': 0.4,
    'probable': 0.6,
    'confident': 0.775,
    'highly_confident': 0.9,
    'certain': 0.975,
  };
  return confidence(map[level]);
}

// ============================================================================
// Confidence Migration Utilities
// ============================================================================

/**
 * Safely convert a raw number to Confidence, clamping to valid range.
 * Use this when migrating existing data that may have invalid values.
 */
export function migrateConfidence(value: number | Confidence | undefined): Confidence | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number') return value; // Already Confidence or invalid

  // Clamp to valid range
  const clamped = Math.max(0, Math.min(1, value));
  return confidence(clamped);
}

/**
 * Migrate all confidence values in an object recursively.
 * Looks for 'confidence' properties and converts them to branded type.
 */
export function migrateObjectConfidences<T extends Record<string, unknown>>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj;

  const result: Record<string, unknown> = {};

  for (const key of Object.keys(obj)) {
    const value = obj[key];

    if (key === 'confidence' && typeof value === 'number') {
      // Migrate confidence field
      result[key] = migrateConfidence(value);
    } else if (Array.isArray(value)) {
      // Recursively process arrays
      result[key] = value.map(item =>
        typeof item === 'object' && item !== null
          ? migrateObjectConfidences(item as Record<string, unknown>)
          : item
      );
    } else if (typeof value === 'object' && value !== null) {
      // Recursively process nested objects
      result[key] = migrateObjectConfidences(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result as T;
}

/**
 * Validate that a number is a valid confidence value.
 */
export function isValidConfidence(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= 1 && !isNaN(value);
}

/**
 * Create a confidence value with descriptive level, useful for documentation.
 */
export function confidenceFromDescription(level: ConfidenceLevel): { value: Confidence; level: ConfidenceLevel } {
  return {
    value: levelToConfidence(level),
    level,
  };
}

export interface Provenance {
  source: ProvenanceSource;
  sessionId: string;
  timestamp: string;
  confidence: Confidence | number;  // Accepts both for backward compatibility
  observations?: number;
  agent?: string;
}

// ============================================================================
// Cross-Dimensional References
// ============================================================================

/**
 * Relationship types for cross-dimensional links.
 */
export type CrossDimensionalRelation =
  | 'supports'      // This entry provides evidence for the linked entry
  | 'contradicts'   // This entry conflicts with the linked entry
  | 'extends'       // This entry builds upon the linked entry
  | 'implements'    // This entry is a concrete implementation of the linked entry
  | 'causedBy'      // This entry was caused by the linked entry (C→O, C→C)
  | 'partOf'        // This entry is part of the linked entry (M→O)
  | 'exemplifies'   // This entry is an example of the linked entry
  | 'supersedes'    // This entry replaces the linked entry (for corrections)
  | 'relatedTo';    // Generic relation when no specific type applies

/**
 * A reference to an entry in another dimension.
 */
export interface CrossDimensionalRef {
  /** The target dimension */
  dimension: Dimension;
  /** The target entry ID */
  entryId: string;
  /** The nature of the relationship */
  relationship: CrossDimensionalRelation;
  /** Optional description of why this link exists */
  rationale?: string;
  /** Confidence in this relationship */
  confidence?: Confidence | number;
}

/**
 * Mixin interface for entries that can have cross-dimensional references.
 * Add to any knowledge entry type that should support linking.
 */
export interface WithCrossRefs {
  /** References to related entries in other dimensions */
  relatedEntries?: CrossDimensionalRef[];
}

/**
 * Helper to create a cross-dimensional reference.
 */
export function createCrossRef(
  dimension: Dimension,
  entryId: string,
  relationship: CrossDimensionalRelation,
  rationale?: string
): CrossDimensionalRef {
  return {
    dimension,
    entryId,
    relationship,
    rationale,
  };
}

/**
 * Find all entries that reference a given entry across dimensions.
 * This is the "backlink" lookup.
 */
export function findBacklinks<T extends WithCrossRefs>(
  entries: T[],
  targetDimension: Dimension,
  targetEntryId: string
): Array<{ entry: T; ref: CrossDimensionalRef }> {
  const results: Array<{ entry: T; ref: CrossDimensionalRef }> = [];

  for (const entry of entries) {
    if (entry.relatedEntries) {
      for (const ref of entry.relatedEntries) {
        if (ref.dimension === targetDimension && ref.entryId === targetEntryId) {
          results.push({ entry, ref });
        }
      }
    }
  }

  return results;
}

export type ProvenanceSource =
  | 'code-analysis'
  | 'schema-analysis'
  | 'dependency-analysis'
  | 'pattern-detection'
  | 'error-tracking'
  | 'fix-implementation'
  | 'workflow-detection'
  | 'commit-message-analysis'
  | 'manual-annotation'
  | 'session-init';

export interface CodeLocation {
  file: string;
  startLine?: number;
  endLine?: number;
}

export interface Example {
  sessionId: string;
  location?: CodeLocation;
  context?: string;
}

// ============================================================================
// Dimension Types - 17D Cortical Architecture
// ============================================================================

/**
 * CorticalLayer represents the three-layer architecture of the knowledge framework.
 * Each layer serves a distinct purpose in the human-AI symbiosis model.
 */
export type CorticalLayer = 'substrate' | 'logic' | 'interface';

/**
 * Dimension represents all 17 knowledge dimensions across the three cortical layers.
 *
 * Note: We use ASCII-compatible short codes instead of Greek letters for
 * practical reasons (file naming, JSON keys, CLI arguments).
 */
export type Dimension =
  // Layer 1 - Substrate (Physical Reality)
  | 'O'   // Ontology - What exists
  | 'M'   // Mereology - How parts compose
  | 'H'   // History - How we got here
  // Layer 2 - Logic (Reasoning & Ethics)
  | 'E'   // Epistemology - How we know
  | 'C'   // Causation - What caused what
  | 'D'   // Deontics - What must/can/cannot
  | 'P'   // Praxeology - How we work
  | 'T'   // Teleology - What is this for
  | 'A'   // Axiology - What is valuable
  | 'Mo'  // Modality - What could be
  // Layer 3 - Interface (Human-AI Symbiosis)
  | 'Q'   // Qualia - What it's like
  | 'Psi' // Psyche - User model
  | 'Oi'  // Oikonomia - Resource economy
  | 'Si'  // Semiotics - Meaning layer
  | 'Ka'  // Kairos - Opportune moment
  | 'Hy'  // Hyposchesin - Commitments
  | 'An'; // Anamnesis - Recall/memory

/**
 * Maps each dimension to its cortical layer for organizational and query purposes.
 */
export const DIMENSION_LAYERS: Record<Dimension, CorticalLayer> = {
  // Substrate layer
  'O': 'substrate',
  'M': 'substrate',
  'H': 'substrate',
  // Logic layer
  'E': 'logic',
  'C': 'logic',
  'D': 'logic',
  'P': 'logic',
  'T': 'logic',
  'A': 'logic',
  'Mo': 'logic',
  // Interface layer
  'Q': 'interface',
  'Psi': 'interface',
  'Oi': 'interface',
  'Si': 'interface',
  'Ka': 'interface',
  'Hy': 'interface',
  'An': 'interface',
};

/**
 * Human-readable names for each dimension.
 */
export const DIMENSION_NAMES: Record<Dimension, string> = {
  'O': 'Ontology',
  'M': 'Mereology',
  'H': 'History',
  'E': 'Epistemology',
  'C': 'Causation',
  'D': 'Deontics',
  'P': 'Praxeology',
  'T': 'Teleology',
  'A': 'Axiology',
  'Mo': 'Modality',
  'Q': 'Qualia',
  'Psi': 'Psyche',
  'Oi': 'Oikonomia',
  'Si': 'Semiotics',
  'Ka': 'Kairos',
  'Hy': 'Hyposchesin',
  'An': 'Anamnesis',
};

/**
 * Descriptions of what each dimension captures.
 */
export const DIMENSION_DESCRIPTIONS: Record<Dimension, string> = {
  'O': 'What exists - formal structure and relationships',
  'M': 'How parts compose - part-whole composition',
  'H': 'How we got here - temporal evolution and history',
  'E': 'How we know - knowledge confidence and provenance',
  'C': 'What caused what - causal chains and mechanisms',
  'D': 'What must/can/cannot - obligations and permissions',
  'P': 'How we work - work patterns and strategies',
  'T': 'What is this for - purposes and goals',
  'A': 'What is valuable - value judgments and quality metrics',
  'Mo': 'What could be - alternatives and possibilities',
  'Q': 'What it is like - experiential, subjective knowledge',
  'Psi': 'User model - understanding the human collaborator',
  'Oi': 'Resource economy - tokens, time, compute budgets',
  'Si': 'Meaning layer - signs, symbols, interpretation',
  'Ka': 'Opportune moment - timing and context sensitivity',
  'Hy': 'Commitments - promises and expectations tracking',
  'An': 'Recall/memory - session and long-term memory',
};

/**
 * All dimensions in a typed array for iteration.
 */
export const ALL_DIMENSIONS: Dimension[] = [
  'O', 'M', 'H',           // Substrate
  'E', 'C', 'D', 'P', 'T', 'A', 'Mo',  // Logic
  'Q', 'Psi', 'Oi', 'Si', 'Ka', 'Hy', 'An',  // Interface
];

/**
 * Dimensions grouped by cortical layer.
 */
export const LAYER_DIMENSIONS: Record<CorticalLayer, Dimension[]> = {
  substrate: ['O', 'M', 'H'],
  logic: ['E', 'C', 'D', 'P', 'T', 'A', 'Mo'],
  interface: ['Q', 'Psi', 'Oi', 'Si', 'Ka', 'Hy', 'An'],
};

/**
 * Legacy dimension type for backward compatibility with 4D/11D code.
 * Maps old Greek-letter symbols to new ASCII codes.
 */
export type LegacyDimension =
  | 'Q' | 'E' | 'O' | 'M'  // Original 4D
  | 'C' | 'A' | 'T'        // Added in 7D
  | 'H' | 'P' | 'Mo' | 'D' // Added in 11D (H was 'Η', P was 'Π', Mo was 'Μ', D was 'Δ')
  ;

/**
 * Maps legacy Greek-letter symbols to new ASCII dimension codes.
 * Useful for migrating existing knowledge bases.
 *
 * WARNING: Some Greek letters are visually identical to Latin letters!
 * - 'O' (Latin, U+004F) vs 'Ο' (Greek Omicron, U+039F)
 * - 'A' (Latin, U+0041) vs 'Α' (Greek Alpha, U+0391)
 * - 'H' (Latin, U+0048) vs 'Η' (Greek Eta, U+0397)
 * Use normalizeToASCII() to detect and convert these.
 */
export const LEGACY_DIMENSION_MAP: Record<string, Dimension> = {
  // Original symbols still valid
  'Q': 'Q',
  'E': 'E',
  'O': 'O',
  'M': 'M',
  'C': 'C',
  'A': 'A',
  'T': 'T',
  'H': 'H',
  'P': 'P',
  'D': 'D',
  // Greek letters to ASCII
  'Η': 'H',   // Greek Eta -> H (History)
  'Π': 'P',   // Greek Pi -> P (Praxeology)
  'Μ': 'Mo',  // Greek Mu -> Mo (Modality)
  'Δ': 'D',   // Greek Delta -> D (Deontics)
  // New dimensions (no legacy mapping needed)
  'Mo': 'Mo',
  'Psi': 'Psi',
  'Ψ': 'Psi',
  'Oi': 'Oi',
  'Ο': 'Oi',  // Greek Omicron -> Oi (Oikonomia) - VISUALLY IDENTICAL TO LATIN O!
  'Si': 'Si',
  'Σ': 'Si',  // Greek Sigma -> Si (Semiotics)
  'Ka': 'Ka',
  'Κ': 'Ka',  // Greek Kappa -> Ka (Kairos)
  'Hy': 'Hy',
  'Υ': 'Hy',  // Greek Upsilon -> Hy (Hyposchesin)
  'An': 'An',
  'Α': 'An',  // Greek Alpha -> An (Anamnesis) - VISUALLY IDENTICAL TO LATIN A!
};

/**
 * Greek letters that look identical to Latin letters.
 * Maps Greek Unicode codepoint to the Latin equivalent.
 */
export const GREEK_LATIN_CONFUSABLES: Record<string, string> = {
  'Α': 'A',  // Greek Alpha (U+0391) -> Latin A (U+0041)
  'Β': 'B',  // Greek Beta (U+0392) -> Latin B (U+0042)
  'Ε': 'E',  // Greek Epsilon (U+0395) -> Latin E (U+0045)
  'Η': 'H',  // Greek Eta (U+0397) -> Latin H (U+0048)
  'Ι': 'I',  // Greek Iota (U+0399) -> Latin I (U+0049)
  'Κ': 'K',  // Greek Kappa (U+039A) -> Latin K (U+004B)
  'Μ': 'M',  // Greek Mu (U+039C) -> Latin M (U+004D)
  'Ν': 'N',  // Greek Nu (U+039D) -> Latin N (U+004E)
  'Ο': 'O',  // Greek Omicron (U+039F) -> Latin O (U+004F)
  'Ρ': 'P',  // Greek Rho (U+03A1) -> Latin P (U+0050)
  'Τ': 'T',  // Greek Tau (U+03A4) -> Latin T (U+0054)
  'Υ': 'Y',  // Greek Upsilon (U+03A5) -> Latin Y (U+0059)
  'Χ': 'X',  // Greek Chi (U+03A7) -> Latin X (U+0058)
  'Ζ': 'Z',  // Greek Zeta (U+0396) -> Latin Z (U+005A)
};

/**
 * Detect if a string contains Greek letters that look like Latin letters.
 * Returns array of { position, greek, latin } for each confusable found.
 */
export function detectGreekConfusables(input: string): Array<{
  position: number;
  greek: string;
  latin: string;
}> {
  const results: Array<{ position: number; greek: string; latin: string }> = [];
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (GREEK_LATIN_CONFUSABLES[char]) {
      results.push({
        position: i,
        greek: char,
        latin: GREEK_LATIN_CONFUSABLES[char],
      });
    }
  }
  return results;
}

/**
 * Normalize a string by replacing Greek confusable characters with Latin equivalents.
 * This prevents the 'O' vs 'Ο' (Omicron) collision bug.
 */
export function normalizeToASCII(input: string): string {
  let result = '';
  for (const char of input) {
    result += GREEK_LATIN_CONFUSABLES[char] || char;
  }
  return result;
}

/**
 * Validate that a dimension string contains only ASCII characters.
 * Throws if Greek confusables are detected.
 */
export function validateDimensionASCII(dimension: string): void {
  const confusables = detectGreekConfusables(dimension);
  if (confusables.length > 0) {
    const details = confusables
      .map(c => `'${c.greek}' (Greek) at position ${c.position} should be '${c.latin}' (Latin)`)
      .join(', ');
    throw new Error(`Dimension contains Greek confusable characters: ${details}`);
  }
}

/**
 * Type guard to check if a string is a valid Dimension.
 */
export function isDimension(value: string): value is Dimension {
  return ALL_DIMENSIONS.includes(value as Dimension);
}

/**
 * Convert a legacy dimension symbol to the current dimension code.
 * Returns undefined if the symbol is not recognized.
 * Automatically normalizes Greek confusables to ASCII.
 */
export function normalizeDimension(symbol: string): Dimension | undefined {
  // First try direct lookup
  const direct = LEGACY_DIMENSION_MAP[symbol];
  if (direct) return direct;

  // Try after ASCII normalization
  const normalized = normalizeToASCII(symbol);
  return LEGACY_DIMENSION_MAP[normalized];
}

/**
 * Get all dimensions for a given cortical layer.
 */
export function getDimensionsForLayer(layer: CorticalLayer): Dimension[] {
  return LAYER_DIMENSIONS[layer];
}

/**
 * Get the cortical layer for a given dimension.
 */
export function getLayerForDimension(dimension: Dimension): CorticalLayer {
  return DIMENSION_LAYERS[dimension];
}

export type Severity = 'low' | 'medium' | 'high' | 'critical';

// NOTE: ConfidenceLevel is defined in the Common Types section above
// with conversion functions: confidenceToLevel(), levelToConfidence()

// ============================================================================
// Ontology Types - What exists
// ============================================================================

export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  description?: string;
  properties?: Record<string, PropertyDefinition>;
  relations?: EntityRelations;
  constraints?: EntityConstraints;
  location?: CodeLocation;
  provenance: Provenance;
}

export type EntityType =
  | 'domain-entity'
  | 'module'
  | 'service'
  | 'api-endpoint'
  | 'database-table'
  | 'architectural-pattern'
  | 'library'
  | 'type-definition';

export interface PropertyDefinition {
  type: string;
  required?: boolean;
  values?: string[];
  description?: string;
}

export interface EntityRelations {
  hasMany?: string[];
  belongsTo?: string[];
  references?: string[];
  implements?: string[];
  extends?: string[];
  uses?: string[];
  dependsOn?: string[];
  complementsWith?: string[];
  replaces?: string[];
}

export interface EntityConstraints {
  unique?: string[];
  required?: string[];
  validation?: Record<string, string>;
  businessRules?: string[];
  statusTransitions?: Record<string, string[]>;
  requiredBefore?: Record<string, string[]>;
  incompatible?: string[];
}

export interface Relation {
  id: string;
  type: RelationType;
  source: string;
  target: string;
  properties?: Record<string, any>;
  provenance: Provenance;
}

export type RelationType =
  | 'has-many'
  | 'belongs-to'
  | 'references'
  | 'implements'
  | 'extends'
  | 'uses'
  | 'depends-on'
  | 'one-to-many'
  | 'many-to-one'
  | 'many-to-many'
  | 'realization';

export interface Constraint {
  id: string;
  type: ConstraintType;
  entities: string[];
  rule: string;
  description?: string;
  provenance: Provenance;
}

export type ConstraintType =
  | 'unique'
  | 'required'
  | 'validation'
  | 'business-rule'
  | 'state-transition';

export interface Ontology {
  $schema: string;
  title: string;
  description: string;
  version: string;
  lastUpdated: string;
  entities: Record<string, Entity>;
  relations: Record<string, Relation>;
  constraints: Record<string, Constraint>;
  metadata: OntologyMetadata;
}

export interface OntologyMetadata {
  totalEntities: number;
  totalRelations: number;
  totalConstraints: number;
  averageConfidence: number;
  lastCompaction: string | null;
}

// ============================================================================
// Mereology Types - How parts compose
// ============================================================================

export interface Component {
  id: string;
  name: string;
  type: ComponentType;
  description?: string;
  location?: CodeLocation;
  dependencies?: string[];
  provenance: Provenance;
}

export type ComponentType =
  | 'module'
  | 'service'
  | 'controller'
  | 'repository'
  | 'middleware'
  | 'utility'
  | 'hook'
  | 'component'
  | 'route'
  | 'pattern-implementation'
  | 'system';

export interface Composition {
  id: string;
  name: string;
  type: ComponentType;
  description?: string;
  parts: CompositionParts;
  compositionType?: CompositionType;
  dependencies?: DependencyGraph;
  compositionRules?: CompositionRules;
  emergentProperties?: string[];
  provenance: Provenance;
}

export interface CompositionParts {
  core?: string[];
  supporting?: string[];
  infrastructure?: string[];
  backend?: string[];
  frontend?: string[];
  shared?: string[];
}

export type CompositionType =
  | 'aggregation'   // Parts can exist independently
  | 'composition'   // Parts cannot exist without whole
  | 'collection';   // Loose grouping

export interface DependencyGraph {
  internal?: Record<string, string[]>;
  external?: Record<string, string[]>;
}

export interface CompositionRules {
  sequence?: string[];
  cardinality?: Record<string, string | number>;
}

export interface SystemHierarchy {
  root: string | null;
  layers: Layer[];
  modules: Module[];
}

export interface Layer {
  name: string;
  level: number;
  components: string[];
}

export interface Module {
  id: string;
  name: string;
  path: string;
  components: string[];
  submodules?: string[];
}

export interface PartWholeRelation {
  type: string;
  description: string;
  examples: string[];
}

export interface Mereology {
  $schema: string;
  title: string;
  description: string;
  version: string;
  lastUpdated: string;
  components: Record<string, Component>;
  compositions: Record<string, Composition>;
  hierarchy: SystemHierarchy;
  partWholeRelations: Record<string, PartWholeRelation>;
  metadata: MereologyMetadata;
}

export interface MereologyMetadata {
  totalComponents: number;
  totalCompositions: number;
  totalParts: number;
  maxDepth: number;
  averageConfidence: number;
  lastCompaction: string | null;
}

// ============================================================================
// Epistemology Types - How we know
// ============================================================================

/**
 * Knowledge - A piece of verified information.
 *
 * Enhanced with FRESHNESS TRACKING per Claude 4 best practices:
 * Stale knowledge leads to incorrect assumptions and speculative actions.
 */
export interface Knowledge {
  id: string;
  concept: string;
  confidence: number;
  confidenceLevel?: ConfidenceLevel;
  confidenceHistory: ConfidencePoint[];
  basis: KnowledgeBasis;
  evidence: Evidence;
  sources: Source[];
  uncertainties?: Uncertainty[];
  contradictions?: Contradiction[];
  validations?: string[];
  reliability: Reliability;

  // === FRESHNESS TRACKING (NEW) ===

  /** When was this knowledge last verified to still be true? */
  lastVerified?: string;

  /** How was it verified? (grep, test, manual, etc.) */
  verificationMethod?: VerificationMethod;

  /** Specific evidence from last verification */
  verificationEvidence?: string;

  /** How many days before confidence starts decaying (default: 30) */
  freshnessHalfLifeDays?: number;

  /** Is this knowledge currently considered stale? (computed) */
  isStale?: boolean;
}

export type KnowledgeBasis =
  | 'empirical'     // Observed in code/behavior
  | 'inferred'      // Derived from patterns
  | 'documented'    // From comments/docs
  | 'validated'     // Tested/confirmed
  | 'assumed';      // Unverified belief

/**
 * How knowledge was verified to still be accurate.
 */
export type VerificationMethod =
  | 'grep'              // Code search confirmed it
  | 'test'              // Test suite passed
  | 'manual'            // Human confirmed it
  | 'runtime'           // Observed in running system
  | 'documentation'     // Docs still say this
  | 'commit-history'    // Git history confirms
  | 'static-analysis';  // Linter/type checker confirms

export interface ConfidencePoint {
  date: string;
  value: number;
  reason: string;
  source?: string;
}

export interface Evidence {
  observations: number;
  validations: number;
  contradictions: number;
  firstSeen: string;
  lastSeen: string;
}

export interface Source {
  type: 'session' | 'commit' | 'documentation' | 'external' | 'test';
  id: string;
  date: string;
  contribution?: string;
}

export interface Uncertainty {
  aspect: string;
  confidence: number;
  reason: string;
}

export interface Contradiction {
  observedAt: string;
  description: string;
  sessionId: string;
  resolved: boolean;
  resolution?: string;
}

export interface Reliability {
  status: 'speculative' | 'unreliable' | 'reliable' | 'highly_reliable';
  factors: {
    consistency: number;
    reproducibility: number;
    testability: number;
  };
}

/**
 * Pattern - A recognized recurring structure or behavior.
 *
 * Enhanced with FRESHNESS TRACKING and ANTI-EXAMPLES per Claude 4 best practices.
 */
export interface Pattern {
  id: string;
  name: string;
  description: string;
  type: PatternType;
  confidence: number;
  observations: number;
  examples: Example[];
  /** Anti-examples showing what NOT to do (per Claude 4 best practices) */
  antiExamples?: AntiExample[];
  context?: string;
  effectiveness?: number;
  provenance: Provenance;

  // === FRESHNESS TRACKING ===
  /** When was this pattern last observed/verified? */
  lastVerified?: string;
  /** Is this pattern still actively used? */
  isActive?: boolean;
}

/**
 * Anti-example showing what NOT to do.
 * Claude 4 learns well from both positive and negative examples.
 */
export interface AntiExample {
  scenario: string;
  badApproach: string;
  whyBad: string;
  betterApproach?: string;
}

export type PatternType =
  | 'architectural'
  | 'code-pattern'
  | 'workflow'
  | 'error-pattern'
  | 'usage-pattern'
  | 'development'
  | 'debugging'
  | 'collaboration';

export interface Validation {
  id: string;
  concept: string;
  validationType: ValidationType;
  successful: boolean;
  timestamp: string;
  evidence: ValidationEvidence;
}

export type ValidationType =
  | 'test-passed'
  | 'commit-successful'
  | 'pattern-repeated'
  | 'manual-verification'
  | 'production-success';

export interface ValidationEvidence {
  type: string;
  data: any;
  source: string;
}

export interface ConfidenceModel {
  scale: Record<string, ConfidenceLevel>;
  updateRules: Record<string, string>;
  bayesianParameters: {
    priorWeight: number;
    evidenceWeight: number;
    minObservations: number;
  };
}

export interface KnowledgeGap {
  concept: string;
  currentConfidence: number;
  reason: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  suggestedActions?: string[];
}

export interface Epistemology {
  $schema: string;
  title: string;
  description: string;
  version: string;
  lastUpdated: string;
  knowledge: Record<string, Knowledge>;
  patterns: Record<string, Pattern>;
  validations: Record<string, Validation>;
  confidenceModel: ConfidenceModel;
  knowledgeGaps: KnowledgeGap[];
  metadata: EpistemologyMetadata;
}

export interface EpistemologyMetadata {
  totalConcepts: number;
  totalPatterns: number;
  totalValidations: number;
  averageConfidence: number;
  highConfidenceConcepts: number;
  lowConfidenceConcepts: number;
  knowledgeGaps: number;
  lastValidation: string;
}

// ============================================================================
// Qualia Types - What it's like
// ============================================================================

export interface Experience {
  id: string;
  concept: string;
  description?: string;
  commonWorkflow?: string[];
  painPoints: PainPoint[];
  bestPractices: BestPractice[];
  solutions?: Solution[];
  debuggingTips?: string[];
  contextualCues?: string[];
  tacitKnowledge?: string[];
  emotionalContext?: EmotionalContext;
  cognitiveLoad?: CognitiveLoad;
  provenance: {
    sources: string[];
    lastUpdated: string;
  };
}

export interface PainPoint {
  id: string;
  concept?: string;
  issue: string;
  description?: string;
  frequency: 'rare' | 'uncommon' | 'common' | 'very_common';
  severity: Severity;
  consequence?: string;
  context?: string;
  firstEncountered: string;
  lastEncountered?: string;
  occurrences: number;
  relatedErrors?: ErrorReference[];
  solutions?: string[];
  provenance: Provenance;
}

export interface ErrorReference {
  message: string;
  stackTrace?: string;
  sessionId: string;
  timestamp?: string;
}

export interface Solution {
  id: string;
  problem: string;
  approach: string;
  reason?: string;
  effectiveness: number;
  context: Context;
  examples: Example[];
  provenance: Provenance;
}

export interface BestPractice {
  id: string;
  concept: string;
  practice: string;
  reason: string;
  context: string;
  confidence: number;
  examples?: Example[];
  provenance: Provenance;
}

export interface EmotionalContext {
  initialComplexity: 'low' | 'medium' | 'high' | 'very_high';
  learningCurve?: string;
  satisfaction?: string;
  frustrationPoints?: string[];
  confidence?: string;
}

export interface CognitiveLoad {
  initial: string;
  afterLearning: string;
  commonConfusion: string[];
  masteryIndicators: string[];
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  successRate: number;
  context: Context;
  observations: number;
  provenance: Provenance;
}

export interface WorkflowStep {
  order: number;
  action: string;
  toolsUsed?: string[];
  commonIssues?: string[];
  duration?: string;
}

export interface ContextualKnowledge {
  id: string;
  concept: string;
  context: {
    why?: string;
    when?: string;
    how?: string;
    gotchas?: string[];
  };
  provenance: Provenance;
}

export interface Context {
  taskType?: string;
  fileTypes?: string[];
  modules?: string[];
  relatedConcepts?: string[];
}

export interface Qualia {
  $schema: string;
  title: string;
  description: string;
  version: string;
  lastUpdated: string;
  experiences: Record<string, Experience>;
  painPoints: Record<string, PainPoint>;
  solutions: Record<string, Solution>;
  workflows: Record<string, Workflow>;
  bestPractices: Record<string, BestPractice>;
  contextualKnowledge: Record<string, ContextualKnowledge>;
  patterns: {
    development: Pattern[];
    debugging: Pattern[];
    collaboration: Pattern[];
  };
  cognitiveLoad: Record<string, CognitiveLoad>;
  metadata: QualiaMetadata;
}

export interface QualiaMetadata {
  totalExperiences: number;
  totalPainPoints: number;
  totalSolutions: number;
  totalWorkflows: number;
  totalBestPractices: number;
  totalPatterns: number;
  lastUpdated: string;
}

// ============================================================================
// Unified Knowledge Types
// ============================================================================

/**
 * WeaveKnowledge represents the complete 17D knowledge base.
 *
 * Layer 1 (Substrate): ontology, mereology, history
 * Layer 2 (Logic): epistemology, causation, deontics, praxeology, teleology, axiology, modality
 * Layer 3 (Interface): qualia, psyche, oikonomia, semiotics, kairos, hyposchesin, anamnesis
 *
 * Original 4D dimensions are required for backward compatibility.
 * Extended dimensions are optional until the codebase is fully migrated.
 */
export interface WeaveKnowledge {
  // Layer 1 - Substrate (required)
  ontology: Ontology;
  mereology: Mereology;
  history?: History;

  // Layer 2 - Logic
  epistemology: Epistemology;
  causation?: Causation;
  deontics?: Deontics;
  praxeology?: Praxeology;
  teleology?: Teleology;
  axiology?: Axiology;
  modality?: Modality;

  // Layer 3 - Interface
  qualia: Qualia;
  psyche?: Psyche;
  oikonomia?: Oikonomia;
  semiotics?: Semiotics;
  kairos?: Kairos;
  hyposchesin?: Hyposchesin;
  anamnesis?: Anamnesis;
}

/**
 * Full 17D knowledge type where all dimensions are required.
 * Used for operations that require complete knowledge coverage.
 */
export interface FullWeaveKnowledge {
  // Layer 1 - Substrate
  ontology: Ontology;
  mereology: Mereology;
  history: History;

  // Layer 2 - Logic
  epistemology: Epistemology;
  causation: Causation;
  deontics: Deontics;
  praxeology: Praxeology;
  teleology: Teleology;
  axiology: Axiology;
  modality: Modality;

  // Layer 3 - Interface
  qualia: Qualia;
  psyche: Psyche;
  oikonomia: Oikonomia;
  semiotics: Semiotics;
  kairos: Kairos;
  hyposchesin: Hyposchesin;
  anamnesis: Anamnesis;
}

// Forward declarations for Layer 2 dimensions not yet fully defined in this file
// These will be expanded as the architecture matures
export interface History {
  $schema: string;
  title: string;
  description: string;
  version: string;
  lastUpdated: string;
  evolutions: Record<string, any>;
  timelines: Record<string, any>;
  legacyPatterns: Record<string, any>;
  metadata: HistoryMetadata;
}

export interface HistoryMetadata {
  totalEvolutions: number;
  totalTimelines: number;
  totalLegacyPatterns: number;
  oldestEntry: string | null;
  newestEntry: string | null;
}

export interface Causation {
  $schema: string;
  title: string;
  description: string;
  version: string;
  lastUpdated: string;
  causalChains: Record<string, any>;
  rootCauses: Record<string, any>;
  mechanisms: Record<string, any>;
  metadata: CausationMetadata;
}

export interface CausationMetadata {
  totalCausalChains: number;
  totalRootCauses: number;
  totalMechanisms: number;
  averageConfidence: number;
}

/**
 * Deontics (Δ) - What must/can/cannot be done
 *
 * Enhanced with RATIONALE ENFORCEMENT per Claude 4 best practices:
 * Rules without reasons are forgotten and worked around.
 */
export interface Deontics {
  $schema: string;
  title: string;
  description: string;
  version: string;
  lastUpdated: string;
  obligations: Record<string, Obligation>;
  permissions: Record<string, Permission>;
  prohibitions: Record<string, Prohibition>;
  metadata: DeonticsMetadata;
}

/**
 * Obligation - Something that MUST be done.
 * Rationale is REQUIRED to explain WHY this obligation exists.
 */
export interface Obligation {
  id: string;
  type: 'obligation';
  description: string;
  /** REQUIRED: Why does this obligation exist? What happens if violated? */
  rationale: string;
  /** Scope where this applies (e.g., "all commits", "feature work") */
  scope: string;
  /** How to verify compliance */
  enforcement?: string;
  /** What constitutes a violation */
  violations?: string;
  /** Confidence in this obligation (0-1) */
  confidence: number;
  /** Evidence supporting this obligation */
  evidence?: string[];
  /** Link to related knowledge (e.g., "causation:untested-code-breaks-trust") */
  linkedKnowledge?: string[];
}

/**
 * Permission - Something that MAY be done under certain conditions.
 * Rationale explains WHEN and WHY this permission makes sense.
 */
export interface Permission {
  id: string;
  type: 'permission';
  description: string;
  /** REQUIRED: Why is this permitted? What value does it provide? */
  rationale: string;
  /** Scope where this applies */
  scope: string;
  /** Conditions that must be true for permission to apply */
  conditions?: string;
  /** Confidence in this permission (0-1) */
  confidence: number;
  /** Evidence supporting this permission */
  evidence?: string[];
}

/**
 * Prohibition - Something that MUST NOT be done.
 * Rationale is REQUIRED to explain the CONSEQUENCE of violation.
 */
export interface Prohibition {
  id: string;
  type: 'prohibition';
  description: string;
  /** REQUIRED: Why is this prohibited? What bad thing happens if done? */
  rationale: string;
  /** Scope where this applies */
  scope: string;
  /** What to do instead */
  alternatives?: string;
  /** Exceptions when this prohibition doesn't apply */
  exceptions?: string[];
  /** Confidence in this prohibition (0-1) */
  confidence: number;
  /** Evidence supporting this prohibition */
  evidence?: string[];
}

export interface DeonticsMetadata {
  totalObligations: number;
  totalPermissions: number;
  totalProhibitions: number;
  averageConfidence: number;
}

export interface Praxeology {
  $schema: string;
  title: string;
  description: string;
  version: string;
  lastUpdated: string;
  wowPatterns: Record<string, any>;
  delegationStrategies: Record<string, any>;
  bestPractices: Record<string, any>;
  metadata: PraxeologyMetadata;
}

export interface PraxeologyMetadata {
  totalWowPatterns: number;
  totalDelegationStrategies: number;
  totalBestPractices: number;
  averageEffectiveness: number;
}

export interface Teleology {
  $schema: string;
  title: string;
  description: string;
  version: string;
  lastUpdated: string;
  purposes: Record<string, any>;
  goals: Record<string, any>;
  intents: Record<string, any>;
  metadata: TeleologyMetadata;
}

export interface TeleologyMetadata {
  totalPurposes: number;
  totalGoals: number;
  totalIntents: number;
  averageConfidence: number;
}

export interface Axiology {
  $schema: string;
  title: string;
  description: string;
  version: string;
  lastUpdated: string;
  valueJudgments: Record<string, any>;
  tradeoffs: Record<string, any>;
  qualityMetrics: Record<string, any>;
  metadata: AxiologyMetadata;
}

export interface AxiologyMetadata {
  totalValueJudgments: number;
  totalTradeoffs: number;
  totalQualityMetrics: number;
  averageConfidence: number;
}

/**
 * Modality (Μ) - What could be: alternatives, possibilities, counterfactuals
 *
 * Enhanced with DECISION STATUS per Claude 4 best practices:
 * Know when to stop exploring options and take action.
 */
export interface Modality {
  $schema: string;
  title: string;
  description: string;
  version: string;
  lastUpdated: string;
  alternatives: Record<string, Alternative>;
  rejectedOptions: Record<string, RejectedOption>;
  possibleFutures: Record<string, PossibleFuture>;
  metadata: ModalityMetadata;
}

/**
 * Alternative - A choice point with multiple valid approaches.
 *
 * The decisionStatus field prevents endless option exploration:
 * - 'exploring': Still gathering options, don't act yet
 * - 'decided': Choice made, take action
 * - 'blocked': Can't decide, need input
 */
export interface Alternative {
  id: string;
  description: string;
  options: AlternativeOption[];
  /** Current status of this decision */
  decisionStatus: 'exploring' | 'decided' | 'blocked';
  /** Which option was chosen (if decided) */
  chosen?: string;
  /** Why this option was chosen */
  decisionRationale?: string;
  /** Under what conditions to reconsider */
  reopenIf?: string;
  /** When was this decision made */
  decidedAt?: string;
  confidence: number;
  evidence?: string[];
}

export interface AlternativeOption {
  id: string;
  name: string;
  description: string;
  pros: string[];
  cons: string[];
  /** Estimated fit for the use case (0-1) */
  fit?: number;
}

/**
 * RejectedOption - An approach that was considered and dismissed.
 * Important for avoiding repeated evaluation of bad options.
 */
export interface RejectedOption {
  id: string;
  description: string;
  /** Why was this rejected? */
  rejectionReason: string;
  /** What was chosen instead */
  chosenAlternative?: string;
  /** When might this become viable again */
  reconsiderWhen?: string;
  confidence: number;
  evidence?: string[];
}

/**
 * PossibleFuture - A speculative future state or capability.
 * Use sparingly to avoid premature abstraction.
 */
export interface PossibleFuture {
  id: string;
  description: string;
  /** Likelihood this will be needed (0-1) */
  likelihood: number;
  /** When might this become relevant */
  timeframe?: string;
  /** What triggers building this */
  trigger?: string;
  /** Should we build for this now? */
  buildNow: boolean;
  /** Why or why not */
  rationale: string;
  confidence: number;
}

export interface ModalityMetadata {
  totalAlternatives: number;
  totalRejectedOptions: number;
  totalPossibleFutures: number;
  averageConfidence: number;
  /** How many decisions are still in 'exploring' state */
  pendingDecisions?: number;
}

export interface ConceptReference {
  conceptId: string;
  dimensions: Dimension[];
  confidence: number;
}

export interface KnowledgeQuery {
  concept?: string;
  dimensions: Dimension[];
  minConfidence?: number;
  depth?: 'shallow' | 'medium' | 'deep';
  scope?: 'local' | 'organization' | 'local+organization';
}

export interface KnowledgeUpdate {
  dimension: Dimension;
  operation: 'add' | 'update' | 'merge' | 'remove';
  data: any;
  provenance: Provenance;
}

// ============================================================================
// Session Types (for knowledge extraction)
// ============================================================================

export interface Session {
  id: string;
  startedAt: string;
  endedAt: string;
  filesChanged?: string[];
  toolUses?: ToolUse[];
  errors?: ErrorEvent[];
  fixes?: Fix[];
  commit?: CommitInfo;
  patterns?: RecognizedPattern[];
}

export interface ToolUse {
  tool: string;
  parameters: any;
  result: any;
  timestamp: string;
}

export interface ErrorEvent {
  message: string;
  stackTrace?: string;
  severity: Severity;
  relatedTo?: string;
  timestamp?: string;
}

export interface Fix {
  resolvedError: string;
  approach: string;
  resolved: boolean;
  changedFiles: string[];
}

export interface CommitInfo {
  sha: string;
  message: string;
  files: string[];
  timestamp: string;
  successful: boolean;
}

export interface RecognizedPattern {
  id: string;
  matchQuality: number;
  context: any;
}

// ============================================================================
// Self-Awareness Types
// ============================================================================

export interface SelfAwareness {
  coverage: {
    ontology: number;
    mereology: number;
    epistemology: number;
    qualia: number;
  };
  confidence: {
    average: number;
    high: number;
    medium: number;
    low: number;
    distribution: Record<ConfidenceLevel, number>;
  };
  gaps: KnowledgeGap[];
  health: KnowledgeHealth;
}

export interface KnowledgeHealth {
  status: 'nascent' | 'developing' | 'good' | 'excellent';
  ontologyCoverage: number;
  epistemicConfidence: number;
  qualiaDepth: number;
  recommendations?: string[];
}

// ============================================================================
// Psyche Types (Psi) - User Model
// ============================================================================

/**
 * Psyche represents the user model dimension, capturing understanding of the
 * human collaborator including expertise levels, preferences, and session state.
 *
 * Layer: Interface (adaptive, session + persistent split)
 * Symbol: Psi
 * Purpose: Enable contextually-aware collaboration by modeling the user
 */

export type ExpertiseLevel = 'novice' | 'intermediate' | 'advanced' | 'expert';
export type PreferredMode = 'executor' | 'collaborator' | 'navigator';
export type Verbosity = 'terse' | 'normal' | 'verbose';

// NOTE: UserMood type removed intentionally. Mood inference was:
// - Unreliable (punctuation usage is culturally variable)
// - Uncorrectable (user can't fix wrong inferences they don't see)
// - Risk of sycophancy amplification

export interface VolatileState {
  /** What the user is currently working on */
  currentFocus?: string;
  /** When this session started */
  sessionStart: string;
  /** Timestamp of last activity */
  lastActivity?: string;
  /** Current task context */
  taskContext?: string;
}

export interface UserProfile {
  id: string;
  /** Whether this profile applies globally or per-project */
  scope: 'global' | 'project';
  /** Project path if scope is 'project' */
  projectId?: string;
  /** User's expertise level in this context */
  expertise: ExpertiseLevel;
  /** Domain-specific expertise levels */
  domainExpertise?: Record<string, ExpertiseLevel>;
  /** How the user prefers to interact */
  preferredMode: PreferredMode;
  /** How much detail the user wants */
  verbosity: Verbosity;
  /** Communication style preferences */
  communicationStyle?: {
    formality: 'casual' | 'professional' | 'technical';
    explanationDepth: 'minimal' | 'standard' | 'detailed';
    codeCommentLevel: 'none' | 'sparse' | 'thorough';
  };
  /** Number of Bayesian evidence observations */
  observations: number;
  /** Confidence in this profile */
  confidence: number;
  /** Last time this profile was updated */
  lastUpdated: string;
  /** Provenance of profile data */
  provenance: Provenance;
}

export interface Psyche {
  $schema: string;
  title: string;
  description: string;
  version: string;
  lastUpdated: string;

  /** Volatile buffer - session-scoped, resets on session end */
  volatileState: VolatileState;

  /** Persistent profiles - Bayesian accumulation, slow update */
  profiles: Record<string, UserProfile>;

  /** Half-life configuration for decay */
  halfLifeConfig: {
    volatileHalfLife: number;  // milliseconds (default: 1 hour = 3600000)
    persistentHalfLife: number;  // milliseconds (default: 30 days = 2592000000)
  };

  metadata: PsycheMetadata;
}

export interface PsycheMetadata {
  totalProfiles: number;
  globalProfile: string | null;
  projectProfiles: number;
  averageConfidence: number;
  lastSessionStart: string | null;
  sessionsTracked: number;
}

// ============================================================================
// Oikonomia Types (Oi) - Resource Economy
// ============================================================================

/**
 * Oikonomia represents the resource economy dimension, tracking token usage,
 * API costs, context window utilization, and metabolic rules for efficiency.
 *
 * Layer: Interface (adaptive, real-time resource awareness)
 * Symbol: Oi
 * Purpose: Enable cost-aware and resource-efficient operation
 */

export interface CurrentSession {
  /** Total token budget for this session */
  tokenBudget: number;
  /** Tokens consumed so far */
  tokensUsed: number;
  /** Maximum context window size */
  contextWindow: number;
  /** Context tokens currently in use */
  contextUsed: number;
  /** Accumulated API costs ($) */
  apiCosts: number;
  /** Session start time */
  startTime: string;
  /** Input tokens used */
  inputTokens?: number;
  /** Output tokens used */
  outputTokens?: number;
  /** Cache read tokens */
  cacheReadTokens?: number;
  /** Cache write tokens */
  cacheWriteTokens?: number;
}

export interface ResourcePattern {
  /** Type of task this pattern applies to */
  taskType: string;
  /** Average tokens consumed for this task type */
  avgTokens: number;
  /** Average duration in milliseconds */
  avgDuration: number;
  /** Average cost in dollars */
  avgCost: number;
  /** Number of observations */
  observations: number;
  /** Minimum observed values */
  min?: { tokens: number; duration: number; cost: number };
  /** Maximum observed values */
  max?: { tokens: number; duration: number; cost: number };
  /** Last updated timestamp */
  lastUpdated: string;
}

export type MetabolicAction = 'compress' | 'delegate' | 'summarize' | 'warn' | 'pause';

export interface MetabolicRule {
  id: string;
  /** Condition expression (e.g., "context > 80%", "tokens > 50000") */
  condition: string;
  /** Action to take when condition is met */
  action: MetabolicAction;
  /** Priority (higher = more important) */
  priority: number;
  /** Whether this rule is currently active */
  enabled: boolean;
  /** Description of what this rule does */
  description?: string;
}

export interface CostRecord {
  id: string;
  sessionId: string;
  timestamp: string;
  taskType: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalCost: number;
  duration: number;
}

export interface Oikonomia {
  $schema: string;
  title: string;
  description: string;
  version: string;
  lastUpdated: string;

  /** Current session resource state */
  currentSession: CurrentSession;

  /** Historical resource patterns by task type */
  patterns: Record<string, ResourcePattern>;

  /** Metabolic rules for efficiency management */
  rules: MetabolicRule[];

  /** Historical cost records */
  costHistory: CostRecord[];

  /** Budget limits and alerts */
  budgets: {
    dailyLimit?: number;
    sessionLimit?: number;
    alertThreshold?: number;
  };

  metadata: OikonomiaMetadata;
}

export interface OikonomiaMetadata {
  totalSessions: number;
  totalTokensUsed: number;
  totalCost: number;
  avgTokensPerSession: number;
  avgCostPerSession: number;
  patternsTracked: number;
  rulesActive: number;
}

// ============================================================================
// Semiotics Types (Si) - Meaning Layer
// ============================================================================

/**
 * Semiotics represents the meaning layer dimension, capturing team dialects,
 * term definitions, semantic disambiguation, and communication conventions.
 *
 * Layer: Interface (adaptive, project-specific language understanding)
 * Symbol: Si
 * Purpose: Enable accurate interpretation of project-specific terminology
 */

export interface TermContext {
  /** The context where this meaning applies (e.g., "auth", "billing", "domain") */
  context: string;
  /** What the term means in this context */
  meaning: string;
  /** Examples of usage */
  examples: string[];
  /** Related terms in this context */
  relatedTerms: string[];
  /** Confidence in this interpretation */
  confidence: number;
}

export interface TermDefinition {
  /** The term being defined */
  term: string;
  /** Different meanings in different contexts */
  contexts: TermContext[];
  /** Default context when ambiguous */
  defaultContext?: string;
  /** Whether this term is domain-specific */
  isDomainSpecific: boolean;
  /** Provenance of this definition */
  provenance: Provenance;
}

export interface Disambiguation {
  /** The ambiguous term */
  term: string;
  /** What triggers this disambiguation */
  trigger: string;
  /** How to resolve the ambiguity */
  resolution: string;
  /** Confidence in this resolution */
  confidence: number;
  /** When this was last used */
  lastUsed?: string;
  /** Number of times applied */
  timesApplied: number;
}

export interface Dialect {
  /** Project/team abbreviations */
  abbreviations: Record<string, string>;
  /** Team idioms and their meanings */
  idioms: Record<string, string>;
  /** Naming conventions */
  conventions: string[];
  /** Code style preferences */
  codeStyle?: {
    namingPattern?: string;
    commentStyle?: string;
    fileNaming?: string;
  };
}

export interface Semiotics {
  $schema: string;
  title: string;
  description: string;
  version: string;
  lastUpdated: string;

  /** Term definitions with context-aware meanings */
  terms: Record<string, TermDefinition>;

  /** Disambiguation rules for ambiguous terms */
  disambiguations: Record<string, Disambiguation>;

  /** Team/project dialect patterns */
  dialect: Dialect;

  /** Semantic relationships between terms */
  relationships: {
    synonyms: Record<string, string[]>;
    antonyms: Record<string, string[]>;
    hypernyms: Record<string, string>;  // broader terms
    hyponyms: Record<string, string[]>; // narrower terms
  };

  metadata: SemioticsMetadata;
}

export interface SemioticsMetadata {
  totalTerms: number;
  totalDisambiguations: number;
  abbreviationsCount: number;
  idiomsCount: number;
  conventionsCount: number;
  averageConfidence: number;
}

// ============================================================================
// Kairos Types (Ka) - Opportune Moment
// ============================================================================

/**
 * Kairos represents the opportune moment dimension, managing when to surface
 * observations, proactivity throttling, and context-sensitive timing.
 *
 * Layer: Interface (adaptive, timing and context awareness)
 * Symbol: Ka
 * Purpose: Know when to speak and when to stay quiet
 */

export type ObservationType = 'concern' | 'suggestion' | 'pattern' | 'debt' | 'optimization' | 'security';
export type Urgency = 'low' | 'medium' | 'high' | 'critical';
export type ProactivityLevel = 'passive' | 'moderate' | 'proactive';

export interface KairosObservation {
  id: string;
  /** Type of observation */
  type: ObservationType;
  /** The observation content */
  content: string;
  /** How urgent is this */
  urgency: Urgency;
  /** Context where this was observed */
  context: string;
  /** When this was observed */
  createdAt: string;
  /** Conditions for surfacing this observation */
  surfaceWhen: string[];
  /** Has this been surfaced yet */
  surfaced: boolean;
  /** When it was surfaced */
  surfacedAt?: string;
  /** Whether user found it helpful */
  wasHelpful?: boolean;
  /** Expiry time (after which discard) */
  expiresAt?: string;
}

export interface TimingRule {
  id: string;
  /** Condition for this rule */
  condition: string;
  /** Action: surface now, defer, or discard */
  action: 'surface' | 'defer' | 'discard';
  /** Why this rule exists */
  reason: string;
  /** Priority (higher = apply first) */
  priority: number;
  /** Is this rule active */
  enabled: boolean;
}

export interface ProactivityConfig {
  /** Overall proactivity level */
  level: ProactivityLevel;
  /** Minimum time between unsolicited suggestions (ms) */
  cooldown: number;
  /** Last time a suggestion was made */
  lastSuggestion?: string;
  /** How many suggestions made this session */
  suggestionCount: number;
  /** User feedback on suggestions */
  feedbackHistory: {
    helpful: number;
    unhelpful: number;
    ignored: number;
  };
}

export interface Kairos {
  $schema: string;
  title: string;
  description: string;
  version: string;
  lastUpdated: string;

  /** Pending observations waiting to be surfaced */
  pendingObservations: KairosObservation[];

  /** Surfaced observations (historical) */
  surfacedObservations: KairosObservation[];

  /** Rules for when to surface observations */
  timingRules: TimingRule[];

  /** Structured triggers for automatic knowledge surfacing */
  triggers: KairosTrigger[];

  /** Proactivity configuration */
  proactivity: ProactivityConfig;

  /** Focus state tracking */
  focusState: {
    currentFocus?: string;
    focusStarted?: string;
    interruptionCount: number;
    lastInterruption?: string;
  };

  metadata: KairosMetadata;
}

export interface KairosMetadata {
  pendingCount: number;
  surfacedCount: number;
  rulesCount: number;
  triggersCount: number;
  activeTriggers: number;
  avgHelpfulness: number;
  interruptionRate: number;
  lastSuggestion: string | null;
}

// ============================================================================
// Kairos Trigger Types - Structured Surfacing Conditions
// ============================================================================

/**
 * Trigger categories for automatic knowledge surfacing.
 * These are the "when" conditions for Kairos to activate.
 */
export type TriggerCategory =
  | 'file_context'      // User opens/edits specific file(s)
  | 'concept_mention'   // User mentions specific concept/keyword
  | 'error_encounter'   // Error or failure occurs
  | 'pattern_match'     // Code/conversation matches a pattern
  | 'time_based'        // Time/duration based triggers
  | 'workflow_stage'    // User reaches a workflow stage
  | 'repetition'        // User repeats similar actions/questions
  | 'dependency';       // External dependency conditions

/**
 * Operators for trigger conditions.
 */
export type TriggerOperator =
  | 'equals'
  | 'contains'
  | 'matches'      // Regex
  | 'startsWith'
  | 'endsWith'
  | 'greaterThan'
  | 'lessThan'
  | 'inList';

/**
 * Base trigger condition structure.
 */
export interface TriggerCondition {
  /** Category of this trigger */
  category: TriggerCategory;
  /** The field/property to check */
  field: string;
  /** Comparison operator */
  operator: TriggerOperator;
  /** Value to compare against */
  value: string | number | string[];
  /** Whether the condition is negated */
  negate?: boolean;
}

/**
 * Composite trigger combining multiple conditions.
 */
export interface CompositeTrigger {
  /** Logical operator to combine conditions */
  logic: 'AND' | 'OR';
  /** Sub-conditions */
  conditions: (TriggerCondition | CompositeTrigger)[];
}

/**
 * File context trigger - fires when user interacts with specific files.
 */
export interface FileContextTrigger extends TriggerCondition {
  category: 'file_context';
  field: 'path' | 'extension' | 'directory' | 'filename';
}

/**
 * Concept mention trigger - fires when specific concepts are mentioned.
 */
export interface ConceptMentionTrigger extends TriggerCondition {
  category: 'concept_mention';
  field: 'keyword' | 'entity' | 'topic';
  /** Case sensitivity (default: false) */
  caseSensitive?: boolean;
}

/**
 * Error encounter trigger - fires on errors matching criteria.
 */
export interface ErrorEncounterTrigger extends TriggerCondition {
  category: 'error_encounter';
  field: 'type' | 'message' | 'code' | 'stack';
}

/**
 * Time-based trigger - fires based on timing conditions.
 */
export interface TimeBasedTrigger extends TriggerCondition {
  category: 'time_based';
  field: 'sessionDuration' | 'idleTime' | 'lastActivity' | 'dayOfWeek' | 'timeOfDay';
}

/**
 * Workflow stage trigger - fires when user reaches a workflow stage.
 */
export interface WorkflowStageTrigger extends TriggerCondition {
  category: 'workflow_stage';
  field: 'stage' | 'taskType' | 'phase';
  /** Known workflow stages */
  value: 'planning' | 'implementing' | 'testing' | 'debugging' | 'reviewing' | 'deploying' | string;
}

/**
 * Repetition trigger - fires when user repeats actions.
 */
export interface RepetitionTrigger extends TriggerCondition {
  category: 'repetition';
  field: 'action' | 'query' | 'pattern';
  /** Number of repetitions to trigger on */
  threshold: number;
  /** Time window in milliseconds */
  windowMs: number;
}

/**
 * A complete trigger definition with metadata.
 */
export interface KairosTrigger {
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what this trigger does */
  description?: string;
  /** The trigger condition (simple or composite) */
  condition: TriggerCondition | CompositeTrigger;
  /** What knowledge to surface when triggered */
  surfaceKnowledge: {
    /** Dimensions to query */
    dimensions: Dimension[];
    /** Query keywords */
    keywords?: string[];
    /** Minimum confidence */
    minConfidence?: Confidence | number;
    /** Maximum items to surface */
    maxItems?: number;
  };
  /** Priority for conflict resolution (higher = higher priority) */
  priority: number;
  /** Cooldown in milliseconds before re-triggering */
  cooldownMs: number;
  /** Last time this trigger fired */
  lastFired?: string;
  /** Number of times this trigger has fired */
  fireCount: number;
  /** Is this trigger currently enabled */
  enabled: boolean;
  /** Optional expiry time */
  expiresAt?: string;
  /** Provenance for tracking */
  provenance?: Provenance;
}

/**
 * Type guard to check if a trigger is composite.
 */
export function isCompositeTrigger(trigger: TriggerCondition | CompositeTrigger): trigger is CompositeTrigger {
  return 'logic' in trigger && 'conditions' in trigger;
}

/**
 * Evaluate a trigger condition against a context.
 */
export function evaluateTriggerCondition(
  condition: TriggerCondition,
  context: Record<string, unknown>
): boolean {
  const fieldValue = context[condition.field];
  let result: boolean;

  switch (condition.operator) {
    case 'equals':
      result = fieldValue === condition.value;
      break;
    case 'contains':
      result = typeof fieldValue === 'string' && typeof condition.value === 'string'
        ? fieldValue.includes(condition.value)
        : false;
      break;
    case 'matches':
      result = typeof fieldValue === 'string' && typeof condition.value === 'string'
        ? new RegExp(condition.value).test(fieldValue)
        : false;
      break;
    case 'startsWith':
      result = typeof fieldValue === 'string' && typeof condition.value === 'string'
        ? fieldValue.startsWith(condition.value)
        : false;
      break;
    case 'endsWith':
      result = typeof fieldValue === 'string' && typeof condition.value === 'string'
        ? fieldValue.endsWith(condition.value)
        : false;
      break;
    case 'greaterThan':
      result = typeof fieldValue === 'number' && typeof condition.value === 'number'
        ? fieldValue > condition.value
        : false;
      break;
    case 'lessThan':
      result = typeof fieldValue === 'number' && typeof condition.value === 'number'
        ? fieldValue < condition.value
        : false;
      break;
    case 'inList':
      result = Array.isArray(condition.value)
        ? condition.value.includes(fieldValue as string)
        : false;
      break;
    default:
      result = false;
  }

  return condition.negate ? !result : result;
}

/**
 * Evaluate a composite trigger (recursive).
 */
export function evaluateCompositeTrigger(
  trigger: CompositeTrigger,
  context: Record<string, unknown>
): boolean {
  const results: boolean[] = [];

  for (const cond of trigger.conditions) {
    if (isCompositeTrigger(cond)) {
      results.push(evaluateCompositeTrigger(cond, context));
    } else {
      results.push(evaluateTriggerCondition(cond, context));
    }
  }

  return trigger.logic === 'AND'
    ? results.every(r => r)
    : results.some(r => r);
}

/**
 * Evaluate any trigger (simple or composite).
 */
export function evaluateTrigger(
  trigger: TriggerCondition | CompositeTrigger,
  context: Record<string, unknown>
): boolean {
  if (isCompositeTrigger(trigger)) {
    return evaluateCompositeTrigger(trigger, context);
  }
  return evaluateTriggerCondition(trigger, context);
}

/**
 * Create a simple file context trigger.
 */
export function createFileContextTrigger(
  name: string,
  pathPattern: string,
  options: { operator?: TriggerOperator; negate?: boolean } = {}
): KairosTrigger {
  return {
    id: `trigger-file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    condition: {
      category: 'file_context',
      field: 'path',
      operator: options.operator || 'matches',
      value: pathPattern,
      negate: options.negate,
    },
    surfaceKnowledge: {
      dimensions: ['Q', 'E', 'O'],
      maxItems: 5,
    },
    priority: 50,
    cooldownMs: 60000, // 1 minute default
    fireCount: 0,
    enabled: true,
  };
}

/**
 * Create a concept mention trigger.
 */
export function createConceptTrigger(
  name: string,
  keywords: string[],
  dimensions: Dimension[] = ['E', 'O', 'Q']
): KairosTrigger {
  return {
    id: `trigger-concept-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    condition: {
      logic: 'OR',
      conditions: keywords.map(keyword => ({
        category: 'concept_mention' as const,
        field: 'keyword',
        operator: 'contains' as const,
        value: keyword,
      })),
    },
    surfaceKnowledge: {
      dimensions,
      keywords,
      maxItems: 3,
    },
    priority: 40,
    cooldownMs: 30000, // 30 seconds
    fireCount: 0,
    enabled: true,
  };
}

/**
 * Create an error encounter trigger.
 */
export function createErrorTrigger(
  name: string,
  errorPattern: string
): KairosTrigger {
  return {
    id: `trigger-error-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    condition: {
      category: 'error_encounter',
      field: 'message',
      operator: 'matches',
      value: errorPattern,
    },
    surfaceKnowledge: {
      dimensions: ['Q', 'C', 'E'], // Qualia (solutions), Causation (root causes), Epistemology
      maxItems: 5,
    },
    priority: 80, // High priority for errors
    cooldownMs: 10000, // 10 seconds
    fireCount: 0,
    enabled: true,
  };
}

// ============================================================================
// Hyposchesin Types (Hy) - Commitments
// ============================================================================

/**
 * Hyposchesin represents the commitments dimension, tracking promises made,
 * deferred work, implicit contracts, and follow-up items.
 *
 * Layer: Interface (adaptive, promise and obligation tracking)
 * Symbol: Hy
 * Purpose: Never forget what was promised or left unfinished
 */

export type CommitmentType = 'promise' | 'todo' | 'followup' | 'acknowledgment';
export type CommitmentStatus = 'pending' | 'in_progress' | 'completed' | 'abandoned' | 'blocked';
export type WorkPriority = 'low' | 'medium' | 'high' | 'critical';

export interface Commitment {
  id: string;
  /** Type of commitment */
  type: CommitmentType;
  /** What was committed to */
  description: string;
  /** When the commitment was made */
  madeAt: string;
  /** Deadline if any */
  dueBy?: string;
  /** Current status */
  status: CommitmentStatus;
  /** Context in which commitment was made */
  context: string;
  /** Session where commitment was made */
  sessionId: string;
  /** Who/what made this commitment */
  madeBy: 'user' | 'assistant' | 'system';
  /** Related file or entity */
  relatedTo?: string;
  /** Notes on progress */
  notes?: string[];
  /** When status last changed */
  lastStatusChange?: string;
}

export interface DeferredWork {
  id: string;
  /** What work was deferred */
  description: string;
  /** Why it was deferred */
  reason: string;
  /** Priority level */
  priority: WorkPriority;
  /** When it was deferred */
  createdAt: string;
  /** When to remind about this */
  remindAfter?: string;
  /** Context for the deferred work */
  context: string;
  /** Related files or entities */
  relatedFiles?: string[];
  /** Has this been addressed */
  resolved: boolean;
  /** When it was resolved */
  resolvedAt?: string;
  /** How it was resolved */
  resolution?: string;
}

export interface ImplicitContract {
  id: string;
  /** What the contract is about */
  description: string;
  /** Scope of the work (e.g., "refactoring auth module") */
  scope: string;
  /** Progress 0-1 */
  progress: number;
  /** When work started */
  startedAt: string;
  /** Last time this was worked on */
  lastWorkedOn: string;
  /** What remains to be done */
  remainingWork: string[];
  /** Files involved in this work */
  files: string[];
  /** Is this contract still active */
  active: boolean;
  /** Why it became inactive */
  inactiveReason?: string;
}

export interface Hyposchesin {
  $schema: string;
  title: string;
  description: string;
  version: string;
  lastUpdated: string;

  /** Active commitments */
  commitments: Record<string, Commitment>;

  /** Deferred work items */
  deferred: Record<string, DeferredWork>;

  /** Implicit contracts (started but incomplete work) */
  contracts: Record<string, ImplicitContract>;

  /** Follow-up reminders */
  reminders: {
    id: string;
    relatedTo: string;
    message: string;
    triggerAt: string;
    triggered: boolean;
  }[];

  metadata: HyposchesinMetadata;
}

export interface HyposchesinMetadata {
  totalCommitments: number;
  pendingCommitments: number;
  completedCommitments: number;
  abandonedCommitments: number;
  deferredItems: number;
  activeContracts: number;
  overdueCount: number;
}

// ============================================================================
// Anamnesis Types (An) - Recall/Memory
// ============================================================================

/**
 * Anamnesis represents the recall/memory dimension, indexing past conversations,
 * enabling semantic search, and maintaining topic clusters for retrieval.
 *
 * Layer: Interface (adaptive, conversation memory and retrieval)
 * Symbol: An
 * Purpose: Remember and retrieve relevant past discussions
 */

export type MemoryImportance = 'low' | 'medium' | 'high' | 'critical';

export interface TranscriptReference {
  /** Session ID of the transcript */
  sessionId: string;
  /** File path to the transcript */
  file: string;
  /** Message range [start, end] within the transcript */
  messageRange: [number, number];
  /** Timestamp of the conversation */
  timestamp: string;
}

export interface MemoryEntry {
  id: string;
  /** Summary of what was discussed */
  summary: string;
  /** Keywords for search */
  keywords: string[];
  /** Reference to the original transcript */
  transcriptRef: TranscriptReference;
  /** How important is this memory */
  importance: MemoryImportance;
  /** When this memory was created */
  createdAt: string;
  /** Last time this memory was accessed */
  lastAccessed?: string;
  /** How many times this has been retrieved */
  accessCount: number;
  /** Decay factor (for half-life protocol) */
  decayFactor?: number;
  /** Related entity IDs */
  relatedEntities?: string[];
}

export interface TopicCluster {
  /** Topic name */
  topic: string;
  /** Memory IDs in this cluster */
  memoryIds: string[];
  /** Related topics */
  relatedTopics: string[];
  /** When this cluster was last updated */
  lastUpdated: string;
  /** Confidence in cluster coherence */
  coherence: number;
}

export interface SearchResult {
  memoryId: string;
  score: number;
  summary: string;
  keywords: string[];
  transcriptRef: TranscriptReference;
}

export interface Anamnesis {
  $schema: string;
  title: string;
  description: string;
  version: string;
  lastUpdated: string;

  /** Indexed memory entries */
  memories: Record<string, MemoryEntry>;

  /** Keyword index for fast lookup (keyword -> memory IDs) */
  keywordIndex: Record<string, string[]>;

  /** Topic clusters for semantic grouping */
  topics: Record<string, TopicCluster>;

  /** Search configuration */
  searchConfig: {
    maxResults: number;
    minRelevance: number;
    includeDecayed: boolean;
  };

  /** Index limits for performance */
  limits: {
    maxMemories: number;
    maxSessionsIndexed: number;
    retentionDays: number;
  };

  metadata: AnamnesisMetadata;
}

export interface AnamnesisMetadata {
  totalMemories: number;
  totalKeywords: number;
  totalTopics: number;
  oldestMemory: string | null;
  newestMemory: string | null;
  avgAccessCount: number;
  sessionsIndexed: number;
}
