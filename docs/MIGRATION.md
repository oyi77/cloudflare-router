# Migration Guide: Systemd to PM2

This guide describes how to migrate the Cloudflare Router service from systemd to PM2 for better process management and stability.

## Prerequisites

- Node.js installed
- PM2 installed globally: `npm install -g pm2`

## Migration Steps

1. **Stop the existing systemd service**:
   ```bash
   sudo systemctl stop cloudflare-router
   sudo systemctl disable cloudflare-router
   ```

2. **Start the service with PM2**:
   Navigate to the project directory and run:
   ```bash
   npm run pm2:start
   ```

3. **Verify the service is running**:
   ```bash
   npm run pm2:logs
   ```
   Or use the monitor:
   ```bash
   npm run pm2:monit
   ```

4. **Persist the process list**:
   To ensure the service starts on reboot:
   ```bash
   npm run pm2:startup
   # Follow the instructions provided by the command above
   npm run pm2:save
   ```

## Rollback Steps

If you need to switch back to systemd:

1. **Stop the PM2 process**:
   ```bash
   npm run pm2:stop
   pm2 delete cloudflare-router
   pm2 save
   ```

2. **Re-enable the systemd service**:
   ```bash
   sudo systemctl enable cloudflare-router
   sudo systemctl start cloudflare-router
   ```

## Advantages of PM2

- **Auto-restart**: PM2 will automatically restart the app if it crashes.
- **Log Management**: Built-in log rotation and easy access to logs.
- **Resource Monitoring**: Real-time CPU and memory usage monitoring.
- **Hot Reload**: Reload the app without downtime.
