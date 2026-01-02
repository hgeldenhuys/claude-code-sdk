
import { Database } from 'bun:sqlite';
import type { WeaveKnowledge } from '../types';

export interface TechDebtItem {
  entityId: string;
  name: string;
  painScore: number;    // Normalized 0-1
  churnScore: number;   // Normalized 0-1
  confidence: number;   // 0-1
  riskScore: number;    // Combined metric
}

export interface AlignmentGap {
  goal: string;         // From Teleology
  relatedEntities: number;
  gapSeverity: 'high' | 'medium' | 'low';
}

export interface KnowledgeSilo {
  owner: string;        // SessionID or User
  exclusiveKnowledge: number; // Count of items only known by this source
  riskLevel: string;
}

export interface ZombieCode {
  componentId: string;
  lastTouched: string;
  daysSinceActive: number;
  valueScore: number;   // From Axiology
}

export class WeaveAnalytics {
  private db: Database;

  constructor() {
    this.db = new Database(':memory:');
    this.initializeSchema();
  }

  private initializeSchema() {
    this.db.run(`
      CREATE TABLE entities (
        id TEXT PRIMARY KEY,
        name TEXT,
        type TEXT,
        confidence REAL,
        layer TEXT
      );
    `);

    this.db.run(`
      CREATE TABLE relations (
        source TEXT,
        target TEXT,
        type TEXT,
        confidence REAL
      );
    `);

    this.db.run(`
      CREATE TABLE pain_points (
        id TEXT PRIMARY KEY,
        entity_id TEXT,
        severity INTEGER, -- 1=low, 4=critical
        frequency INTEGER,
        occurrences INTEGER
      );
    `);

    this.db.run(`
      CREATE TABLE history (
        entity_id TEXT,
        date TEXT,
        action TEXT,
        session_id TEXT
      );
    `);

    this.db.run(`
      CREATE TABLE teleology (
        id TEXT PRIMARY KEY,
        goal TEXT,
        confidence REAL
      );
    `);
  }

  async ingest(knowledge: WeaveKnowledge) {
    // 1. Ingest Ontology (Entities)
    const insertEntity = this.db.prepare(
      'INSERT OR REPLACE INTO entities (id, name, type, confidence) VALUES ($id, $name, $type, $confidence)'
    );
    
    // Use a transaction for speed
    const ingestEntities = this.db.transaction((entities) => {
      for (const e of Object.values(entities) as any[]) {
        const confidence = e.provenance?.confidence ?? e.confidence ?? 0.5;
        // @ts-ignore
        insertEntity.run({ $id: e.id, $name: e.name, $type: e.type, $confidence: confidence });
      }
    });
    ingestEntities(knowledge.ontology.entities);

    // 2. Ingest Ontology (Relations)
    const insertRelation = this.db.prepare(
      'INSERT INTO relations (source, target, type, confidence) VALUES ($source, $target, $type, $confidence)'
    );
    const ingestRelations = this.db.transaction((relations) => {
      for (const r of Object.values(relations) as any[]) {
        const source = r.source ?? r.from;
        const target = r.target ?? r.to;
        const confidence = r.provenance?.confidence ?? r.confidence ?? 0.5;
        
        if (source && target) {
          // @ts-ignore
          insertRelation.run({ $source: source, $target: target, $type: r.type, $confidence: confidence });
        }
      }
    });
    ingestRelations(knowledge.ontology.relations);

    // 3. Ingest Qualia (Pain Points)
    const insertPain = this.db.prepare(
      'INSERT OR REPLACE INTO pain_points (id, entity_id, severity, frequency, occurrences) VALUES ($id, $entity_id, $severity, $frequency, $occurrences)'
    );
    const ingestPain = this.db.transaction((pains) => {
      for (const p of Object.values(pains) as any[]) {
        let severity = 1;
        if (p.severity === 'medium') severity = 2;
        if (p.severity === 'high') severity = 3;
        if (p.severity === 'critical') severity = 4;

        // @ts-ignore
        insertPain.run({
          $id: p.id,
          $entity_id: p.concept || 'unknown',
          $severity: severity,
          $frequency: typeof p.frequency === 'number' ? p.frequency : 1, // Simple mapping
          $occurrences: p.occurrences
        });
      }
    });
    ingestPain(knowledge.qualia.painPoints);

    // 4. Ingest History (from Provenance & Confidence History)
    // We mine the Epistemology history to see "churn"
    const insertHistory = this.db.prepare(
      'INSERT INTO history (entity_id, date, action, session_id) VALUES ($entity_id, $date, $action, $session_id)'
    );
    const ingestHistory = this.db.transaction((knowledgeItems) => {
      for (const k of Object.values(knowledgeItems)) {
        // @ts-ignore
        for (const h of k.confidenceHistory) {
          // @ts-ignore
          insertHistory.run({
            // @ts-ignore
            $entity_id: k.concept,
            // @ts-ignore
            $date: h.date,
            $action: 'confidence_update',
            // @ts-ignore
            $session_id: h.source || 'unknown'
          });
        }
      }
    });
    ingestHistory(knowledge.epistemology.knowledge);
  }

