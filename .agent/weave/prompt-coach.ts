/**
 * Prompt Coach - Analyzes prompt quality and offers coaching
 *
 * The quality of human-agent collaboration determines the quality of outcomes.
 * This module analyzes user prompts against Claude 4 best practices and offers
 * gentle coaching to improve collaboration effectiveness.
 *
 * Based on: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-4-best-practices.md
 *
 * @module weave/prompt-coach
 */

// ============================================================================
// Types
// ============================================================================

export interface PromptAnalysis {
  // Individual scores (0-1)
  clarity: number;
  specificity: number;
  contextProvided: number;
  actionableIntent: number;

  // Overall assessment
  overallScore: number;
  qualityLevel: 'excellent' | 'good' | 'adequate' | 'could-improve';

  // Detected patterns
  strengths: DetectedPattern[];
  growthAreas: DetectedPattern[];

  // Coaching opportunity (if any)
  coaching?: CoachingOpportunity;
}

export interface DetectedPattern {
  pattern: string;
  evidence: string;
  impact: 'positive' | 'negative' | 'neutral';
}

export interface CoachingOpportunity {
  area: 'clarity' | 'specificity' | 'context' | 'intent';
  currentPhrase: string;
  suggestedPhrase: string;
  rationale: string;
  priority: 'high' | 'medium' | 'low';
}

export interface PromptQualityBuffer {
  totalPrompts: number;
  qualityScores: number[];
  avgScore: number;
  patterns: {
    vague: number;
    specific: number;
    contextual: number;
    actionable: number;
  };
  coachingOffered: number;
  coachingAccepted: number;
  sessionStrengths: string[];
  sessionGrowthAreas: string[];
}

// ============================================================================
// Pattern Detection Rules
// ============================================================================

/**
 * Signals indicating VAGUE prompts (reduce clarity score)
 */
const VAGUE_PATTERNS = [
  { pattern: /^(fix|help|do|make|change)\s+(this|it|that)\s*$/i, name: 'bare-command', impact: -0.3 },
  { pattern: /^(something|anything)\s+(is|seems)\s+(wrong|broken|off)/i, name: 'vague-problem', impact: -0.25 },
  { pattern: /^(can|could|would)\s+you\s+.*\?$/i, name: 'question-instead-of-directive', impact: -0.1 },
  { pattern: /\b(somehow|something|stuff|things?)\b/i, name: 'vague-reference', impact: -0.1 },
  { pattern: /\b(maybe|probably|might|perhaps)\b/i, name: 'uncertainty-hedge', impact: -0.05 },
  { pattern: /\b(etc\.?|and so on|\.\.\.)\b/i, name: 'trailing-off', impact: -0.1 },
  { pattern: /^.{1,15}$/i, name: 'too-short', impact: -0.2 },
];

/**
 * Signals indicating CLEAR prompts (increase clarity score)
 */
