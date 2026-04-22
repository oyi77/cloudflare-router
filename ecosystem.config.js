module.exports = {
    apps: [
        {
            name: 'cloudflare-router',
            script: 'src/server.js',
            cwd: '/home/openclaw/.cloudflare-router/',
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '512M',
            env: {
                NODE_ENV: 'production',
                PORT: 7070
            },
            error_file: 'logs/pm2-error.log',
            out_file: 'logs/pm2-out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
            merge_logs: true,
            restart_delay: 1000,
            max_restarts: 10,
            exp_backoff_restart_delay: 100
        },
        {
            name: 'cf-router-watcher',
            script: 'src/watcher.js',
            cwd: '/home/openclaw/.cloudflare-router/',
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '256M',
            env: {
                NODE_ENV: 'production'
            },
            error_file: 'logs/watcher-error.log',
            out_file: 'logs/watcher-out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
            merge_logs: true,
            restart_delay: 1000,
            max_restarts: 10,
            exp_backoff_restart_delay: 100
        }
    ]
};
