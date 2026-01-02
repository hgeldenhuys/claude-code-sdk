#!/usr/bin/env bun

/**
 * SessionEnd Hook - Capture conversational insights from Claude's memory
 *
 * This hook runs when a Claude Code session ends and captures ephemeral knowledge
 * that exists in the conversation but not in files:
 * - Design decisions and rationale
 * - Pain points encountered and resolutions
 * - Trade-offs made and why
 * - Failed approaches and lessons learned
 * - User preferences revealed
 * - Implicit project knowledge
 *
 * This transforms Weave from capturing "what exists in files" to "what we learned through experience"
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import Anthropic from '@anthropic-ai/sdk';

interface SessionEndInput {
  hook_event_name: 'SessionEnd';
  session_id: string;
  cwd: string;
  timestamp: string;
  context?: {
    conversationId?: string;
    transactionId?: string;
    editedFiles?: string[];
  };
}

interface ConversationalInsight {
  type: 'design-decision' | 'pain-point' | 'trade-off' | 'failed-approach' | 'user-preference' | 'best-practice';
  title: string;
  description: string;
  rationale?: string;
  context?: string;
  resolution?: string;
  lesson?: string;
  evidence?: string[];
  confidence: number;
  timestamp: string;
  sessionId: string;
}

interface SessionInsights {
  sessionId: string;
  timestamp: string;
  insights: ConversationalInsight[];
  summary: string;
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
    console.error(`[Weave SessionEnd] Error loading ${filePath}:`, error instanceof Error ? error.message : String(error));
    return fallback;
  }
}

// Extract conversational insights using Claude
async function extractConversationalInsights(
  sessionId: string,
  cwd: string
): Promise<SessionInsights | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.error('[Weave SessionEnd] ANTHROPIC_API_KEY not set, skipping insight extraction');
    return null;
  }

  // Note: This is a placeholder implementation
  // In reality, we need access to the conversation history to extract insights
  // Claude Code SessionEnd hook doesn't provide conversation context yet
  // For now, we'll extract insights from git commits and changed files

  try {
    // Get recent commit messages for context
    const { spawnSync } = await import('child_process');
    const gitLog = spawnSync('git', ['log', '-1', '--pretty=format:%s%n%b'], {
      cwd,
      encoding: 'utf-8'
    });

    const commitMessage = gitLog.stdout || '';

    // Get changed files
    const gitDiff = spawnSync('git', ['diff', '--name-only', 'HEAD~1'], {
      cwd,
      encoding: 'utf-8'
    });

    const changedFiles = gitDiff.stdout.split('\n').filter(f => f.trim());

    if (!commitMessage && changedFiles.length === 0) {
      console.error('[Weave SessionEnd] No commit or changes to analyze');
      return null;
    }

    const anthropic = new Anthropic({ apiKey });

    // Prompt Claude to extract insights from commit/changes
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `You are analyzing a completed Claude Code development session. Based on the commit message and changed files below, extract key insights that should be preserved for future sessions.

**Commit Message:**
${commitMessage || '(No commit message)'}

**Changed Files:**
${changedFiles.slice(0, 20).join('\n') || '(No files changed)'}

Extract insights from this development work.

Focus on capturing:

1. **Design Decisions**: What architectural or implementation choices were made and WHY
   - Example: "Chose manual validation over Zod to preserve MoneyWorks domain purity"

2. **Pain Points**: What went wrong, what caused it, how we fixed it
   - Example: "JSON corruption in epistemology.json due to missing error handling in JSON.parse"

3. **Trade-offs**: What we accepted and why
   - Example: "Accepted increased complexity in validation for better error messages"

4. **Failed Approaches**: What we tried that didn't work and why
   - Example: "Tried async extraction but caused race conditions with file writes"

5. **User Preferences**: What the user explicitly prefers or wants
   - Example: "User wants validation errors to match MoneyWorks manual terminology exactly"

6. **Best Practices**: Patterns or approaches that worked well
   - Example: "Always wrap JSON parsing with safeLoadJSON for error handling"

For each insight, provide:
- type: design-decision | pain-point | trade-off | failed-approach | user-preference | best-practice
- title: Short descriptive title (5-10 words)
- description: Clear explanation (1-2 sentences)
- rationale/resolution/lesson: Context-appropriate detail
- confidence: 0.0-1.0 based on evidence strength
- evidence: Specific quotes or references from conversation

Also provide a 2-3 sentence summary of what was accomplished this session.

Return ONLY valid JSON in this exact format:
{
  "insights": [
    {
      "type": "design-decision",
      "title": "...",
      "description": "...",
      "rationale": "...",
      "confidence": 0.95,
      "evidence": ["quote1", "quote2"]
    }
  ],
  "summary": "..."
}

If there are no significant insights worth capturing, return:
{
  "insights": [],
  "summary": "Session with no significant learnings to preserve"
}

Now analyze THIS session and extract insights.`
      }]
    });

    // Parse Claude's response
    const content = response.content[0];
    if (content.type !== 'text') {
      console.error('[Weave SessionEnd] Unexpected response type');
      return null;
    }

    // Extract JSON from response (may be wrapped in markdown)
    let jsonText = content.text;
    const jsonMatch = jsonText.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1];
    }

    const extracted = JSON.parse(jsonText);

    return {
      sessionId,
      timestamp: new Date().toISOString(),
      insights: extracted.insights.map((i: any) => ({
        ...i,
        timestamp: new Date().toISOString(),
        sessionId
      })),
      summary: extracted.summary
    };

  } catch (error) {
    console.error('[Weave SessionEnd] Failed to extract insights:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

// Merge insights into qualia.json
function mergeInsightsIntoQualia(
  weavePath: string,
  sessionInsights: SessionInsights
): void {
  const qualiaPath = join(weavePath, 'qualia.json');
  const qualia = safeLoadJSON(qualiaPath, {
    experiences: {},
    painPoints: {},
    bestPractices: {},
    designDecisions: {},
    userPreferences: {},
    metadata: {
      totalExperiences: 0,
      totalPainPoints: 0,
      totalBestPractices: 0,
      totalDesignDecisions: 0,
      totalUserPreferences: 0
    }
  });

  // Add session summary to experiences
  const expId = `exp-${sessionInsights.sessionId}`;
  qualia.experiences[expId] = {
    id: expId,
    sessionId: sessionInsights.sessionId,
    timestamp: sessionInsights.timestamp,
    summary: sessionInsights.summary,
    insightCount: sessionInsights.insights.length,
    confidence: sessionInsights.insights.length > 0
      ? sessionInsights.insights.reduce((sum, i) => sum + i.confidence, 0) / sessionInsights.insights.length
      : 0
  };

  // Merge insights by type
  for (const insight of sessionInsights.insights) {
    const id = `${insight.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    switch (insight.type) {
      case 'pain-point':
        qualia.painPoints[id] = {
          id,
          name: insight.title,
          description: insight.description,
          resolution: insight.resolution,
          lesson: insight.lesson,
          sessionId: insight.sessionId,
          timestamp: insight.timestamp,
          confidence: insight.confidence,
          evidence: insight.evidence
        };
        break;

      case 'best-practice':
        qualia.bestPractices[id] = {
          id,
          name: insight.title,
          description: insight.description,
          rationale: insight.rationale,
          sessionId: insight.sessionId,
          timestamp: insight.timestamp,
          confidence: insight.confidence,
          evidence: insight.evidence
        };
        break;

      case 'design-decision':
        if (!qualia.designDecisions) qualia.designDecisions = {};
        qualia.designDecisions[id] = {
          id,
          name: insight.title,
          description: insight.description,
          rationale: insight.rationale,
          context: insight.context,
          sessionId: insight.sessionId,
          timestamp: insight.timestamp,
          confidence: insight.confidence,
          evidence: insight.evidence
        };
        break;

      case 'user-preference':
        if (!qualia.userPreferences) qualia.userPreferences = {};
        qualia.userPreferences[id] = {
          id,
          name: insight.title,
          description: insight.description,
          context: insight.context,
          sessionId: insight.sessionId,
          timestamp: insight.timestamp,
          confidence: insight.confidence,
          evidence: insight.evidence
        };
        break;

      case 'trade-off':
      case 'failed-approach':
        // These go into experiences as specific learnings
        qualia.experiences[id] = {
          id,
          type: insight.type,
          name: insight.title,
          description: insight.description,
          lesson: insight.lesson,
          sessionId: insight.sessionId,
          timestamp: insight.timestamp,
          confidence: insight.confidence,
          evidence: insight.evidence
        };
        break;
    }
  }

  // Update metadata
  qualia.metadata.totalExperiences = Object.keys(qualia.experiences).length;
  qualia.metadata.totalPainPoints = Object.keys(qualia.painPoints).length;
  qualia.metadata.totalBestPractices = Object.keys(qualia.bestPractices).length;
  qualia.metadata.totalDesignDecisions = Object.keys(qualia.designDecisions || {}).length;
  qualia.metadata.totalUserPreferences = Object.keys(qualia.userPreferences || {}).length;
  qualia.metadata.lastUpdated = new Date().toISOString();

  // Save updated qualia
  writeFileSync(qualiaPath, JSON.stringify(qualia, null, 2), 'utf-8');

  console.error(`[Weave SessionEnd] Merged ${sessionInsights.insights.length} insights into qualia`);
}

// Update meta.json with session insights
function updateMetaStats(weavePath: string, sessionInsights: SessionInsights): void {
  const metaPath = join(weavePath, 'meta.json');
  const meta = safeLoadJSON(metaPath, {
    stats: {},
    health: {}
  });

  // Increment session count
  meta.stats.totalSessions = (meta.stats.totalSessions || 0) + 1;

  // Update qualia stats
  meta.stats.totalPainPoints = (meta.stats.totalPainPoints || 0) +
    sessionInsights.insights.filter(i => i.type === 'pain-point').length;

  meta.stats.totalBestPractices = (meta.stats.totalBestPractices || 0) +
    sessionInsights.insights.filter(i => i.type === 'best-practice').length;

  meta.lastUpdated = new Date().toISOString();

  writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
}

// Main hook handler
export default async function sessionEndHook(input: SessionEndInput): Promise<{ continue: boolean; message?: string }> {
  const weavePath = join(input.cwd, '.agent/weave');

  // Check if Weave is installed
  if (!existsSync(weavePath)) {
    return { continue: true }; // Weave not installed, no insight capture
  }

  console.error('[Weave SessionEnd] Capturing conversational insights...');

  try {
    // Extract insights from the session conversation
    const sessionInsights = await extractConversationalInsights(input.session_id, input.cwd);

    if (!sessionInsights) {
      console.error('[Weave SessionEnd] No insights extracted (API unavailable or failed)');
      return { continue: true };
    }

    if (sessionInsights.insights.length === 0) {
      console.error('[Weave SessionEnd] No significant insights to capture this session');
      return { continue: true };
    }

    // Merge insights into qualia
    mergeInsightsIntoQualia(weavePath, sessionInsights);

    // Update meta stats
    updateMetaStats(weavePath, sessionInsights);

    console.error(`[Weave SessionEnd] ✅ Captured ${sessionInsights.insights.length} conversational insights`);
    console.error(`[Weave SessionEnd] Session summary: ${sessionInsights.summary}`);

    return {
      continue: true,
      message: `🌊 Weave: Captured ${sessionInsights.insights.length} insights from session`
    };

  } catch (error) {
    console.error('[Weave SessionEnd] Error:', error instanceof Error ? error.message : String(error));
    return { continue: true }; // Don't block session end on errors
  }
}

// Execute if run directly (for testing)
if (import.meta.main) {
  const input: SessionEndInput = {
    hook_event_name: 'SessionEnd',
    session_id: process.env.SESSION_ID || 'test',
    cwd: process.cwd(),
    timestamp: new Date().toISOString()
  };

  sessionEndHook(input).then(result => {
    console.error('[Weave SessionEnd] Hook completed:', result);
  });
}