const CLEAR_PATTERNS = [
  { pattern: /\b(because|since|so that|in order to)\b/i, name: 'provides-reasoning', impact: 0.2 },
  { pattern: /\b(specifically|exactly|precisely)\b/i, name: 'precise-language', impact: 0.15 },
  { pattern: /\bline\s+\d+\b/i, name: 'line-reference', impact: 0.15 },
  { pattern: /\b\w+\.(ts|js|tsx|jsx|py|go|rs|java|cpp|c|h)\b/i, name: 'file-reference', impact: 0.15 },
  { pattern: /`[^`]+`/g, name: 'code-reference', impact: 0.1 },
  { pattern: /"[^"]+"/g, name: 'quoted-specifics', impact: 0.1 },
  { pattern: /\b\d+\b/g, name: 'numeric-specifics', impact: 0.05 },
];

/**
 * Signals indicating ACTIONABLE intent
 */
const ACTIONABLE_PATTERNS = [
  { pattern: /^(create|implement|fix|update|add|remove|change|refactor|delete|move|rename)\b/i, name: 'action-verb-start', impact: 0.25 },
  { pattern: /\b(must|should|need to|have to)\b/i, name: 'imperative-modal', impact: 0.1 },
  { pattern: /\b(do not|don't|never|always|ensure)\b/i, name: 'constraint', impact: 0.15 },
  { pattern: /^(i want|i need|please)\s+(you to\s+)?(create|implement|fix|add|remove)/i, name: 'polite-action', impact: 0.15 },
];

/**
 * Signals indicating unclear intent
 */
const UNCLEAR_INTENT_PATTERNS = [
  { pattern: /^(can|could|would)\s+you\b/i, name: 'request-phrasing', impact: -0.15 },
  { pattern: /\?$/m, name: 'ends-with-question', impact: -0.1 },
  { pattern: /^(maybe|perhaps|possibly)\b/i, name: 'uncertain-start', impact: -0.15 },
  { pattern: /\b(if you (want|can|could|think))\b/i, name: 'optional-action', impact: -0.1 },
];

/**
 * Context provision patterns
 */
const CONTEXT_PATTERNS = [
  { pattern: /\bbecause\b/i, name: 'because-clause', impact: 0.2 },
  { pattern: /\bcontext:/i, name: 'explicit-context', impact: 0.25 },
  { pattern: /\bbackground:/i, name: 'explicit-background', impact: 0.2 },
  { pattern: /\bthe goal is\b/i, name: 'goal-statement', impact: 0.2 },
  { pattern: /\bthis is for\b/i, name: 'purpose-statement', impact: 0.15 },
  { pattern: /\bwe're (trying to|working on)\b/i, name: 'project-context', impact: 0.15 },
];

// ============================================================================
// Analysis Functions
// ============================================================================

/**
 * Analyze a prompt for quality patterns.
 *
 * @param prompt - The user's prompt text
 * @returns Detailed analysis with scores and patterns
 */
export function analyzePrompt(prompt: string): PromptAnalysis {
  const normalizedPrompt = prompt.trim();

  // Calculate individual scores
  const clarity = calculateClarity(normalizedPrompt);
  const specificity = calculateSpecificity(normalizedPrompt);
  const contextProvided = calculateContextScore(normalizedPrompt);
  const actionableIntent = calculateActionableIntent(normalizedPrompt);

  // Collect detected patterns
  const strengths: DetectedPattern[] = [];
  const growthAreas: DetectedPattern[] = [];

  // Detect and categorize patterns
  detectPatterns(normalizedPrompt, CLEAR_PATTERNS, strengths, 'positive');
  detectPatterns(normalizedPrompt, CONTEXT_PATTERNS, strengths, 'positive');
  detectPatterns(normalizedPrompt, ACTIONABLE_PATTERNS, strengths, 'positive');
  detectPatterns(normalizedPrompt, VAGUE_PATTERNS, growthAreas, 'negative');
  detectPatterns(normalizedPrompt, UNCLEAR_INTENT_PATTERNS, growthAreas, 'negative');

  // Calculate overall score (weighted average)
  const overallScore = (
    clarity * 0.25 +
    specificity * 0.25 +
    contextProvided * 0.25 +
    actionableIntent * 0.25
  );

  // Determine quality level
  const qualityLevel = scoreToLevel(overallScore);

  // Generate coaching opportunity if needed
  const coaching = generateCoaching(normalizedPrompt, {
    clarity,
    specificity,
    contextProvided,
    actionableIntent,
  }, growthAreas);

  return {
    clarity,
    specificity,
    contextProvided,
    actionableIntent,
    overallScore,
    qualityLevel,
    strengths,
    growthAreas,
    coaching,
  };
}

function calculateClarity(prompt: string): number {
  let score = 0.5; // Start neutral

  // Apply vague patterns (negative)
  for (const { pattern, impact } of VAGUE_PATTERNS) {
    if (pattern.test(prompt)) {
      score += impact;
    }
  }

  // Apply clear patterns (positive)
  for (const { pattern, impact } of CLEAR_PATTERNS) {
    if (pattern.test(prompt)) {
      score += impact;
    }
  }

  // Length bonus/penalty
  const wordCount = prompt.split(/\s+/).length;
  if (wordCount >= 10 && wordCount <= 100) {
    score += 0.1; // Good length
  } else if (wordCount < 5) {
    score -= 0.15; // Too short
  }

  return clamp(score, 0, 1);
}

function calculateSpecificity(prompt: string): number {
  let score = 0.5;

  // Check for specific references
  if (/\bline\s+\d+\b/i.test(prompt)) score += 0.15;
  if (/\w+\.(ts|js|py|go)\b/i.test(prompt)) score += 0.15;
  if (/`[^`]+`/.test(prompt)) score += 0.1;
  if (/"[^"]+"/.test(prompt)) score += 0.1;
  if (/\b\d+\b/.test(prompt)) score += 0.05;

  // Penalize vague references
  if (/\b(something|somehow|stuff|things?)\b/i.test(prompt)) score -= 0.15;
  if (/\b(etc\.?|\.\.\.)\b/.test(prompt)) score -= 0.1;

  return clamp(score, 0, 1);
}

