/**
 * Knowledge Extraction Pipeline
 *
 * Extracts knowledge from Claude Code sessions and updates the Weave.
 * Implements the Enhanced Version 2 approach with semantic clarity.
 */

import type {
  Session,
  ToolUse,
  ErrorEvent,
  Fix,
  CommitInfo,
  OntologyConcept,
  Composition,
  Knowledge,
  Experience,
  PainPoint,
  BestPractice,
  Pattern,
  KnowledgeUpdate,
  Dimension,
  CodeLocation
} from './types';

// ============================================================================
// Core Extraction Pipeline
// ============================================================================

export class KnowledgeExtractor {

  /**
   * Main extraction pipeline - Enhanced Version 2
   * Optimized for meaning and mental models over performance
   */
  async extractFromSession(session: Session): Promise<KnowledgeUpdate[]> {
    const updates: KnowledgeUpdate[] = [];

    // Extract all signals ONCE for efficiency
    const signals = await this.extractSignals(session);

    // Route to appropriate knowledge dimensions
    // Clear semantic alignment: different signals teach different things

    // Structural knowledge (O+M) from code changes
    if (signals.filesChanged.length > 0) {
      updates.push(...await this.extractStructuralKnowledge(signals));
    }

    // Epistemic knowledge (E) from patterns and validation
    if (signals.patterns.length > 0 || signals.commit) {
      updates.push(...await this.extractEpistemicKnowledge(signals));
    }

    // Experiential knowledge (Q) from errors, fixes, and workflow
    if (signals.errors.length > 0 || signals.fixes.length > 0 || signals.toolSequences.length > 0) {
      updates.push(...await this.extractExperientialKnowledge(signals));
    }

    return updates;
  }

  // ==========================================================================
  // Signal Extraction (Single Pass)
  // ==========================================================================

  private async extractSignals(session: Session): Promise<ExtractedSignals> {
    return {
      filesChanged: session.filesChanged || [],
      toolUses: session.toolUses || [],
      errors: session.errors || [],
      fixes: session.fixes || [],
      commit: session.commit,
      patterns: await this.detectPatterns(session),
      toolSequences: await this.detectToolSequences(session.toolUses || []),
      entities: await this.extractEntities(session.filesChanged || []),
      dependencies: await this.extractDependencies(session.filesChanged || [])
    };
  }

  // ==========================================================================
  // Structural Knowledge Extraction (O+M)
  // ==========================================================================

  private async extractStructuralKnowledge(signals: ExtractedSignals): Promise<KnowledgeUpdate[]> {
    const updates: KnowledgeUpdate[] = [];

    // Extract Ontology (What exists)
    for (const entity of signals.entities) {
      updates.push({
        dimension: 'O' as Dimension,
        operation: 'merge',
        data: entity,
        provenance: {
          source: 'session-extraction',
          confidence: 0.7, // Initial confidence for extracted entities
          firstSeen: new Date().toISOString(),
          lastValidated: new Date().toISOString(),
          observations: 1
        }
      });
    }

    // Extract Mereology (How things compose)
    if (signals.dependencies.length > 0) {
      const composition = await this.buildComposition(signals);
      updates.push({
        dimension: 'M' as Dimension,
        operation: 'merge',
        data: composition,
        provenance: {
          source: 'session-extraction',
          confidence: 0.65,
          firstSeen: new Date().toISOString(),
          lastValidated: new Date().toISOString()
        }
      });
    }

    return updates;
  }

  // ==========================================================================
  // Epistemic Knowledge Extraction (E)
  // ==========================================================================

  private async extractEpistemicKnowledge(signals: ExtractedSignals): Promise<KnowledgeUpdate[]> {
    const updates: KnowledgeUpdate[] = [];

    // Pattern recognition increases confidence
    for (const pattern of signals.patterns) {
      updates.push({
        dimension: 'E' as Dimension,
        operation: 'update',
        data: {
          id: pattern.id,
          matchQuality: pattern.confidence,
          reason: 'pattern_observed'
        },
        provenance: {
          source: 'pattern-detection',
          confidence: pattern.confidence,
          firstSeen: new Date().toISOString(),
          lastValidated: new Date().toISOString()
        }
      });
    }

    // Successful commits validate knowledge
    if (signals.commit?.successful) {
      const validatedConcepts = await this.extractConceptsFromCommit(signals.commit);
      for (const concept of validatedConcepts) {
        updates.push({
          dimension: 'E' as Dimension,
          operation: 'update',
          data: {
            id: concept,
            reason: 'commit_validation',
            validationBoost: 0.1
          },
          provenance: {
            source: `commit-${signals.commit.sha}`,
            confidence: 0.9,
            firstSeen: new Date().toISOString(),
            lastValidated: new Date().toISOString()
          }
        });
      }
    }

    return updates;
  }

