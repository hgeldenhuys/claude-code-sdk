#!/usr/bin/env bun
/**
 * COMMS Dashboard
 *
 * Real-time TUI dashboard for monitoring Tapestry COMMS.
 *
 * Usage:
 *   comms-dashboard [--env <env>]
 *
 * Controls:
 *   Tab      - Switch focus between panels
 *   r        - Refresh data
 *   q/Esc    - Quit
 *   h        - Toggle help
 */

import blessed from 'blessed';
import { SignalDBClient } from '../src/comms/client/signaldb';
import {
  loadTapestryConfig,
  getEnvironmentConfig,
  type TapestryEnvironment,
} from '../src/comms/config/environments';
import type { Agent, Channel, Message } from '../src/comms/protocol/types';
import { derivePresence } from '../src/comms/protocol/presence';

// ============================================================================
// Argument Parsing
// ============================================================================

function getFlag(args: string[], flag: string): boolean {
  return args.includes(`--${flag}`) || args.includes(`-${flag.charAt(0)}`);
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const index = args.findIndex(a => a === `--${flag}` || a === `-${flag.charAt(0)}`);
  if (index !== -1 && index < args.length - 1) {
    return args[index + 1];
  }
  return undefined;
}

function getEnv(args: string[]): TapestryEnvironment {
  const env = getFlagValue(args, 'env');
  if (env && ['dev', 'test', 'live'].includes(env)) {
    return env as TapestryEnvironment;
  }
  return 'dev';
}

// ============================================================================
// Dashboard State
// ============================================================================

interface DashboardState {
  client: SignalDBClient;
  env: TapestryEnvironment;
  apiUrl: string;
  agents: Agent[];
  channels: Channel[];
  messages: Message[];
  lastRefresh: Date;
  refreshInterval: number;
  showHelp: boolean;
  error: string | null;
}

// ============================================================================
// Dashboard UI
// ============================================================================