function calculateContextScore(prompt: string): number {
  let score = 0.3; // Start low - context should be earned

  for (const { pattern, impact } of CONTEXT_PATTERNS) {
    if (pattern.test(prompt)) {
      score += impact;
    }
  }

  // Bonus for longer, more detailed prompts
  const wordCount = prompt.split(/\s+/).length;
  if (wordCount > 30) score += 0.1;
  if (wordCount > 50) score += 0.1;

  return clamp(score, 0, 1);
}

function calculateActionableIntent(prompt: string): number {
  let score = 0.5;

  // Apply actionable patterns (positive)
  for (const { pattern, impact } of ACTIONABLE_PATTERNS) {
    if (pattern.test(prompt)) {
      score += impact;
    }
  }

  // Apply unclear intent patterns (negative)
  for (const { pattern, impact } of UNCLEAR_INTENT_PATTERNS) {
    if (pattern.test(prompt)) {
      score += impact;
    }
  }

  return clamp(score, 0, 1);
}

function detectPatterns(
  prompt: string,
  patterns: Array<{ pattern: RegExp; name: string; impact: number }>,
  output: DetectedPattern[],
  expectedImpact: 'positive' | 'negative'
): void {
  for (const { pattern, name, impact } of patterns) {
    const match = prompt.match(pattern);
    if (match) {
      output.push({
        pattern: name,
        evidence: match[0].substring(0, 50),
        impact: expectedImpact,
      });
    }
  }
}