  // ==========================================================================
  // Experiential Knowledge Extraction (Q)
  // ==========================================================================

  private async extractExperientialKnowledge(signals: ExtractedSignals): Promise<KnowledgeUpdate[]> {
    const updates: KnowledgeUpdate[] = [];

    // Extract pain points from errors
    const painPoints = signals.errors.map(error => this.errorToPainPoint(error));

    // Extract solutions from fixes
    const solutions = signals.fixes.map(fix => this.fixToSolution(fix));

    // Extract workflow patterns from tool sequences
    const workflowPatterns = signals.toolSequences.map(seq => this.sequenceToPattern(seq));

    // Build experience object
    const experience: Partial<Experience> = {
      id: `session-${Date.now()}`,
      concept: this.inferConceptFromSignals(signals),
      painPoints,
      bestPractices: solutions.map(s => s.practice).filter(Boolean) as BestPractice[],
      commonWorkflow: workflowPatterns.map(p => p.description),
      provenance: {
        sources: ['current-session'],
        lastUpdated: new Date().toISOString()
      }
    };

    if (painPoints.length > 0 || solutions.length > 0 || workflowPatterns.length > 0) {
      updates.push({
        dimension: 'Q' as Dimension,
        operation: 'add',
        data: experience,
        provenance: {
          source: 'session-experience',
          confidence: 0.8,
          firstSeen: new Date().toISOString(),
          lastValidated: new Date().toISOString()
        }
      });
    }

    return updates;
  }

  // ==========================================================================
  // Entity Extraction Helpers
  // ==========================================================================

  private async extractEntities(files: string[]): Promise<OntologyConcept[]> {
    const entities: OntologyConcept[] = [];

    for (const file of files) {
      // Extract from TypeScript files
      if (file.endsWith('.ts') || file.endsWith('.tsx')) {
        const entity = await this.extractEntityFromFile(file);
        if (entity) entities.push(entity);
      }

      // Extract from database migrations
      if (file.includes('/migrations/')) {
        const tableEntity = await this.extractTableFromMigration(file);
        if (tableEntity) entities.push(tableEntity);
      }

      // Extract from API routes
      if (file.includes('/routes/') || file.includes('/api/')) {
        const endpoint = await this.extractEndpointFromRoute(file);
        if (endpoint) entities.push(endpoint);
      }
    }

    return entities;
  }

  private async extractEntityFromFile(file: string): Promise<OntologyConcept | null> {
    // Parse file path to determine entity type
    const pathParts = file.split('/');
    const filename = pathParts[pathParts.length - 1];
    const name = filename.replace(/\.(ts|tsx)$/, '');

    let type: OntologyConcept['type'] = 'entity';
    if (file.includes('/services/')) type = 'service';
    else if (file.includes('/modules/')) type = 'module';
    else if (file.includes('/routes/')) type = 'api-endpoint';

    return {
      id: name.toLowerCase(),
      type,
      description: `Extracted from ${file}`,
      location: {
        file,
        commit: 'current'
      },
      provenance: {
        source: 'file-extraction',
        confidence: 0.6,
        firstSeen: new Date().toISOString(),
        lastValidated: new Date().toISOString()
      }
    };
  }

  private async extractTableFromMigration(file: string): Promise<OntologyConcept | null> {
    // Extract table name from migration file
    const match = file.match(/create_table_(\w+)|add_(\w+)_table/);
    if (!match) return null;

    const tableName = match[1] || match[2];

    return {
      id: `table-${tableName}`,
      type: 'database-table',
      description: `Database table ${tableName}`,
      location: {
        file
      },
      provenance: {
        source: 'migration-extraction',
        confidence: 0.8,
        firstSeen: new Date().toISOString(),
        lastValidated: new Date().toISOString()
      }
    };
  }

  private async extractEndpointFromRoute(file: string): Promise<OntologyConcept | null> {
    // Extract endpoint from route file
    const pathMatch = file.match(/routes\/([^/]+)/);
    if (!pathMatch) return null;

    const resource = pathMatch[1];

    return {
      id: `endpoint-${resource}`,
      type: 'api-endpoint',
      description: `API endpoint for ${resource}`,
      location: {
        file
      },
      provenance: {
        source: 'route-extraction',
        confidence: 0.75,
        firstSeen: new Date().toISOString(),
        lastValidated: new Date().toISOString()
      }
    };
  }

