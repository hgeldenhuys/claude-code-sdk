#!/usr/bin/env bun

/**
 * SessionStart Hook - Inject accumulated knowledge into new Claude sessions
 *
 * This hook creates "self-awareness" by loading the cognitive lattice (Q+E+O+M)
 * and priming the new session with distilled, high-confidence knowledge.
 *
 * Goals:
 * 1. Cognitive continuity across sessions
 * 2. Context efficiency (distilled knowledge vs. reading all files)
 * 3. Self-awareness (Claude knows what it learned before)
 * 4. Avoid repeated mistakes (Qualia pain points)
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface SessionStartInput {
  hook_event_name: 'SessionStart';
  session_id: string;
  cwd: string;
  timestamp: string;
  context?: {
    conversationId?: string;
    transactionId?: string;
  };
}

interface KnowledgeBase {
  ontology: any;
  epistemology: any;
  mereology: any;
  qualia: any;
  meta: any;
}

// Safe JSON loader with fallback
function safeLoadJSON(filePath: string, fallback: any = {}): any {
  try {
    if (!existsSync(filePath)) {
      return fallback;
    }
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`[Weave SessionStart] Error loading ${filePath}:`, error instanceof Error ? error.message : String(error));
    return fallback;
  }
}

// Load the cognitive lattice
function loadKnowledgeBase(weavePath: string): KnowledgeBase {
  return {
    ontology: safeLoadJSON(join(weavePath, 'ontology.json'), { entities: {}, relations: {} }),
    epistemology: safeLoadJSON(join(weavePath, 'epistemology.json'), { knowledge: {}, patterns: {} }),
    mereology: safeLoadJSON(join(weavePath, 'mereology.json'), { components: {}, compositions: {} }),
    qualia: safeLoadJSON(join(weavePath, 'qualia.json'), { experiences: {}, painPoints: {} }),
    meta: safeLoadJSON(join(weavePath, 'meta.json'), { stats: {}, health: {} })
  };
}

// Format high-confidence entities (0.85+)
function formatEntities(entities: Record<string, any>): string {
  const highConfidence = Object.values(entities)
    .filter((e: any) => (e.confidence || 0) >= 0.85)
    .slice(0, 10); // Top 10 to keep context lean

  if (highConfidence.length === 0) return '  (No high-confidence entities yet)';

  return highConfidence
    .map((e: any) => `  • **${e.name || e.id}** (${e.type || 'entity'}): ${e.description || 'No description'}`)
    .join('\n');
}

// Format knowledge concepts with confidence >= 0.85
function formatKnowledge(knowledge: Record<string, any>): string {
  const highConfidence = Object.values(knowledge)
    .filter((k: any) => (k.confidence || 0) >= 0.85)
    .slice(0, 8);

  if (highConfidence.length === 0) return '  (No knowledge concepts yet)';

  return highConfidence
    .map((k: any) => {
      const evidence = Array.isArray(k.evidence) ? k.evidence.slice(0, 2).join('; ') : '';
      return `  • **${k.concept}**: ${k.description}\n    ${k.pattern ? `Pattern: \`${k.pattern}\`` : ''}\n    ${evidence ? `Evidence: ${evidence}` : ''}`;
    })
    .join('\n\n');
}

// Format architectural patterns
function formatPatterns(patterns: Record<string, any>): string {
  const allPatterns = Object.values(patterns).flatMap((category: any) =>
    Object.values(category || {})
  );

  const highConfidence = allPatterns
    .filter((p: any) => (p.confidence || 0) >= 0.85)
    .slice(0, 6);

  if (highConfidence.length === 0) return '  (No patterns identified yet)';

  return highConfidence
    .map((p: any) => `  • **${p.name || p.id}**: ${p.description || 'No description'}`)
    .join('\n');
}

// Format pain points (lessons learned the hard way)
function formatPainPoints(painPoints: Record<string, any>): string {
  const points = Object.values(painPoints).slice(0, 5);

  if (points.length === 0) return '  (No pain points recorded yet)';

  return points
    .map((p: any) => `  ⚠️  **${p.name || p.id}**: ${p.description || 'No description'}\n      ${p.resolution ? `Resolution: ${p.resolution}` : ''}`)
    .join('\n\n');
}

// Format best practices
function formatBestPractices(practices: Record<string, any>): string {
  const highValue = Object.values(practices)
    .filter((p: any) => (p.confidence || 0) >= 0.85)
    .slice(0, 6);

  if (highValue.length === 0) return '  (No best practices yet)';

  return highValue
    .map((p: any) => `  ✓ **${p.name || p.id}**: ${p.description || 'No description'}`)
    .join('\n');
}

// Format component compositions
function formatCompositions(compositions: Record<string, any>): string {
  const comps = Object.values(compositions).slice(0, 5);

  if (comps.length === 0) return '  (No compositions documented yet)';

  return comps
    .map((c: any) => {
      const children = Array.isArray(c.children) ? c.children.join(', ') : '';
      return `  • **${c.name || c.id}** → [${children}]`;
    })
    .join('\n');
}

// Generate context injection primer
function generatePrimer(kb: KnowledgeBase): string {
  const { ontology, epistemology, mereology, qualia, meta } = kb;
  const stats = meta.stats || {};
  const health = meta.health || {};

  // Don't inject if knowledge base is empty
  if (stats.totalSessions === 0 || stats.totalEntities === 0) {
    return ''; // No injection needed for first session
  }

  return `
# 🌊 Weave: Project Knowledge Fabric

This project has accumulated knowledge from **${stats.totalSessions} previous sessions**.
System Health: ${Math.round((health.epistemicConfidence || 0) * 100)}% epistemic confidence, ${Math.round((health.ontologyCoverage || 0) * 100)}% ontology coverage.

---

## 🧠 What Exists (Ontology)
${stats.totalEntities || 0} entities identified, ${stats.totalRelations || 0} relations mapped

${formatEntities(ontology.entities || {})}

---

## 📚 How We Know (Epistemology)
${stats.totalKnowledgeConcepts || 0} knowledge concepts, ${stats.totalPatterns || 0} patterns, ${stats.totalValidations || 0} validations

### Knowledge Concepts:
${formatKnowledge(epistemology.knowledge || {})}

### Architectural Patterns:
${formatPatterns(epistemology.patterns || {})}

---

## 🏗️ How It Composes (Mereology)
${stats.totalComponents || 0} components, ${stats.totalCompositions || 0} compositions

${formatCompositions(mereology.compositions || {})}

---

## 🎭 What We've Learned (Qualia)
${stats.totalPainPoints || 0} pain points, experience from ${stats.totalSessions} sessions

### Pain Points (Avoid These):
${formatPainPoints(qualia.painPoints || {})}

### Best Practices:
${formatBestPractices(qualia.bestPractices || {})}

---

**Note**: This knowledge was automatically extracted and validated across multiple sessions. Confidence scores reflect evidence strength and validation history.
`;
}

// Main hook handler
export default async function sessionStartHook(input: SessionStartInput): Promise<{ continue: boolean; message?: string }> {
  const weavePath = join(input.cwd, '.agent/weave');

  // Check if Weave is installed
  if (!existsSync(weavePath)) {
    return { continue: true }; // Weave not installed, no injection
  }

  console.error('[Weave SessionStart] Loading knowledge fabric...');

  try {
    // Load the cognitive lattice
    const kb = loadKnowledgeBase(weavePath);

    // Generate context primer
    const primer = generatePrimer(kb);

    if (primer) {
      console.error(`[Weave SessionStart] Injecting ${kb.meta.stats?.totalSessions || 0} sessions of accumulated knowledge`);
      console.error(`[Weave SessionStart] ${kb.meta.stats?.totalEntities || 0} entities, ${kb.meta.stats?.totalKnowledgeConcepts || 0} concepts, ${kb.meta.stats?.totalPatterns || 0} patterns`);

      // Output the primer to Claude's context
      console.log(primer);
    } else {
      console.error('[Weave SessionStart] No accumulated knowledge yet - this is the first session');
    }

    return {
      continue: true,
      message: primer ? '🌊 Weave: Knowledge fabric loaded' : undefined
    };

  } catch (error) {
    console.error('[Weave SessionStart] Error:', error instanceof Error ? error.message : String(error));
    return { continue: true }; // Don't block session start on errors
  }
}

// Execute if run directly
if (import.meta.main) {
  const input: SessionStartInput = {
    hook_event_name: 'SessionStart',
    session_id: process.env.SESSION_ID || 'test',
    cwd: process.cwd(),
    timestamp: new Date().toISOString()
  };

  sessionStartHook(input).then(result => {
    console.error('[Weave SessionStart] Hook completed:', result);
  });
}
