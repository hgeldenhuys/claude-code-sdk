/**
 * Weave Dimensions - Layer 3 Interface Implementations
 *
 * This module exports all dimension implementations for the
 * 17-dimensional Cortical Knowledge Framework.
 *
 * @module weave/dimensions
 */

// Psyche (Psi) - User Model
export {
  PsycheManagerImpl,
  createPsycheManager,
  createInitialPsyche,
  inferMood,
  inferVerbosity,
  calculateDecay,
  applyHalfLifeDecay,
  analyzeProfile,
  mergeProfiles,
  type PsycheManager,
  type ExpertiseEvidence,
  type PreferenceUpdate,
  type MoodSignals
} from './psyche';

// Re-export types from main types module for convenience
export type {
  Psyche,
  UserProfile,
  VolatileState,
  ExpertiseLevel,
  UserMood,
  PreferredMode,
  Verbosity,
  PsycheMetadata
} from '../types';