  // ==========================================================================
  // Pattern Detection
  // ==========================================================================

  private async detectPatterns(session: Session): Promise<DetectedPattern[]> {
    const patterns: DetectedPattern[] = [];

    // Detect SSE pattern
    if (this.detectSSEPattern(session)) {
      patterns.push({
        id: 'sse-pattern',
        name: 'Server-Sent Events Implementation',
        confidence: 0.9
      });
    }

    // Detect CRUD pattern
    if (this.detectCRUDPattern(session)) {
      patterns.push({
        id: 'crud-pattern',
        name: 'CRUD Operations',
        confidence: 0.85
      });
    }

    // Detect testing pattern
    if (this.detectTestingPattern(session)) {
      patterns.push({
        id: 'test-pattern',
        name: 'Test Implementation',
        confidence: 0.8
      });
    }

    return patterns;
  }

  private detectSSEPattern(session: Session): boolean {
    const files = session.filesChanged || [];
    const hasSSERoute = files.some(f => f.includes('sse') || f.includes('stream'));
    const hasEventSource = session.toolUses?.some(t =>
      t.tool === 'Write' && JSON.stringify(t.parameters).includes('EventSource')
    );
    return hasSSERoute || hasEventSource || false;
  }

  private detectCRUDPattern(session: Session): boolean {
    const files = session.filesChanged || [];
    const hasCRUDRoutes = files.some(f =>
      f.includes('create') || f.includes('update') ||
      f.includes('delete') || f.includes('list')
    );
    return hasCRUDRoutes;
  }

  private detectTestingPattern(session: Session): boolean {
    const files = session.filesChanged || [];
    return files.some(f => f.includes('.test.') || f.includes('.spec.'));
  }

  // ==========================================================================
  // Tool Sequence Analysis
  // ==========================================================================

  private async detectToolSequences(toolUses: ToolUse[]): Promise<ToolSequence[]> {
    const sequences: ToolSequence[] = [];

    // Group consecutive related tools
    let currentSequence: ToolUse[] = [];
    let lastTool: string | null = null;

    for (const tool of toolUses) {
      if (this.areToolsRelated(lastTool, tool.tool)) {
        currentSequence.push(tool);
      } else {
        if (currentSequence.length > 2) {
          sequences.push({
            tools: currentSequence.map(t => t.tool),
            description: this.describeSequence(currentSequence)
          });
        }
        currentSequence = [tool];
      }
      lastTool = tool.tool;
    }

    // Don't forget the last sequence
    if (currentSequence.length > 2) {
      sequences.push({
        tools: currentSequence.map(t => t.tool),
        description: this.describeSequence(currentSequence)
      });
    }

    return sequences;
  }

  private areToolsRelated(tool1: string | null, tool2: string): boolean {
    if (!tool1) return true;

    const relatedGroups = [
      ['Read', 'Write', 'Edit'],
      ['Bash', 'BashOutput'],
      ['Grep', 'Read'],
      ['TodoWrite']
    ];

    return relatedGroups.some(group =>
      group.includes(tool1) && group.includes(tool2)
    );
  }

  private describeSequence(tools: ToolUse[]): string {
    const toolNames = tools.map(t => t.tool).join(' → ');

    // Common patterns
    if (toolNames.includes('Read → Edit → Write')) {
      return 'File modification workflow';
    }
    if (toolNames.includes('Grep → Read')) {
      return 'Search and examine pattern';
    }
    if (toolNames.includes('Write → Bash')) {
      return 'Create and execute pattern';
    }

    return `Tool sequence: ${toolNames}`;
  }

  // ==========================================================================
  // Conversion Helpers
  // ==========================================================================

  private errorToPainPoint(error: ErrorEvent): PainPoint {
    return {
      issue: error.message,
      frequency: 'uncommon', // Will be updated over time
      severity: error.severity,
      consequence: 'Development blocked',
      solution: 'To be determined',
      firstEncountered: new Date().toISOString(),
      occurrences: 1
    };
  }

  private fixToSolution(fix: Fix): { practice?: BestPractice } {
    if (!fix.resolved) return {};

    return {
      practice: {
        practice: fix.approach,
        reason: `Resolves: ${fix.resolvedError}`,
        context: fix.changedFiles.join(', '),
        confidence: 0.7
      }
    };
  }

  private sequenceToPattern(sequence: ToolSequence): { description: string } {
    return {
      description: sequence.description
    };
  }