function scoreToLevel(score: number): 'excellent' | 'good' | 'adequate' | 'could-improve' {
  if (score >= 0.8) return 'excellent';
  if (score >= 0.6) return 'good';
  if (score >= 0.4) return 'adequate';
  return 'could-improve';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ============================================================================
// Coaching Generation
// ============================================================================

interface Scores {
  clarity: number;
  specificity: number;
  contextProvided: number;
  actionableIntent: number;
}

function generateCoaching(
  prompt: string,
  scores: Scores,
  growthAreas: DetectedPattern[]
): CoachingOpportunity | undefined {
  // Only coach if score is low enough to warrant it
  const avgScore = (scores.clarity + scores.specificity + scores.contextProvided + scores.actionableIntent) / 4;
  if (avgScore >= 0.7) return undefined;

  // Find the weakest area
  const weakest = findWeakestArea(scores);

  // Generate coaching based on weakest area
  return generateCoachingForArea(prompt, weakest, growthAreas);
}

function findWeakestArea(scores: Scores): keyof Scores {
  let weakest: keyof Scores = 'clarity';
  let lowestScore = scores.clarity;

  for (const [area, score] of Object.entries(scores) as [keyof Scores, number][]) {
    if (score < lowestScore) {
      lowestScore = score;
      weakest = area;
    }
  }

  return weakest;
}

function generateCoachingForArea(
  prompt: string,
  area: keyof Scores,
  growthAreas: DetectedPattern[]
): CoachingOpportunity | undefined {
  switch (area) {
    case 'clarity':
      return generateClarityCoaching(prompt, growthAreas);
    case 'specificity':
      return generateSpecificityCoaching(prompt);
    case 'contextProvided':
      return generateContextCoaching(prompt);
    case 'actionableIntent':
      return generateIntentCoaching(prompt, growthAreas);
    default:
      return undefined;
  }
}

function generateClarityCoaching(prompt: string, growthAreas: DetectedPattern[]): CoachingOpportunity | undefined {
  // Check for "fix this" pattern
  if (/^(fix|help|do)\s+(this|it|that)\s*$/i.test(prompt)) {
    return {
      area: 'clarity',
      currentPhrase: prompt,
      suggestedPhrase: 'Fix [specific issue] in [file:line]',
      rationale: 'Specific requests help me act faster and more accurately',
      priority: 'high',
    };
  }

  // Check for vague problem description
  if (/something.*(wrong|broken)/i.test(prompt)) {
    return {
      area: 'clarity',
      currentPhrase: prompt.match(/something.*(wrong|broken).*/i)?.[0] || prompt,
      suggestedPhrase: 'The [specific thing] is [specific problem] - I see [error/symptom]',
      rationale: 'Describing what you observe helps me diagnose faster',
      priority: 'medium',
    };
  }

  return undefined;
}

function generateSpecificityCoaching(prompt: string): CoachingOpportunity | undefined {
  // Check for "etc" or trailing off
  if (/\b(etc\.?|and so on|\.\.\.)\b/.test(prompt)) {
    const match = prompt.match(/\b(etc\.?|and so on|\.\.\.)\b/)?.[0];
    return {
      area: 'specificity',
      currentPhrase: match || 'etc.',
      suggestedPhrase: 'List all items explicitly, or state "and similar X"',
      rationale: 'I work better with complete lists - I might miss what you meant by "etc"',
      priority: 'medium',
    };
  }

  return undefined;
}

function generateContextCoaching(prompt: string): CoachingOpportunity | undefined {
  // If prompt is short and lacks context
  const wordCount = prompt.split(/\s+/).length;
  if (wordCount < 15 && !/because|context:|goal/i.test(prompt)) {
    return {
      area: 'context',
      currentPhrase: prompt.substring(0, 30) + (prompt.length > 30 ? '...' : ''),
      suggestedPhrase: `${prompt} because [reason/goal]`,
      rationale: 'Understanding "why" helps me make better decisions and generalize correctly',
      priority: 'medium',
    };
  }

  return undefined;
}

function generateIntentCoaching(prompt: string, growthAreas: DetectedPattern[]): CoachingOpportunity | undefined {
  // Check for "can you" phrasing
  if (/^can you\b/i.test(prompt)) {
    const action = prompt.replace(/^can you\s*/i, '').replace(/\?$/, '');
    return {
      area: 'intent',
      currentPhrase: 'Can you ' + action.substring(0, 20) + '...',
      suggestedPhrase: action.charAt(0).toUpperCase() + action.slice(1),
      rationale: 'Direct statements are clearer than questions - I\'ll ask if I need clarification',
      priority: 'low',
    };
  }

  // Check for question ending
  if (/\?$/.test(prompt) && !/^(what|why|how|when|where|which|who)\b/i.test(prompt)) {
    return {
      area: 'intent',
      currentPhrase: prompt.substring(prompt.length - 30),
      suggestedPhrase: prompt.replace(/\?$/, '.'),
      rationale: 'State intent directly - questions can seem uncertain about what you want',
      priority: 'low',
    };
  }

  return undefined;
}

// ============================================================================
// Session Buffer Management
// ============================================================================

let sessionBuffer: PromptQualityBuffer = createEmptyBuffer();

export function createEmptyBuffer(): PromptQualityBuffer {
  return {
    totalPrompts: 0,
    qualityScores: [],
    avgScore: 0,
    patterns: {
      vague: 0,
      specific: 0,
      contextual: 0,
      actionable: 0,
    },
    coachingOffered: 0,
    coachingAccepted: 0,
    sessionStrengths: [],
    sessionGrowthAreas: [],
  };
}

export function getSessionBuffer(): PromptQualityBuffer {
  return { ...sessionBuffer };
}

export function updateSessionBuffer(analysis: PromptAnalysis): void {
  sessionBuffer.totalPrompts++;
  sessionBuffer.qualityScores.push(analysis.overallScore);
  sessionBuffer.avgScore =
    sessionBuffer.qualityScores.reduce((a, b) => a + b, 0) / sessionBuffer.qualityScores.length;

  // Update pattern counts
  if (analysis.growthAreas.some(g => g.pattern.includes('vague'))) {
    sessionBuffer.patterns.vague++;
  }
  if (analysis.strengths.some(s => s.pattern.includes('specific') || s.pattern.includes('reference'))) {
    sessionBuffer.patterns.specific++;
  }
  if (analysis.strengths.some(s => s.pattern.includes('context') || s.pattern.includes('because'))) {
    sessionBuffer.patterns.contextual++;
  }
  if (analysis.strengths.some(s => s.pattern.includes('action'))) {
    sessionBuffer.patterns.actionable++;
  }

  // Track unique patterns
  for (const strength of analysis.strengths) {
    if (!sessionBuffer.sessionStrengths.includes(strength.pattern)) {
      sessionBuffer.sessionStrengths.push(strength.pattern);
    }
  }
  for (const growth of analysis.growthAreas) {
    if (!sessionBuffer.sessionGrowthAreas.includes(growth.pattern)) {
      sessionBuffer.sessionGrowthAreas.push(growth.pattern);
    }
  }

  // Track coaching
  if (analysis.coaching) {
    sessionBuffer.coachingOffered++;
  }
}

export function resetSessionBuffer(): void {
  sessionBuffer = createEmptyBuffer();
}

// ============================================================================
// Formatted Output
// ============================================================================

/**
 * Format analysis as a brief coaching tip (for inline use).
 */
export function formatCoachingTip(coaching: CoachingOpportunity): string {
  return `Tip: "${coaching.currentPhrase}" -> "${coaching.suggestedPhrase}" (${coaching.rationale})`;
}

/**
 * Format session summary for end-of-session review.
 */
export function formatSessionSummary(buffer: PromptQualityBuffer): string {
  if (buffer.totalPrompts === 0) {
    return 'No prompts analyzed this session.';
  }

  const lines: string[] = [];

  lines.push('## Prompt Quality Summary\n');
  lines.push(`**Prompts analyzed:** ${buffer.totalPrompts}`);
  lines.push(`**Average quality:** ${(buffer.avgScore * 100).toFixed(0)}% (${scoreToLevel(buffer.avgScore)})`);
  lines.push('');

  if (buffer.sessionStrengths.length > 0) {
    lines.push('### Strengths');
    for (const strength of buffer.sessionStrengths.slice(0, 5)) {
      lines.push(`- ${formatPatternName(strength)}`);
    }
    lines.push('');
  }

  if (buffer.sessionGrowthAreas.length > 0) {
    lines.push('### Growth Areas');
    for (const area of buffer.sessionGrowthAreas.slice(0, 5)) {
      lines.push(`- ${formatPatternName(area)}`);
    }
    lines.push('');
  }

  lines.push('### Pattern Breakdown');
  lines.push(`- Specific: ${buffer.patterns.specific}/${buffer.totalPrompts}`);
  lines.push(`- Contextual: ${buffer.patterns.contextual}/${buffer.totalPrompts}`);
  lines.push(`- Actionable: ${buffer.patterns.actionable}/${buffer.totalPrompts}`);
  lines.push(`- Vague: ${buffer.patterns.vague}/${buffer.totalPrompts}`);

  return lines.join('\n');
}

function formatPatternName(pattern: string): string {
  return pattern
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

// ============================================================================
// Export
// ============================================================================

export default {
  analyzePrompt,
  formatCoachingTip,
  formatSessionSummary,
  getSessionBuffer,
  updateSessionBuffer,
  resetSessionBuffer,
  createEmptyBuffer,
};
