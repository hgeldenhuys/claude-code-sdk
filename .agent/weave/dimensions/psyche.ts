/**
 * Psyche Dimension (Psi) - User Model
 *
 * Implements the Half-Life Protocol for managing user understanding:
 * - Volatile buffer: Session-scoped state that resets on session end
 * - Persistent profile: Bayesian accumulation of user expertise and preferences
 *
 * Key features:
 * - Project-scoped expertise (user can be expert in one project, novice in another)
 * - Mode suggestion based on expertise level
 * - Half-life decay for stale observations
 * - Explicit preference tracking (verbosity, code style)
 *
 * NOTE: Mood inference has been intentionally removed. It was:
 * - Unreliable (exclamation marks could mean excitement or frustration)
 * - Culturally biased (punctuation usage varies by culture)
 * - Uncorrectable (user never sees the inference, can't fix it)
 *
 * @module weave/dimensions/psyche
 */

import type {
  Psyche,
  UserProfile,
  VolatileState,
  ExpertiseLevel,
  PreferredMode,
  Verbosity,
  PsycheMetadata,
  Provenance
} from '../types';
import type { SQLiteStore } from '../sqlite-store';

// ============================================================================
// Types
// ============================================================================

export interface PsycheManager {
  // Volatile state (session-scoped)
  getVolatileState(): VolatileState;
  updateFocus(focus: string): void;
  recordActivity(): void;
  resetVolatile(): void;  // Called on session end

  // Persistent profile (Bayesian accumulation)
  getProfile(scope: 'global' | string): Promise<UserProfile | undefined>;
  updateExpertise(scope: string, evidence: ExpertiseEvidence): Promise<void>;
  updatePreference(scope: string, preference: PreferenceUpdate): Promise<void>;

  // Query helpers
  getEffectiveProfile(projectId?: string): Promise<UserProfile>;
  suggestMode(projectId?: string): Promise<PreferredMode>;

  // Persistence
  save(): Promise<void>;
  load(): Promise<void>;
}

/**
 * Question type classification for expertise tracking.
 *
 * KEY INSIGHT: Experts ask MORE questions, not fewer - but they ask DIFFERENT questions.
 * - Novices ask "What is X?"
 * - Intermediates ask "How do I X?"
 * - Experts ask "Why X instead of Y?" and "What are the tradeoffs?"
 */
export type QuestionType =
  | 'basic'          // "What is X?" - suggests lower expertise
  | 'clarifying'     // "Do you mean X or Y?" - neutral, shows engagement
  | 'how_to'         // "How do I X?" - intermediate level
  | 'architectural'  // "Why X instead of Y?" - suggests higher expertise
  | 'tradeoff';      // "What are the tradeoffs?" - expert-level thinking

export interface ExpertiseEvidence {
  type:
    | 'question'           // Generic question (deprecated, use questionType)
    | 'basic_question'     // "What is X?" - suggests lower expertise
    | 'clarifying_question'// "Do you mean X or Y?" - neutral
    | 'how_to_question'    // "How do I X?" - intermediate
    | 'architectural_question' // "Why X instead of Y?" - suggests expertise
    | 'tradeoff_question'  // "What are the tradeoffs?" - expert thinking
    | 'correction'         // Needing correction - suggests lower expertise
    | 'advanced_usage'     // Using advanced features - suggests expertise
    | 'mistake'            // Making mistakes - slightly negative
    | 'quick_understanding'; // Grasping concepts quickly - positive
  /** Domain context (e.g., "TypeScript", "React", "SQL") */
  context?: string;
  /** Weight multiplier 0-1, default 1 */
  weight?: number;
  /** The actual question text (for question types) */
  questionText?: string;
}

export interface PreferenceUpdate {
  field: 'verbosity' | 'preferredMode';
  value: string;
  confidence?: number;
}

// ============================================================================
// Constants
// ============================================================================