  private inferConceptFromSignals(signals: ExtractedSignals): string {
    // Try to infer the main concept being worked on
    if (signals.commit?.message) {
      const match = signals.commit.message.match(/(?:feat|fix|refactor)\(([^)]+)\)/);
      if (match) return match[1];
    }

    if (signals.entities.length > 0) {
      return signals.entities[0].id;
    }

    return 'general-development';
  }

  // ==========================================================================
  // Dependency Extraction
  // ==========================================================================

  private async extractDependencies(files: string[]): Promise<Dependency[]> {
    const dependencies: Dependency[] = [];

    for (const file of files) {
      // Simple import detection (would be more sophisticated in practice)
      if (file.endsWith('.ts') || file.endsWith('.tsx')) {
        dependencies.push({
          source: file,
          targets: [], // Would parse imports here
          type: 'import'
        });
      }
    }

    return dependencies;
  }

  private async buildComposition(signals: ExtractedSignals): Promise<Partial<Composition>> {
    return {
      id: `composition-${Date.now()}`,
      type: 'module',
      description: 'Extracted module composition',
      parts: {
        core: signals.entities.map(e => e.id)
      },
      dependencies: {
        internal: {}
      },
      provenance: {
        source: 'dependency-extraction',
        confidence: 0.6,
        firstSeen: new Date().toISOString(),
        lastValidated: new Date().toISOString()
      }
    };
  }

  private async extractConceptsFromCommit(commit: CommitInfo): Promise<string[]> {
    const concepts: string[] = [];

    // Extract from commit message
    const match = commit.message.match(/(?:feat|fix|refactor)\(([^)]+)\)/);
    if (match) {
      concepts.push(match[1]);
    }

    // Extract from files
    for (const file of commit.files) {
      const entity = await this.extractEntityFromFile(file);
      if (entity) {
        concepts.push(entity.id);
      }
    }

    return concepts;
  }
}

// ============================================================================
// Type Definitions for Internal Use
// ============================================================================

interface ExtractedSignals {
  filesChanged: string[];
  toolUses: ToolUse[];
  errors: ErrorEvent[];
  fixes: Fix[];
  commit?: CommitInfo;
  patterns: DetectedPattern[];
  toolSequences: ToolSequence[];
  entities: OntologyConcept[];
  dependencies: Dependency[];
}

interface DetectedPattern {
  id: string;
  name: string;
  confidence: number;
}

interface ToolSequence {
  tools: string[];
  description: string;
}

interface Dependency {
  source: string;
  targets: string[];
  type: 'import' | 'extends' | 'implements';
}

// ============================================================================
// Export singleton instance
// ============================================================================

export const extractor = new KnowledgeExtractor();

// ============================================================================
// File-based Extraction (New)
// ============================================================================

interface FileContent {
  path: string;
  content: string;
}

interface ExtractionResult {
  ontology: OntologyConcept[];
  mereology: Composition[];
  epistemology: Knowledge[];
  qualia: Experience[];
  processingTimeMs: number;
}

/**
 * Extract knowledge from file contents using LLM
 * This is the main entry point for file-based extraction
 */
