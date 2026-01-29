/**
 * PM2 Ecosystem Configuration for COMMS Daemon
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 stop comms-daemon
 *   pm2 restart comms-daemon
 *   pm2 logs comms-daemon
 *   pm2 save  # persist across reboots
 */
module.exports = {
  apps: [
    {
      name: 'comms-daemon',
      script: 'bin/agent-daemon.ts',
      interpreter: 'bun',
      args: '--env live',
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      exp_backoff_restart_delay: 1000,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
      },
      error_file: 'logs/comms-daemon-error.log',
      out_file: 'logs/comms-daemon-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
