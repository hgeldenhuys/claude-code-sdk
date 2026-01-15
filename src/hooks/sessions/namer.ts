/**
 * Session Name Generator
 *
 * Generates human-friendly names in the pattern: adjective-noun
 * Handles collisions with counters and timestamp fallback.
 */

import type { NameGeneratorConfig } from './types';

// ============================================================================
// Default Dictionaries
// ============================================================================

const DEFAULT_ADJECTIVES = [
  'brave',
  'swift',
  'happy',
  'calm',
  'bright',
  'clever',
  'eager',
  'gentle',
  'jolly',
  'kind',
  'lively',
  'merry',
  'noble',
  'proud',
  'quick',
  'quiet',
  'sharp',
  'smart',
  'steady',
  'strong',
  'sunny',
  'tender',
  'warm',
  'wise',
  'agile',
  'bold',
  'cosmic',
  'daring',
  'earnest',
  'fair',
  'golden',
  'honest',
  'keen',
  'lucky',
  'mighty',
  'neat',
  'peaceful',
  'radiant',
  'serene',
  'trusty',
  'valiant',
  'witty',
  'zealous',
  'amber',
  'azure',
  'coral',
  'crimson',
  'emerald',
  'ivory',
  'jade',
  'ruby',
  'silver',
  'violet',
  'crystal',
  'misty',
  'stellar',
];

const DEFAULT_NOUNS = [
  'elephant',
  'falcon',
  'tiger',
  'dolphin',
  'phoenix',
  'dragon',
  'panther',
  'eagle',
  'wolf',
  'bear',
  'lion',
  'hawk',
  'owl',
  'raven',
  'fox',
  'deer',
  'horse',
  'whale',
  'shark',
  'otter',
  'badger',
  'heron',
  'crane',
  'swan',
  'lynx',
  'puma',
  'cobra',
  'viper',
  'python',
  'condor',
  'osprey',
  'jaguar',
  'cheetah',
  'gazelle',
  'antelope',
  'buffalo',
  'bison',
  'moose',
  'elk',
  'squid',
  'octopus',
  'mantis',
  'beetle',
  'hornet',
  'wasp',
  'spider',
  'scorpion',
  'coyote',
  'jackal',
  'hyena',
  'leopard',
  'ocelot',
  'mongoose',
];

// ============================================================================
// Name Generator
// ============================================================================

export class NameGenerator {
  private adjectives: string[];
  private nouns: string[];
  private separator: string;
  private maxCollisionAttempts: number;

  constructor(config: NameGeneratorConfig = {}) {
    this.adjectives = config.adjectives ?? DEFAULT_ADJECTIVES;
    this.nouns = config.nouns ?? DEFAULT_NOUNS;
    this.separator = config.separator ?? '-';
    this.maxCollisionAttempts = config.maxCollisionAttempts ?? 100;
  }

  /**
   * Generate a random name
   */
  generate(): string {
    const adj = this.adjectives[Math.floor(Math.random() * this.adjectives.length)];
    const noun = this.nouns[Math.floor(Math.random() * this.nouns.length)];
    return `${adj}${this.separator}${noun}`;
  }

  /**
   * Generate a unique name that doesn't collide with existing names
   */
  generateUnique(existingNames: Set<string>): string {
    // Try basic generation first
    let name = this.generate();
    if (!existingNames.has(name)) {
      return name;
    }

    // Try with counter
    const baseName = name;
    for (let i = 2; i <= this.maxCollisionAttempts; i++) {
      name = `${baseName}${this.separator}${i}`;
      if (!existingNames.has(name)) {
        return name;
      }
    }

    // Fallback to timestamp
    return `${baseName}${this.separator}${Date.now()}`;
  }

  /**
   * Validate a name format
   */
  isValidName(name: string): boolean {
    // Allow: lowercase letters, numbers, hyphens
    // Must start with letter, not end with hyphen
    return /^[a-z][a-z0-9-]*[a-z0-9]$/.test(name) || /^[a-z]$/.test(name);
  }

  /**
   * Normalize a name to valid format
   */
  normalizeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let defaultGenerator: NameGenerator | null = null;

export function getNameGenerator(config?: NameGeneratorConfig): NameGenerator {
  if (!defaultGenerator || config) {
    defaultGenerator = new NameGenerator(config);
  }
  return defaultGenerator;
}

export function generateName(): string {
  return getNameGenerator().generate();
}

export function generateUniqueName(existingNames: Set<string>): string {
  return getNameGenerator().generateUnique(existingNames);
}