export async function extractKnowledgeFromFiles(files: FileContent[]): Promise<ExtractionResult> {
  const startTime = Date.now();

  // Build extraction prompt
  const filesContext = files.map(f => `File: ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n');

  const prompt = `Analyze the following source code files and extract knowledge in Q+E+O+M+C+A+T dimensions:

${filesContext}

Extract:

1. QUALIA (Q) - Experiential knowledge:
   - What pain points or problems does this code solve?
   - What workflows or processes does it enable?
   - What are the best practices demonstrated?
   - What solutions have been implemented?

2. EPISTEMOLOGY (E) - How we know things:
   - What patterns are evident? (design patterns, architectural patterns)
   - What are the key insights or knowledge about how this works?
   - What confidence level do these patterns have?
   - What validations or proofs exist?

3. ONTOLOGY (O) - Entities and their relationships:
   - What are the key concepts/entities? (classes, functions, modules, types)
   - What are the relationships between them? (uses, extends, implements, contains)
   - What constraints or invariants exist?

4. MEREOLOGY (M) - Compositional structure:
   - How are things composed? (what contains what?)
   - What are the hierarchies and part-whole relationships?
   - What are the dependencies between parts?

5. CAUSATION (C) - Cause and effect relationships:
   - What are the causal chains? (A causes B, B causes C)
   - What are the root causes of problems or design decisions?
   - What mechanisms make things work? (event handlers, data flow, state transitions)
   - What effects does each component have?

6. AXIOLOGY (A) - Value judgments and tradeoffs:
   - What tradeoffs were made? (speed vs memory, simplicity vs flexibility)
   - What quality metrics are important? (performance, maintainability, security)
   - Why was this approach chosen over alternatives?
   - What are the priorities or values reflected in the design?

7. TELEOLOGY (T) - Purpose and intent:
   - What is the purpose of each component? (why does it exist?)
   - What goals is the code trying to achieve?
   - What user needs or business requirements does it fulfill?
   - What is the intended behavior or outcome?

8. HISTORY (Η) - Temporal evolution and change:
   - What evolved over time? (migrations, refactors, version changes)
   - What are the migration paths? (old → new patterns)
   - What legacy patterns exist? (deprecated but still present)
   - What timelines are important? (when did key changes happen)

9. PRAXEOLOGY (Π) - Way of Working patterns:
   - What WoW patterns are used? (delegation, workflow, collaboration)
   - What delegation strategies exist? (when to use agents, when to do yourself)
   - What best practices emerged? (learned from experience)
   - What anti-patterns to avoid? (common mistakes)

10. MODALITY (Μ) - Alternatives and possibilities:
    - What alternatives were considered? (options evaluated)
    - What was rejected and why? (design decisions)
    - What future possibilities exist? (potential directions)
    - What constraints limit choices? (why certain options aren't viable)

11. DEONTICS (Δ) - Rules and obligations:
    - What MUST happen? (required behaviors, invariants)
    - What MUST NOT happen? (prohibited actions, anti-patterns)
    - What MAY happen? (optional behaviors, flexibility)
    - What are the gates? (quality checkpoints, Definition of Done)

Return a JSON object with this structure:
{
  "ontology": [{"id": "entity-id", "name": "EntityName", "type": "class|function|module", "description": "...", "confidence": 0.9}],
  "mereology": [{"wholeId": "parent-id", "partId": "child-id", "relationship": "contains|uses", "confidence": 0.8}],
  "epistemology": [{"id": "knowledge-id", "concept": "...", "description": "...", "pattern": "...", "confidence": 0.9}],
  "qualia": [{"id": "exp-id", "type": "painPoint|workflow|bestPractice|solution", "description": "...", "solution": "..."}],
  "causation": [{"id": "cause-id", "type": "causalChain|rootCause|mechanism", "cause": "...", "effect": "...", "description": "...", "confidence": 0.8}],
  "axiology": [{"id": "value-id", "type": "tradeoff|qualityMetric|valueJudgment", "description": "...", "rationale": "...", "confidence": 0.7}],
  "teleology": [{"id": "purpose-id", "type": "purpose|goal|intent", "component": "...", "purpose": "...", "userNeed": "...", "confidence": 0.8}],
  "history": {
    "evolutions": [{"id": "evolution-id", "from": "...", "to": "...", "reason": "...", "confidence": 0.8}],
    "timelines": [{"id": "timeline-id", "event": "...", "timestamp": "...", "significance": "...", "confidence": 0.7}],
    "legacyPatterns": [{"id": "legacy-id", "pattern": "...", "deprecated": true, "replacement": "...", "confidence": 0.8}]
  },
  "praxeology": {
    "wowPatterns": [{"id": "wow-id", "pattern": "...", "context": "...", "effectiveness": "...", "confidence": 0.8}],
    "delegationStrategies": [{"id": "delegation-id", "scenario": "...", "strategy": "...", "rationale": "...", "confidence": 0.8}],
    "bestPractices": [{"id": "practice-id", "practice": "...", "reason": "...", "context": "...", "confidence": 0.9}]
  },
  "modality": {
    "alternatives": [{"id": "alt-id", "option": "...", "considered": "...", "outcome": "...", "confidence": 0.7}],
    "rejectedOptions": [{"id": "rejected-id", "option": "...", "reason": "...", "tradeoffs": "...", "confidence": 0.8}],
    "possibleFutures": [{"id": "future-id", "possibility": "...", "conditions": "...", "likelihood": "...", "confidence": 0.6}]
  },
  "deontics": {
    "obligations": [{"id": "must-id", "rule": "...", "rationale": "...", "enforcement": "...", "confidence": 0.9}],
    "permissions": [{"id": "may-id", "allowance": "...", "conditions": "...", "flexibility": "...", "confidence": 0.8}],
    "prohibitions": [{"id": "must-not-id", "prohibition": "...", "consequence": "...", "rationale": "...", "confidence": 0.9}]
  }
}`;

  try {
    // Use Claude Code headless mode - no API key needed!
    const { spawnSync } = await import('child_process');

    // Call Claude Code headless with prompt via stdin
    const claudeResult = spawnSync('claude', [
      '--output-format', 'json'
    ], {
      input: prompt,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      cwd: process.cwd()
    });

    if (claudeResult.error) {
      console.error('[Weave] Failed to run claude headless:', claudeResult.error);
      console.error('[Weave] Make sure `claude` CLI is in your PATH');
      return {
        ontology: [],
        mereology: [],
        epistemology: [],
        qualia: [],
        processingTimeMs: Date.now() - startTime
      };
    }

    // Debug: Write stdout/stderr to temp files
    const { writeFileSync: writeSync } = await import('fs');
    const { tmpdir } = await import('os');
    const { join: joinPath } = await import('path');
    const debugDir = joinPath(tmpdir(), 'weave-debug');
    const { mkdirSync: mkdirSyncDebug } = await import('fs');
    mkdirSyncDebug(debugDir, { recursive: true });
    writeSync(joinPath(debugDir, 'claude-stdout.txt'), claudeResult.stdout || '(empty)');
    writeSync(joinPath(debugDir, 'claude-stderr.txt'), claudeResult.stderr || '(empty)');
    writeSync(joinPath(debugDir, 'claude-status.txt'), `Status: ${claudeResult.status}\nError: ${claudeResult.error}`);

    if (claudeResult.status !== 0) {
      console.error('[Weave] Claude headless failed with status:', claudeResult.status);
      console.error('[Weave] STDOUT length:', claudeResult.stdout?.length || 0);
      console.error('[Weave] STDERR length:', claudeResult.stderr?.length || 0);
      console.error('[Weave] Debug files written to:', debugDir);
      return {
        ontology: [],
        mereology: [],
        epistemology: [],
        qualia: [],
        processingTimeMs: Date.now() - startTime
      };
    }

    // Parse the Claude headless JSON response
    console.log('[Weave] DEBUG: Claude stdout length:', claudeResult.stdout.length);
    console.log('[Weave] DEBUG: First 200 chars:', claudeResult.stdout.substring(0, 200));

    const claudeResponse = JSON.parse(claudeResult.stdout);
    console.log('[Weave] DEBUG: Parsed response, type:', claudeResponse.type, 'subtype:', claudeResponse.subtype);

    // Check for errors
    if (claudeResponse.is_error || claudeResponse.subtype !== 'success') {
      console.error('[Weave] Claude returned error:', claudeResponse.result);

      if (claudeResponse.result?.includes('Invalid API key')) {
        console.error('[Weave] ');
        console.error('[Weave] Claude headless needs authentication.');
        console.error('[Weave] Set ANTHROPIC_API_KEY in your environment:');
        console.error('[Weave]   export ANTHROPIC_API_KEY=your-key-here');
        console.error('[Weave] ');
      }

      return {
        ontology: [],
        mereology: [],
        epistemology: [],
        qualia: [],
        processingTimeMs: Date.now() - startTime
      };
    }

    // The actual response is in the "result" field
    const content = claudeResponse.result;
    console.log('[Weave] DEBUG: Result content length:', content.length);

    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = content;
    const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || content.match(/```\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    const extracted = JSON.parse(jsonStr);

    // Now update the actual Weave JSON files
    await updateWeaveFiles(extracted);

    const result: ExtractionResult = {
      ontology: extracted.ontology || [],
      mereology: extracted.mereology || [],
      epistemology: extracted.epistemology || [],
      qualia: extracted.qualia || [],
      processingTimeMs: Date.now() - startTime
    };

    return result;

  } catch (error) {
    console.error('[Weave] Extraction error:', error);
    console.error('[Weave] Error type:', error instanceof Error ? error.constructor.name : typeof error);
    console.error('[Weave] Error message:', error instanceof Error ? error.message : String(error));
    console.error('[Weave] Stack:', error instanceof Error ? error.stack : 'no stack');
    return {
      ontology: [],
      mereology: [],
      epistemology: [],
      qualia: [],
      processingTimeMs: Date.now() - startTime
    };
  }
}

/**
 * Update the Weave JSON files with extracted knowledge
 */
async function updateWeaveFiles(extracted: any): Promise<void> {
  const { readFileSync, writeFileSync } = await import('fs');
  const { join } = await import('path');

  const weavePath = join(process.cwd(), '.agent/weave');

  // Load existing knowledge
  const ontology = JSON.parse(readFileSync(join(weavePath, 'ontology.json'), 'utf-8'));
  const mereology = JSON.parse(readFileSync(join(weavePath, 'mereology.json'), 'utf-8'));
  const epistemology = JSON.parse(readFileSync(join(weavePath, 'epistemology.json'), 'utf-8'));
  const qualia = JSON.parse(readFileSync(join(weavePath, 'qualia.json'), 'utf-8'));
  const causation = JSON.parse(readFileSync(join(weavePath, 'causation.json'), 'utf-8'));
  const axiology = JSON.parse(readFileSync(join(weavePath, 'axiology.json'), 'utf-8'));
  const teleology = JSON.parse(readFileSync(join(weavePath, 'teleology.json'), 'utf-8'));
  const history = JSON.parse(readFileSync(join(weavePath, 'history.json'), 'utf-8'));
  const praxeology = JSON.parse(readFileSync(join(weavePath, 'praxeology.json'), 'utf-8'));
  const modality = JSON.parse(readFileSync(join(weavePath, 'modality.json'), 'utf-8'));
  const deontics = JSON.parse(readFileSync(join(weavePath, 'deontics.json'), 'utf-8'));
  const meta = JSON.parse(readFileSync(join(weavePath, 'meta.json'), 'utf-8'));

  // Merge new knowledge (avoid duplicates by ID)
  if (extracted.ontology) {
    for (const entity of extracted.ontology) {
      if (!ontology.entities[entity.id]) {
        ontology.entities[entity.id] = entity;
      }
    }
  }

  if (extracted.mereology) {
    for (const comp of extracted.mereology) {
      const compId = `${comp.wholeId}-${comp.partId}`;
      if (!mereology.compositions[compId]) {
        mereology.compositions[compId] = comp;
      }
    }
  }

  if (extracted.epistemology) {
    for (const knowledge of extracted.epistemology) {
      if (!epistemology.knowledge[knowledge.id]) {
        epistemology.knowledge[knowledge.id] = knowledge;
      }
    }
  }

  if (extracted.qualia) {
    for (const exp of extracted.qualia) {
      if (exp.type === 'painPoint' && !qualia.painPoints[exp.id]) {
        qualia.painPoints[exp.id] = exp;
      } else if (exp.type === 'workflow' && !qualia.workflows[exp.id]) {
        qualia.workflows[exp.id] = exp;
      } else if (exp.type === 'bestPractice' && !qualia.bestPractices[exp.id]) {
        qualia.bestPractices[exp.id] = exp;
      } else if (exp.type === 'solution' && !qualia.solutions[exp.id]) {
        qualia.solutions[exp.id] = exp;
      }
    }
  }

  // Merge Causation (C)
  if (extracted.causation) {
    for (const causal of extracted.causation) {
      if (causal.type === 'causalChain' && !causation.causalChains[causal.id]) {
        causation.causalChains[causal.id] = causal;
      } else if (causal.type === 'rootCause' && !causation.rootCauses[causal.id]) {
        causation.rootCauses[causal.id] = causal;
      } else if (causal.type === 'mechanism' && !causation.mechanisms[causal.id]) {
        causation.mechanisms[causal.id] = causal;
      }
    }
  }

  // Merge Axiology (A)
  if (extracted.axiology) {
    for (const value of extracted.axiology) {
      if (value.type === 'tradeoff' && !axiology.tradeoffs[value.id]) {
        axiology.tradeoffs[value.id] = value;
      } else if (value.type === 'qualityMetric' && !axiology.qualityMetrics[value.id]) {
        axiology.qualityMetrics[value.id] = value;
      } else if (value.type === 'valueJudgment' && !axiology.valueJudgments[value.id]) {
        axiology.valueJudgments[value.id] = value;
      }
    }
  }

  // Merge Teleology (T)
  if (extracted.teleology) {
    for (const telos of extracted.teleology) {
      if (telos.type === 'purpose' && !teleology.purposes[telos.id]) {
        teleology.purposes[telos.id] = telos;
      } else if (telos.type === 'goal' && !teleology.goals[telos.id]) {
        teleology.goals[telos.id] = telos;
      } else if (telos.type === 'intent' && !teleology.intents[telos.id]) {
        teleology.intents[telos.id] = telos;
      }
    }
  }

  // Merge History (Η)
  if (extracted.history) {
    if (extracted.history.evolutions) {
      for (const evolution of extracted.history.evolutions) {
        if (!history.evolutions[evolution.id]) {
          history.evolutions[evolution.id] = evolution;
        }
      }
    }
    if (extracted.history.timelines) {
      for (const timeline of extracted.history.timelines) {
        if (!history.timelines[timeline.id]) {
          history.timelines[timeline.id] = timeline;
        }
      }
    }
    if (extracted.history.legacyPatterns) {
      for (const pattern of extracted.history.legacyPatterns) {
        if (!history.legacyPatterns[pattern.id]) {
          history.legacyPatterns[pattern.id] = pattern;
        }
      }
    }
  }

  // Merge Praxeology (Π)
  if (extracted.praxeology) {
    if (extracted.praxeology.wowPatterns) {
      for (const pattern of extracted.praxeology.wowPatterns) {
        if (!praxeology.wowPatterns[pattern.id]) {
          praxeology.wowPatterns[pattern.id] = pattern;
        }
      }
    }
    if (extracted.praxeology.delegationStrategies) {
      for (const strategy of extracted.praxeology.delegationStrategies) {
        if (!praxeology.delegationStrategies[strategy.id]) {
          praxeology.delegationStrategies[strategy.id] = strategy;
        }
      }
    }
    if (extracted.praxeology.bestPractices) {
      for (const practice of extracted.praxeology.bestPractices) {
        if (!praxeology.bestPractices[practice.id]) {
          praxeology.bestPractices[practice.id] = practice;
        }
      }
    }
  }

  // Merge Modality (Μ)
  if (extracted.modality) {
    if (extracted.modality.alternatives) {
      for (const alternative of extracted.modality.alternatives) {
        if (!modality.alternatives[alternative.id]) {
          modality.alternatives[alternative.id] = alternative;
        }
      }
    }
    if (extracted.modality.rejectedOptions) {
      for (const rejected of extracted.modality.rejectedOptions) {
        if (!modality.rejectedOptions[rejected.id]) {
          modality.rejectedOptions[rejected.id] = rejected;
        }
      }
    }
    if (extracted.modality.possibleFutures) {
      for (const future of extracted.modality.possibleFutures) {
        if (!modality.possibleFutures[future.id]) {
          modality.possibleFutures[future.id] = future;
        }
      }
    }
  }

  // Merge Deontics (Δ)
  if (extracted.deontics) {
    if (extracted.deontics.obligations) {
      for (const obligation of extracted.deontics.obligations) {
        if (!deontics.obligations[obligation.id]) {
          deontics.obligations[obligation.id] = obligation;
        }
      }
    }
    if (extracted.deontics.permissions) {
      for (const permission of extracted.deontics.permissions) {
        if (!deontics.permissions[permission.id]) {
          deontics.permissions[permission.id] = permission;
        }
      }
    }
    if (extracted.deontics.prohibitions) {
      for (const prohibition of extracted.deontics.prohibitions) {
        if (!deontics.prohibitions[prohibition.id]) {
          deontics.prohibitions[prohibition.id] = prohibition;
        }
      }
    }
  }

  // Update metadata
  meta.stats.totalSessions = (meta.stats.totalSessions || 0) + 1;
  meta.stats.lastUpdate = new Date().toISOString();
  meta.lastUpdated = new Date().toISOString();

  // Write back all dimensions
  writeFileSync(join(weavePath, 'ontology.json'), JSON.stringify(ontology, null, 2));
  writeFileSync(join(weavePath, 'mereology.json'), JSON.stringify(mereology, null, 2));
  writeFileSync(join(weavePath, 'epistemology.json'), JSON.stringify(epistemology, null, 2));
  writeFileSync(join(weavePath, 'qualia.json'), JSON.stringify(qualia, null, 2));
  writeFileSync(join(weavePath, 'causation.json'), JSON.stringify(causation, null, 2));
  writeFileSync(join(weavePath, 'axiology.json'), JSON.stringify(axiology, null, 2));
  writeFileSync(join(weavePath, 'teleology.json'), JSON.stringify(teleology, null, 2));
  writeFileSync(join(weavePath, 'history.json'), JSON.stringify(history, null, 2));
  writeFileSync(join(weavePath, 'praxeology.json'), JSON.stringify(praxeology, null, 2));
  writeFileSync(join(weavePath, 'modality.json'), JSON.stringify(modality, null, 2));
  writeFileSync(join(weavePath, 'deontics.json'), JSON.stringify(deontics, null, 2));
  writeFileSync(join(weavePath, 'meta.json'), JSON.stringify(meta, null, 2));
}