  // ==========================================================================
  // Insights & Heatmaps
  // ==========================================================================

  getTechnicalDebtProfile(): TechDebtItem[] {
    // Formula: High Pain + Low Confidence + High Churn (optional)
    // Here we query entities that have associated pain points
    
    const query = this.db.query(`
      SELECT 
        e.id as entityId,
        e.name,
        e.confidence,
        IFNULL(SUM(p.severity * p.occurrences), 0) as painScore,
        COUNT(h.date) as changes
      FROM entities e
      LEFT JOIN pain_points p ON p.entity_id = e.id
      LEFT JOIN history h ON h.entity_id = e.id
      GROUP BY e.id
      HAVING painScore > 0 OR e.confidence < 0.5
      ORDER BY painScore DESC, e.confidence ASC
    `);

    const results = query.all() as any[];

    return results.map(r => ({
      entityId: r.entityId,
      name: r.name,
      painScore: r.painScore,
      churnScore: r.changes,
      confidence: r.confidence,
      // Risk = (Pain * 2) + (1 - Confidence) * 10
      riskScore: (r.painScore * 2) + ((1 - r.confidence) * 10)
    }));
  }

  getKnowledgeSilos(): KnowledgeSilo[] {
    // Who owns the most "exclusive" history?
    const query = this.db.query(`
      SELECT 
        session_id as owner,
        COUNT(DISTINCT entity_id) as touchpoints
      FROM history
      GROUP BY session_id
      ORDER BY touchpoints DESC
      LIMIT 5
    `);

    const results = query.all() as any[];

    return results.map(r => ({
      owner: r.owner,
      exclusiveKnowledge: r.touchpoints,
      riskLevel: r.touchpoints > 10 ? 'high' : 'low'
    }));
  }

  getAlignmentStats() {
    // Simple stat: How many entities are "Orphans" (no relations)?
    const query = this.db.query(`
      SELECT 
        e.id, 
        e.name 
      FROM entities e
      LEFT JOIN relations r ON r.source = e.id OR r.target = e.id
      WHERE r.source IS NULL
    `);
    
    return query.all();
  }

  getZombieCode(): ZombieCode[] {
    // Entities with low confidence, no recent changes (history), but exist
    // Simple heuristic: No history in the table means "old" or "untouched" if we assume history captures all changes.
    // Better: We rely on 'confidence' as a proxy for 'freshness' if history is missing.
    
    const query = this.db.query(`
      SELECT 
        e.id, 
        e.name,
        e.confidence
      FROM entities e
      LEFT JOIN history h ON h.entity_id = e.id
      WHERE h.date IS NULL AND e.confidence < 0.8
    `);
    
    const results = query.all() as any[];
    return results.map(r => ({
      componentId: r.id,
      lastTouched: 'unknown',
      daysSinceActive: 999,
      valueScore: 0
    }));
  }

  close() {
    this.db.close();
  }
}