// Bayesian update parameters
const EXPERTISE_PRIOR = 0.3;  // Prior weight
const EXPERTISE_EVIDENCE = 0.7;  // Evidence weight
const MIN_OBSERVATIONS = 3;  // Minimum observations before confidence > 0.5

/**
 * Evidence impact on expertise level (positive = more expert, negative = less)
 *
 * IMPORTANT: Question impacts are now differentiated by type.
 * Experts ask MORE questions - but architectural/tradeoff questions,
 * not "what is X?" questions.
 */
const EVIDENCE_IMPACT: Record<ExpertiseEvidence['type'], number> = {
  // Question types - differentiated by sophistication
  'question': 0.0,             // Generic question (deprecated) - neutral
  'basic_question': -0.05,     // "What is X?" - slightly negative
  'clarifying_question': 0.0,  // "Do you mean X or Y?" - neutral (shows engagement)
  'how_to_question': 0.02,     // "How do I X?" - slightly positive (practical)
  'architectural_question': 0.1,  // "Why X instead of Y?" - positive (expert thinking)
  'tradeoff_question': 0.12,   // "What are the tradeoffs?" - very positive (expert)

  // Other evidence types
  'correction': -0.1,          // Needing correction - negative (reduced from -0.15)
  'advanced_usage': 0.15,      // Using advanced features - positive
  'mistake': -0.05,            // Making mistakes - slightly negative (reduced from -0.1)
  'quick_understanding': 0.1   // Grasping concepts quickly - positive
};

// Half-life defaults (in milliseconds)
const DEFAULT_VOLATILE_HALF_LIFE = 3600000;  // 1 hour
const DEFAULT_PERSISTENT_HALF_LIFE = 2592000000;  // 30 days

// Expertise level numeric ranges
const EXPERTISE_THRESHOLDS = {
  novice: 0.35,
  intermediate: 0.65,
  advanced: 0.85,
  expert: 1.0
};

// ============================================================================
// Psyche Manager Implementation
// ============================================================================

export class PsycheManagerImpl implements PsycheManager {
  private store: SQLiteStore;
  private volatile: VolatileState;
  private profiles: Map<string, UserProfile> = new Map();
  private sessionId: string;
  private halfLifeConfig: {
    volatileHalfLife: number;
    persistentHalfLife: number;
  };

  constructor(store: SQLiteStore, sessionId: string) {
    this.store = store;
    this.sessionId = sessionId;
    this.volatile = this.initVolatile();
    this.halfLifeConfig = {
      volatileHalfLife: DEFAULT_VOLATILE_HALF_LIFE,
      persistentHalfLife: DEFAULT_PERSISTENT_HALF_LIFE
    };
  }

  private initVolatile(): VolatileState {
    return {
      currentFocus: undefined,
      sessionStart: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      taskContext: undefined
    };
  }

  // ============= Volatile State Methods =============

  getVolatileState(): VolatileState {
    return { ...this.volatile };
  }

  updateFocus(focus: string): void {
    this.volatile.currentFocus = focus;
    this.volatile.lastActivity = new Date().toISOString();
  }

  recordActivity(): void {
    this.volatile.lastActivity = new Date().toISOString();
  }

  resetVolatile(): void {
    this.volatile = this.initVolatile();
  }

  // ============= Persistent Profile Methods =============

  async getProfile(scope: 'global' | string): Promise<UserProfile | undefined> {
    const id = scope === 'global' ? 'global' : `project:${scope}`;

    // Check cache first
    if (this.profiles.has(id)) {
      return this.profiles.get(id);
    }

    // Load from store
    const entries = await this.store.read('Psi', { status: 'active' });
    for (const entry of entries) {
      if (entry.id === id) {
        this.profiles.set(id, entry as UserProfile);
        return entry as UserProfile;
      }
    }

    return undefined;
  }

