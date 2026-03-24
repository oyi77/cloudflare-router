const path = require('path');
const fs = require('fs');

process.env.HOME = path.join(__dirname, 'fixtures', 'home');

const configDir = path.join(process.env.HOME, '.cloudflare-router');
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

beforeEach(() => {
  const mappingsDir = path.join(configDir, 'mappings');
  if (fs.existsSync(mappingsDir)) {
    fs.rmSync(mappingsDir, { recursive: true, force: true });
  }
  const configFile = path.join(configDir, 'config.yml');
  if (fs.existsSync(configFile)) {
    fs.unlinkSync(configFile);
  }
});

afterAll(() => {
  if (fs.existsSync(configDir)) {
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});