async function createDashboard(env: TapestryEnvironment): Promise<void> {
  // Setup state
  const envConfig = getEnvironmentConfig(env);
  const client = new SignalDBClient({
    apiUrl: envConfig.apiUrl,
    projectKey: envConfig.projectKey,
  });

  const state: DashboardState = {
    client,
    env,
    apiUrl: envConfig.apiUrl,
    agents: [],
    channels: [],
    messages: [],
    lastRefresh: new Date(),
    refreshInterval: 5000,
    showHelp: false,
    error: null,
  };

  // Create screen
  const screen = blessed.screen({
    smartCSR: true,
    title: `Tapestry Dashboard - ${env}`,
    fullUnicode: true,
  });

  // Header
  const header = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    height: 3,
    content: '',
    tags: true,
    border: { type: 'line' },
    style: {
      fg: 'white',
      border: { fg: 'cyan' },
    },
  });

  // Agents panel
  const agentsBox = blessed.box({
    parent: screen,
    label: ' Agents ',
    top: 3,
    left: 0,
    width: '100%',
    height: '40%',
    border: { type: 'line' },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: '|',
      style: { fg: 'cyan' },
    },
    keys: true,
    vi: true,
    mouse: true,
    tags: true,
    style: {
      fg: 'white',
      border: { fg: 'blue' },
      focus: { border: { fg: 'cyan' } },
    },
  });

  // Channels panel
  const channelsBox = blessed.box({
    parent: screen,
    label: ' Channels ',
    top: '43%',
    left: 0,
    width: '50%',
    height: '30%',
    border: { type: 'line' },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: '|',
      style: { fg: 'cyan' },
    },
    keys: true,
    vi: true,
    mouse: true,
    tags: true,
    style: {
      fg: 'white',
      border: { fg: 'green' },
      focus: { border: { fg: 'cyan' } },
    },
  });

  // Messages panel
  const messagesBox = blessed.box({
    parent: screen,
    label: ' Recent Messages ',
    top: '43%',
    left: '50%',
    width: '50%',
    height: '30%',
    border: { type: 'line' },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: '|',
      style: { fg: 'cyan' },
    },
    keys: true,
    vi: true,
    mouse: true,
    tags: true,
    style: {
      fg: 'white',
      border: { fg: 'yellow' },
      focus: { border: { fg: 'cyan' } },
    },
  });

  // Stats bar
  const statsBar = blessed.box({
    parent: screen,
    bottom: 3,
    left: 0,
    width: '100%',
    height: 3,
    border: { type: 'line' },
    tags: true,
    style: {
      fg: 'white',
      border: { fg: 'magenta' },
    },
  });

  // Status bar
  const statusBar = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 3,
    border: { type: 'line' },
    content: ' {cyan-fg}Tab{/cyan-fg}: Switch panels | {cyan-fg}r{/cyan-fg}: Refresh | {cyan-fg}h{/cyan-fg}: Help | {cyan-fg}q{/cyan-fg}: Quit ',
    tags: true,
    style: {
      fg: 'white',
      border: { fg: 'gray' },
    },
  });

  // Help overlay
  const helpBox = blessed.box({
    parent: screen,
    top: 'center',
    left: 'center',
    width: 50,
    height: 15,
    hidden: true,
    border: { type: 'line' },
    label: ' Help ',
    tags: true,
    content: `
  {bold}Tapestry Dashboard Controls{/bold}

  {cyan-fg}Tab{/cyan-fg}      Switch focus between panels
  {cyan-fg}j/k{/cyan-fg}      Scroll within focused panel
  {cyan-fg}r{/cyan-fg}        Refresh data
  {cyan-fg}h{/cyan-fg}        Toggle this help
  {cyan-fg}q/Esc{/cyan-fg}    Quit

  Data refreshes every ${state.refreshInterval / 1000}s automatically.
`,
    style: {
      fg: 'white',
      bg: 'black',
      border: { fg: 'cyan' },
    },
  });

  // Update functions
  function updateHeader(): void {
    const envColor = state.env === 'live' ? 'red' : state.env === 'test' ? 'yellow' : 'green';
    header.setContent(
      `  {bold}TAPESTRY DASHBOARD{/bold}                    ` +
      `{${envColor}-fg}${state.env.toUpperCase()}{/${envColor}-fg}  |  ` +
      `{cyan-fg}${state.apiUrl}{/cyan-fg}  |  ` +
      `Last refresh: {white-fg}${state.lastRefresh.toLocaleTimeString()}{/white-fg}`
    );
  }

  function updateAgents(): void {
    if (state.agents.length === 0) {
      agentsBox.setContent('  {gray-fg}No agents connected{/gray-fg}');
      return;
    }

    const lines: string[] = [];
    lines.push(
      '  {bold}Status{/bold}   {bold}Name{/bold}            {bold}Machine{/bold}         {bold}Project{/bold}'
    );
    lines.push('  ' + '─'.repeat(65));

    for (const agent of state.agents) {
      const presence = derivePresence(agent.heartbeatAt);
      let icon: string;
      let color: string;

      switch (presence) {
        case 'active':
          icon = '{green-fg}●{/green-fg}';
          color = 'white';
          break;
        case 'idle':
          icon = '{yellow-fg}●{/yellow-fg}';
          color = 'gray';
          break;
        default:
          icon = '{red-fg}○{/red-fg}';
          color = 'gray';
      }

      const name = (agent.sessionName || 'unnamed').slice(0, 15).padEnd(15);
      const machine = agent.machineId.slice(0, 15).padEnd(15);
      const project = (agent.projectPath || '').slice(0, 25);

      lines.push(`  ${icon} ${presence.padEnd(8)} {${color}-fg}${name}{/${color}-fg} ${machine} ${project}`);
    }

    agentsBox.setContent(lines.join('\n'));
  }

  function updateChannels(): void {
    if (state.channels.length === 0) {
      channelsBox.setContent('  {gray-fg}No channels{/gray-fg}');
      return;
    }

    const lines: string[] = [];
    for (const channel of state.channels) {
      const memberCount = channel.members?.length || 0;
      const typeIcon = channel.type === 'broadcast' ? '{yellow-fg}##{/yellow-fg}' : '{blue-fg}#{/blue-fg}';
      lines.push(`  ${typeIcon} {white-fg}${channel.name}{/white-fg} ({cyan-fg}${memberCount}{/cyan-fg} members)`);
    }

    channelsBox.setContent(lines.join('\n'));
  }

  function updateMessages(): void {
    if (state.messages.length === 0) {
      messagesBox.setContent('  {gray-fg}No recent messages{/gray-fg}');
      return;
    }

    const lines: string[] = [];
    for (const msg of state.messages.slice(0, 10)) {
      const time = new Date(msg.createdAt).toLocaleTimeString();
      const content = msg.content.slice(0, 30);
      const type = msg.messageType === 'memo' ? '{magenta-fg}memo{/magenta-fg}' : '{blue-fg}chat{/blue-fg}';
      lines.push(`  {gray-fg}${time}{/gray-fg} ${type} ${content}`);
    }

    messagesBox.setContent(lines.join('\n'));
  }

  function updateStats(): void {
    const activeAgents = state.agents.filter(a => derivePresence(a.heartbeatAt) === 'active').length;
    const idleAgents = state.agents.filter(a => derivePresence(a.heartbeatAt) === 'idle').length;
    const offlineAgents = state.agents.filter(a => derivePresence(a.heartbeatAt) === 'offline').length;

    const errorMsg = state.error ? `  {red-fg}Error: ${state.error}{/red-fg}` : '';

    statsBar.setContent(
      `  Agents: {green-fg}${activeAgents} active{/green-fg} | ` +
      `{yellow-fg}${idleAgents} idle{/yellow-fg} | ` +
      `{red-fg}${offlineAgents} offline{/red-fg}  |  ` +
      `Channels: {cyan-fg}${state.channels.length}{/cyan-fg}  |  ` +
      `Messages: {cyan-fg}${state.messages.length}{/cyan-fg}${errorMsg}`
    );
  }

  function updateAll(): void {
    updateHeader();
    updateAgents();
    updateChannels();
    updateMessages();
    updateStats();
    screen.render();
  }

  // Fetch data
  async function fetchData(): Promise<void> {
    try {
      state.error = null;

      // Fetch agents
      state.agents = await state.client.agents.list();

      // Fetch channels
      state.channels = await state.client.channels.list();

      // Fetch recent messages (from first channel if any)
      const firstChannel = state.channels[0];
      if (firstChannel) {
        state.messages = await state.client.messages.listByChannel(
          firstChannel.id,
          { limit: 10 }
        );
      } else {
        state.messages = [];
      }

      state.lastRefresh = new Date();
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
    }

    updateAll();
  }

  // Key bindings
  screen.key(['escape', 'q', 'C-c'], () => {
    process.exit(0);
  });

  screen.key(['r'], () => {
    fetchData();
  });

  screen.key(['h'], () => {
    state.showHelp = !state.showHelp;
    if (state.showHelp) {
      helpBox.show();
    } else {
      helpBox.hide();
    }
    screen.render();
  });

  // Track current focus
  let currentFocus: 'agents' | 'channels' | 'messages' = 'agents';

  screen.key(['tab'], () => {
    // Cycle focus
    if (currentFocus === 'agents') {
      channelsBox.focus();
      currentFocus = 'channels';
    } else if (currentFocus === 'channels') {
      messagesBox.focus();
      currentFocus = 'messages';
    } else {
      agentsBox.focus();
      currentFocus = 'agents';
    }
  });

  // Initial focus
  agentsBox.focus();

  // Initial fetch
  await fetchData();

  // Auto-refresh
  const refreshTimer = setInterval(fetchData, state.refreshInterval);

  // Cleanup on exit
  process.on('exit', () => {
    clearInterval(refreshTimer);
  });

  // Render
  screen.render();
}

// ============================================================================
// Help
// ============================================================================

function showHelp(): void {
  console.log(`
COMMS Dashboard - Real-time Tapestry monitoring

Usage:
  comms-dashboard [--env <env>]

Options:
  --env <env>   Target environment: dev | test | live (default: dev)
  --help, -h    Show this help message

Controls:
  Tab           Switch focus between panels
  j/k           Scroll within focused panel
  r             Refresh data
  h             Toggle help overlay
  q/Esc         Quit

Examples:
  comms-dashboard
  comms-dashboard --env test
  comms-dashboard --env live
`);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (getFlag(args, 'help') || getFlag(args, 'h')) {
    showHelp();
    return;
  }

  const env = getEnv(args);

  try {
    // Verify environment is configured
    getEnvironmentConfig(env);
  } catch (error) {
    console.error(`Error: Cannot connect to ${env} environment.`);
    console.error('Make sure .env.tapestry is configured with valid credentials.');
    process.exit(1);
  }

  await createDashboard(env);
}

main().catch(error => {
  console.error(`Fatal error: ${error}`);
  process.exit(1);
});
