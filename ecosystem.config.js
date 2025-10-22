module.exports = {
  apps: [{
    name: 'wasender-migration',
    script: 'src/index.js',
    instances: process.env.PM2_INSTANCES || 'max',
    exec_mode: 'cluster',
    max_memory_restart: process.env.PM2_MAX_MEMORY_RESTART || '1000M',
    log_date_format: process.env.PM2_LOG_DATE_FORMAT || 'YYYY-MM-DD HH:mm:ss Z',
    error_file: '/var/log/wasender-migration/pm2-error.log',
    out_file: '/var/log/wasender-migration/pm2-out.log',
    log_file: '/var/log/wasender-migration/pm2-combined.log',
    time: true,
    autorestart: true,
    watch: false,
    max_restarts: 10,
    min_uptime: '10s',
    
    // Environment variables for production
    env: {
      NODE_ENV: 'development',
      PORT: 3000
    },
    
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    
    // Health monitoring
    health_check_grace_period: 3000,
    health_check_fatal_exceptions: true,
    
    // Advanced PM2 features
    node_args: '--expose-gc --max-old-space-size=2048',
    
    // Graceful shutdown
    kill_timeout: 5000,
    listen_timeout: 3000,
    
    // Log rotation
    log_type: 'json',
    merge_logs: true,
    
    // Monitoring
    pmx: true,
    
    // Restart conditions
    restart_delay: 4000,
    exponential_backoff_restart_delay: 100
  }],

  deploy: {
    production: {
      user: 'deploy',
      host: ['your-production-server.com'],
      ref: 'origin/main',
      repo: 'git@github.com:your-username/wasender-migration.git',
      path: '/var/www/wasender-migration',
      'pre-deploy-local': '',
      'post-deploy': 'npm install && pm2 reload ecosystem.config.js --env production',
      'pre-setup': '',
      'ssh_options': 'StrictHostKeyChecking=no'
    }
  }
};