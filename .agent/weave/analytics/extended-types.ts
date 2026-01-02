
import type { Provenance, Context, Example, Severity } from '../types';

// ============================================================================
// Ψ (Psyche) - The User Model
// ============================================================================

export interface Psyche {
  userModels: Record<string, UserModel>;
  interactions: Record<string, InteractionPattern>;
  metadata: {
    lastUpdated: string;
    activeUser: string | null;
  };
}

export interface UserModel {
  id: string; // usually matching the git author or system user
  name: string;
  expertise: {
    technical: number; // 0-1
    domain: number;    // 0-1
    preferredLevel: 'architectural' | 'implementation' | 'conceptual';
  };
  communication: {
    verbosity: 'terse' | 'balanced' | 'verbose';
    style: 'socratic' | 'direct' | 'collaborative';
  };
  mentalModels: Record<string, number>; // Concept ID -> Understanding Level (0-1)
  provenance: Provenance;
}

export interface InteractionPattern {
  id: string;
  user: string;
  trigger: string;
  response: string;
  success: boolean;
  timestamp: string;
}

// ============================================================================
// Ο (Oikonomia) - The Resource Economy
// ============================================================================

export interface Oikonomia {
  resources: Record<string, ResourceMetric>;
  budgets: Record<string, Budget>;
  ledger: Transaction[];
  metadata: {
    totalCost: number;
    efficiencyScore: number;
  };
}

export interface ResourceMetric {
  id: string; // e.g., 'context-window', 'api-cost', 'disk-io'
  current: number;
  limit: number;
  unit: string;
  status: 'healthy' | 'warning' | 'critical';
}

export interface Budget {
  id: string; // e.g., 'daily-inference'
  limit: number;
  period: 'session' | 'day' | 'month';
  used: number;
}

export interface Transaction {
  id: string;
  resourceId: string;
  amount: number;
  operation: string;
  timestamp: string;
  sessionId: string;
}

// ============================================================================
// Σ (Semiotics) - The Meaning & Language
// ============================================================================

export interface Semiotics {
  vocabulary: Record<string, Term>;
  ambiguities: Record<string, Ambiguity>;
  metadata: {
    vocabularySize: number;
    ambiguityScore: number; // Lower is better
  };
}

export interface Term {
  id: string;
  token: string; // The actual word, e.g., "User"
  meanings: Meaning[];
  usageCount: number;
  provenance: Provenance;
}

export interface Meaning {
  context: string; // e.g., "AuthModule", "BillingDatabase"
  definition: string;
  relatedEntityId?: string; // Link to Ontology
}

export interface Ambiguity {
  token: string;
  severity: Severity;
  conflictingContexts: string[];
  recommendation?: string;
}
