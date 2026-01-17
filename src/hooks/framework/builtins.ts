/**
 * Built-in Handlers
 *
 * Re-export from handlers module for backward compatibility.
 * Tests may import from this module.
 */

// Re-export everything from handlers
export * from './handlers';

// Additional convenience aliases for common handlers
export { createSessionNamingHandler as sessionNamingHandler } from './handlers/session-naming';
export { createDangerousCommandGuardHandler as dangerousCommandGuardHandler } from './handlers/dangerous-command-guard';
export { createContextInjectionHandler as contextInjectionHandler } from './handlers/context-injection';
export { createToolLoggerHandler as toolLoggerHandler } from './handlers/tool-logger';