  async updateExpertise(scope: string, evidence: ExpertiseEvidence): Promise<void> {
    const id = scope === 'global' ? 'global' : `project:${scope}`;
    let profile = await this.getProfile(scope);

    if (!profile) {
      // Create new profile
      profile = this.createDefaultProfile(id, scope);
    }

    // Calculate new expertise using Bayesian update
    const currentLevel = this.expertiseToNumber(profile.expertise);
    const impact = EVIDENCE_IMPACT[evidence.type] * (evidence.weight ?? 1);

    // Bayesian update formula
    const newLevel = (EXPERTISE_PRIOR * currentLevel) + (EXPERTISE_EVIDENCE * (currentLevel + impact));
    const clampedLevel = Math.max(0, Math.min(1, newLevel));

    // Update profile
    profile.expertise = this.numberToExpertise(clampedLevel);
    profile.observations++;
    profile.confidence = Math.min(0.95, profile.observations / (profile.observations + MIN_OBSERVATIONS));
    profile.lastUpdated = new Date().toISOString();

    // Update domain expertise if context provided
    if (evidence.context) {
      if (!profile.domainExpertise) {
        profile.domainExpertise = {};
      }
      const domainLevel = profile.domainExpertise[evidence.context] || 'intermediate';
      const domainNumeric = this.expertiseToNumber(domainLevel);
      const newDomainLevel = Math.max(0, Math.min(1, domainNumeric + impact));
      profile.domainExpertise[evidence.context] = this.numberToExpertise(newDomainLevel);
    }

    // Update cache
    this.profiles.set(id, profile);

    // Save to store
    await this.store.write('Psi', 'update', profile);
  }

  async updatePreference(scope: string, preference: PreferenceUpdate): Promise<void> {
    const id = scope === 'global' ? 'global' : `project:${scope}`;
    let profile = await this.getProfile(scope);

    if (!profile) {
      profile = this.createDefaultProfile(id, scope);
    }

    // Update preference
    if (preference.field === 'verbosity') {
      profile.verbosity = preference.value as Verbosity;
    } else if (preference.field === 'preferredMode') {
      profile.preferredMode = preference.value as PreferredMode;
    }

    profile.lastUpdated = new Date().toISOString();

    // Update cache
    this.profiles.set(id, profile);

    // Save to store
    await this.store.write('Psi', 'update', profile);
  }

  async getEffectiveProfile(projectId?: string): Promise<UserProfile> {
    // Try project-specific first
    if (projectId) {
      const projectProfile = await this.getProfile(projectId);
      if (projectProfile && projectProfile.confidence > 0.3) {
        return projectProfile;
      }
    }

    // Fall back to global
    const globalProfile = await this.getProfile('global');
    if (globalProfile) {
      return globalProfile;
    }

    // Return default
    return this.createDefaultProfile('default', 'global');
  }

  async suggestMode(projectId?: string): Promise<PreferredMode> {
    const profile = await this.getEffectiveProfile(projectId);

    // If explicit preference with sufficient confidence, use it
    if (profile.preferredMode && profile.confidence > 0.5) {
      return profile.preferredMode;
    }

    // Infer from expertise level
    switch (profile.expertise) {
      case 'expert':
      case 'advanced':
        return 'executor';
      case 'intermediate':
        return 'collaborator';
      case 'novice':
      default:
        return 'navigator';
    }
  }

  // ============= Persistence Methods =============

  async save(): Promise<void> {
    // Save all cached profiles
    for (const [id, profile] of this.profiles) {
      await this.store.write('Psi', 'update', profile);
    }

    // Update dimension metadata
    await this.store.setDimensionMeta('Psi', {
      metadata: {
        totalProfiles: this.profiles.size,
        globalProfile: this.profiles.has('global') ? 'global' : null,
        projectProfiles: Array.from(this.profiles.keys()).filter(k => k.startsWith('project:')).length,
        lastSessionStart: this.volatile.sessionStart,
        sessionsTracked: await this.getSessionsTracked()
      }
    });
  }

