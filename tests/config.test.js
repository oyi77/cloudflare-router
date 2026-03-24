const { 
  loadConfig, 
  saveConfig, 
  addAccount, 
  removeAccount,
  addZoneToAccount,
  removeZoneFromAccount,
  addMapping,
  removeMapping,
  toggleMapping,
  getAllMappings,
  CONFIG_DIR
} = require('../src/config');
const fs = require('fs');
const path = require('path');

describe('Config Module', () => {
  describe('loadConfig', () => {
    test('should return default config when no file exists', () => {
      const config = loadConfig();
      expect(config.accounts).toEqual([]);
      expect(config.nginx.listen_port).toBe(6969);
      expect(config.server.port).toBe(7070);
    });

    test('should load existing config', () => {
      const testConfig = { accounts: [{ id: 'test', name: 'Test' }] };
      saveConfig(testConfig);
      const loaded = loadConfig();
      expect(loaded.accounts).toHaveLength(1);
      expect(loaded.accounts[0].name).toBe('Test');
    });
  });

  describe('Account Operations', () => {
    test('should add account', () => {
      const accounts = addAccount('Test Account', 'test@example.com', 'api_key_123');
      expect(accounts).toHaveLength(1);
      expect(accounts[0].name).toBe('Test Account');
      expect(accounts[0].email).toBe('test@example.com');
      expect(accounts[0].id).toMatch(/^cf_\d+$/);
    });

    test('should remove account', async () => {
      const accounts1 = addAccount('Account 1', 'test1@example.com', 'key1');
      const idToRemove = accounts1[0].id;
      
      await new Promise(r => setTimeout(r, 10));
      
      const accounts2 = addAccount('Account 2', 'test2@example.com', 'key2');
      expect(accounts2).toHaveLength(2);
      
      const remaining = removeAccount(idToRemove);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].name).toBe('Account 2');
    });

    test('should throw error when removing non-existent account', () => {
      expect(() => removeAccount('non-existent')).not.toThrow();
    });
  });

  describe('Zone Operations', () => {
    test('should add zone to account', () => {
      const accounts = addAccount('Test', 'test@example.com', 'key');
      const accountId = accounts[0].id;
      
      const zones = addZoneToAccount(accountId, 'zone-123', 'example.com', 'tunnel-456');
      expect(zones).toHaveLength(1);
      expect(zones[0].domain).toBe('example.com');
      expect(zones[0].zone_id).toBe('zone-123');
    });

    test('should throw error when adding zone to non-existent account', () => {
      expect(() => addZoneToAccount('non-existent', 'zone-123', 'example.com'))
        .toThrow('Account not found: non-existent');
    });

    test('should remove zone from account', () => {
      const accounts = addAccount('Test', 'test@example.com', 'key');
      const accountId = accounts[0].id;
      addZoneToAccount(accountId, 'zone-123', 'example.com', 'tunnel-456');
      
      const zones = removeZoneFromAccount(accountId, 'zone-123');
      expect(zones).toHaveLength(0);
    });
  });

  describe('Mapping Operations', () => {
    test('should add mapping', () => {
      const mappings = addMapping('acc-123', 'zone-456', 'api', 3000, 'API Server');
      expect(mappings).toHaveLength(1);
      expect(mappings[0].subdomain).toBe('api');
      expect(mappings[0].port).toBe(3000);
      expect(mappings[0].description).toBe('API Server');
      expect(mappings[0].enabled).toBe(true);
      expect(mappings[0].created_at).toBeDefined();
    });

    test('should update existing mapping', () => {
      addMapping('acc-123', 'zone-456', 'api', 3000, 'Old Description');
      const mappings = addMapping('acc-123', 'zone-456', 'api', 3001, 'New Description');
      
      expect(mappings).toHaveLength(1);
      expect(mappings[0].port).toBe(3001);
      expect(mappings[0].description).toBe('New Description');
      expect(mappings[0].updated_at).toBeDefined();
    });

    test('should remove mapping', () => {
      addMapping('acc-123', 'zone-456', 'api', 3000);
      addMapping('acc-123', 'zone-456', 'app', 3001);
      
      const mappings = removeMapping('acc-123', 'zone-456', 'api');
      expect(mappings).toHaveLength(1);
      expect(mappings[0].subdomain).toBe('app');
    });

    test('should toggle mapping enabled state', () => {
      addMapping('acc-123', 'zone-456', 'api', 3000);
      const mappings = toggleMapping('acc-123', 'zone-456', 'api', false);
      
      expect(mappings[0].enabled).toBe(false);
      expect(mappings[0].updated_at).toBeDefined();
    });

    test('should get all mappings with full domain info', () => {
      addAccount('Test', 'test@example.com', 'key');
      const config = loadConfig();
      const accountId = config.accounts[0].id;
      addZoneToAccount(accountId, 'zone-123', 'example.com', 'tunnel-456');
      addMapping(accountId, 'zone-123', 'api', 3000);
      
      const all = getAllMappings();
      expect(all).toHaveLength(1);
      expect(all[0].full_domain).toBe('api.example.com');
      expect(all[0].account_name).toBe('Test');
    });
  });
});
