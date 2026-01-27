/**
 * SignalDB Schema Exports
 *
 * Provides the SQL DDL for creating the SignalDB tables.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * PostgreSQL DDL for all SignalDB tables: agents, channels, messages, pastes.
 * Execute against a PostgreSQL database to create the schema.
 */
export const SCHEMA_SQL = readFileSync(join(import.meta.dir, 'tables.sql'), 'utf-8');