  async load(): Promise<void> {
    // Load all profiles from store
    const entries = await this.store.read('Psi', { status: 'active' });
    for (const entry of entries) {
      if (entry.id && entry.scope) {
        this.profiles.set(entry.id, entry as UserProfile);
      }
    }
  }

  private async getSessionsTracked(): Promise<number> {
    const meta = await this.store.getDimensionMeta('Psi');
    const currentCount = (meta?.metadata as any)?.sessionsTracked || 0;
    return currentCount + 1;
  }

  // ============= Helper Methods =============

  private createDefaultProfile(id: string, scope: string): UserProfile {
    const now = new Date().toISOString();
    return {
      id,
      scope: scope === 'global' ? 'global' : 'project',
      projectId: scope === 'global' ? undefined : scope,
      expertise: 'intermediate',
      preferredMode: 'collaborator',
      verbosity: 'normal',
      observations: 0,
      confidence: 0,
      lastUpdated: now,
      provenance: {
        source: 'session-init',
        sessionId: this.sessionId,
        timestamp: now,
        confidence: 0
      }
    };
  }

  private expertiseToNumber(level: ExpertiseLevel): number {
    const map: Record<ExpertiseLevel, number> = {
      'novice': 0.2,
      'intermediate': 0.5,
      'advanced': 0.75,
      'expert': 0.95
    };
    return map[level];
  }

  private numberToExpertise(value: number): ExpertiseLevel {
    if (value >= EXPERTISE_THRESHOLDS.advanced) return 'expert';
    if (value >= EXPERTISE_THRESHOLDS.intermediate) return 'advanced';
    if (value >= EXPERTISE_THRESHOLDS.novice) return 'intermediate';
    return 'novice';
  }
}

// ============================================================================
// Half-Life Decay Functions
// ============================================================================

/**
 * Calculate decay factor based on half-life protocol.
 *
 * @param age - Age of the observation in milliseconds
 * @param halfLife - Half-life period in milliseconds
 * @returns Decay factor (0-1)
 */
export function calculateDecay(age: number, halfLife: number): number {
  return Math.pow(0.5, age / halfLife);
}

/**
 * Apply half-life decay to confidence value.
 *
 * @param confidence - Current confidence value
 * @param lastUpdated - Timestamp of last update
 * @param halfLife - Half-life period in milliseconds
 * @returns Decayed confidence value
 */
export function applyHalfLifeDecay(
  confidence: number,
  lastUpdated: string,
  halfLife: number
): number {
  const age = Date.now() - new Date(lastUpdated).getTime();
  const decay = calculateDecay(age, halfLife);
  return confidence * decay;
}

// ============================================================================
// Verbosity Inference
// ============================================================================

/**
 * Infer preferred verbosity from user behavior.
 *
 * @param avgMessageLength - Average user message length
 * @param questionsAsked - Number of clarifying questions asked
 * @param skippedExplanations - Whether user skips long explanations
 * @returns Inferred verbosity preference
 */
export function inferVerbosity(
  avgMessageLength: number,
  questionsAsked: number,
  skippedExplanations: boolean
): Verbosity {
  if (skippedExplanations || (avgMessageLength < 20 && questionsAsked === 0)) {
    return 'terse';
  }

  if (questionsAsked > 3 || avgMessageLength > 100) {
    return 'verbose';
  }

  return 'normal';
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new PsycheManager instance.
 *
 * @param store - SQLite store for persistence
 * @param sessionId - Current session identifier
 * @returns PsycheManager instance
 */
export function createPsycheManager(store: SQLiteStore, sessionId: string): PsycheManager {
  return new PsycheManagerImpl(store, sessionId);
}

/**
 * Create initial Psyche dimension structure.
 *
 * @param sessionId - Session identifier
 * @returns Initial Psyche structure
 */
export function createInitialPsyche(sessionId: string): Psyche {
  const now = new Date().toISOString();

  return {
    $schema: 'https://weave.agent/schemas/psyche.json',
    title: 'Psyche',
    description: 'User model dimension - expertise and preference tracking',
    version: '1.1.0',  // Bumped: removed mood inference
    lastUpdated: now,

    volatileState: {
      currentFocus: undefined,
      sessionStart: now,
      lastActivity: now,
      taskContext: undefined
    },

    profiles: {},

    halfLifeConfig: {
      volatileHalfLife: DEFAULT_VOLATILE_HALF_LIFE,
      persistentHalfLife: DEFAULT_PERSISTENT_HALF_LIFE
    },

    metadata: {
      totalProfiles: 0,
      globalProfile: null,
      projectProfiles: 0,
      averageConfidence: 0,
      lastSessionStart: now,
      sessionsTracked: 1
    }
  };
}

// ============================================================================
// Psyche Analysis Utilities
// ============================================================================

/**
 * Analyze profile for insights.
 *
 * @param profile - User profile to analyze
 * @returns Analysis results with recommendations
 */
export function analyzeProfile(profile: UserProfile): {
  expertiseDescription: string;
  modeRationale: string;
  recommendations: string[];
} {
  const expertiseDescriptions: Record<ExpertiseLevel, string> = {
    'novice': 'New to this domain - benefits from detailed explanations and guidance',
    'intermediate': 'Familiar with basics - can handle standard tasks with some guidance',
    'advanced': 'Strong understanding - prefers concise interactions and autonomy',
    'expert': 'Domain expert - values efficiency and minimal hand-holding'
  };

  const modeRationales: Record<PreferredMode, string> = {
    'navigator': 'Step-by-step guidance with detailed explanations',
    'collaborator': 'Balanced interaction with discussion and options',
    'executor': 'Direct action with minimal interruption'
  };

  const recommendations: string[] = [];

  // Confidence-based recommendations
  if (profile.confidence < 0.3) {
    recommendations.push('Profile confidence is low - more observations needed for accurate personalization');
  }

  // Expertise-specific recommendations
  if (profile.expertise === 'novice') {
    recommendations.push('Provide detailed explanations and context');
    recommendations.push('Offer step-by-step guidance');
    recommendations.push('Confirm understanding before proceeding');
  } else if (profile.expertise === 'expert') {
    recommendations.push('Keep explanations concise');
    recommendations.push('Offer autonomous execution when possible');
    recommendations.push('Focus on results over process');
  }

  // Verbosity recommendations
  if (profile.verbosity === 'terse') {
    recommendations.push('Keep responses brief and actionable');
  } else if (profile.verbosity === 'verbose') {
    recommendations.push('Provide thorough explanations and context');
  }

  return {
    expertiseDescription: expertiseDescriptions[profile.expertise],
    modeRationale: modeRationales[profile.preferredMode],
    recommendations
  };
}

/**
 * Merge two profiles with weighted averaging.
 *
 * @param primary - Primary profile (higher weight)
 * @param secondary - Secondary profile (lower weight)
 * @param primaryWeight - Weight for primary profile (0-1)
 * @returns Merged profile
 */
export function mergeProfiles(
  primary: UserProfile,
  secondary: UserProfile,
  primaryWeight: number = 0.7
): UserProfile {
  const secondaryWeight = 1 - primaryWeight;

  // Calculate weighted expertise
  const primaryExpertise = {
    'novice': 0.2, 'intermediate': 0.5, 'advanced': 0.75, 'expert': 0.95
  }[primary.expertise];
  const secondaryExpertise = {
    'novice': 0.2, 'intermediate': 0.5, 'advanced': 0.75, 'expert': 0.95
  }[secondary.expertise];

  const mergedExpertise = (primaryExpertise * primaryWeight) + (secondaryExpertise * secondaryWeight);

  // Determine expertise level from merged value
  let expertise: ExpertiseLevel = 'intermediate';
  if (mergedExpertise >= 0.85) expertise = 'expert';
  else if (mergedExpertise >= 0.65) expertise = 'advanced';
  else if (mergedExpertise >= 0.35) expertise = 'intermediate';
  else expertise = 'novice';

  // Merge confidence
  const mergedConfidence = Math.min(
    0.95,
    (primary.confidence * primaryWeight) + (secondary.confidence * secondaryWeight)
  );

  return {
    ...primary,
    expertise,
    confidence: mergedConfidence,
    observations: primary.observations + secondary.observations,
    lastUpdated: new Date().toISOString()
  };
}

// ============================================================================
// Question Classification
// ============================================================================

/**
 * Patterns for classifying questions by sophistication level.
 * IMPORTANT: Order matters! More specific patterns (tradeoff, architectural)
 * must come before generic patterns (basic) to avoid false matches.
 */
const QUESTION_PATTERNS: Array<{
  type: QuestionType;
  patterns: RegExp[];
}> = [
  // Most specific patterns first
  {
    type: 'tradeoff',
    patterns: [
      /\btradeoffs?\b/i,
      /\btrade-offs?\b/i,
      /^what are the (pros|cons|downsides|benefits|drawbacks)\b/i,
      /^what (would|could) go wrong\b/i,
      /^what are the implications\b/i,
      /^when (would|should) (i|we) (not|avoid)\b/i,
    ],
  },
  {
    type: 'architectural',
    patterns: [
      /^why (did|do|would|should) (you|we|they)\b.*instead of\b/i,
      /^why not (use|try|go with)\b/i,
      /^what's the (reason|rationale) (for|behind)\b/i,
      /^why is.*better than\b/i,
      /^how does this (compare|relate) to\b/i,
    ],
  },
  {
    type: 'how_to',
    patterns: [
      /^how (do|can|should) (i|we|you)\b/i,
      /^how to\b/i,
      /^what's the (best|right|correct) way to\b/i,
      /^can you show me how\b/i,
    ],
  },
  {
    type: 'clarifying',
    patterns: [
      /^do you mean\b/i,
      /^are you (referring|talking) (to|about)\b/i,
      /^which (one|version)\b/i,
      /^is (this|that) the\b/i,
      /^just to clarify\b/i,
    ],
  },
  // Generic patterns last (catch-all)
  {
    type: 'basic',
    patterns: [
      /^what (is|are|does)\b/i,
      /^what's\b/i,
      /^can you (explain|tell me)\b/i,
      /^define\b/i,
    ],
  },
];

/**
 * Classify a question by its sophistication level.
 *
 * @param questionText - The question text to classify
 * @returns The question type, or 'basic' as fallback
 */
export function classifyQuestion(questionText: string): QuestionType {
  const normalizedText = questionText.trim();

  for (const { type, patterns } of QUESTION_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(normalizedText)) {
        return type;
      }
    }
  }

  // Default to 'basic' for unrecognized patterns
  return 'basic';
}

/**
 * Create an expertise evidence entry from a question.
 *
 * @param questionText - The question asked
 * @param context - Optional domain context
 * @returns ExpertiseEvidence with appropriate type
 */
export function createQuestionEvidence(
  questionText: string,
  context?: string
): ExpertiseEvidence {
  const questionType = classifyQuestion(questionText);

  const typeMap: Record<QuestionType, ExpertiseEvidence['type']> = {
    'basic': 'basic_question',
    'clarifying': 'clarifying_question',
    'how_to': 'how_to_question',
    'architectural': 'architectural_question',
    'tradeoff': 'tradeoff_question',
  };

  return {
    type: typeMap[questionType],
    context,
    questionText,
  };
}

// ============================================================================
// Export Default
// ============================================================================

export default {
  createPsycheManager,
  createInitialPsyche,
  inferVerbosity,
  calculateDecay,
  applyHalfLifeDecay,
  analyzeProfile,
  mergeProfiles,
  classifyQuestion,
  createQuestionEvidence,
};
