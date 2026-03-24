const request = require('supertest');
const { app } = require('../src/server');
const { loadConfig, saveConfig, addAccount, addZoneToAccount, addMapping } = require('../src/config');

describe('API Integration Tests', () => {
  beforeEach(() => {
    saveConfig({ accounts: [], nginx: { listen_port: 6969 }, server: { port: 7070 } });
  });

  describe('Auth Endpoints', () => {
    test('GET /api/auth/check should return auth status', async () => {
      const res = await request(app).get('/api/auth/check');
      expect(res.status).toBe(200);
      expect(res.body.auth_required).toBe(false);
    });

    test('POST /api/auth/login without password should succeed', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ password: '' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('Account Endpoints', () => {
    test('GET /api/accounts should return empty array', async () => {
      const res = await request(app).get('/api/accounts');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    test('POST /api/accounts should create account', async () => {
      const res = await request(app)
        .post('/api/accounts')
        .send({
          name: 'Test Account',
          email: 'test@example.com',
          api_token: 'test_token_12345'
        });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.accounts).toHaveLength(1);
    });

    test('POST /api/accounts should reject invalid email', async () => {
      const res = await request(app)
        .post('/api/accounts')
        .send({
          name: 'Test',
          email: 'invalid-email',
          api_token: 'test_token_12345'
        });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation_error');
    });

    test('POST /api/accounts should require credentials', async () => {
      const res = await request(app)
        .post('/api/accounts')
        .send({
          name: 'Test',
          email: 'test@example.com'
        });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('missing_credentials');
    });

    test('DELETE /api/accounts/:id should remove account', async () => {
      const accounts = addAccount('Test', 'test@example.com', 'key');
      const res = await request(app).delete(`/api/accounts/${accounts[0].id}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('Mapping Endpoints', () => {
    let accountId, zoneId;

    beforeEach(() => {
      const accounts = addAccount('Test', 'test@example.com', 'key');
      accountId = accounts[0].id;
      const zones = addZoneToAccount(accountId, 'zone-123', 'example.com', 'tunnel-456');
      zoneId = zones[0].zone_id;
    });

    test('POST /api/mappings should create mapping', async () => {
      const res = await request(app)
        .post('/api/mappings')
        .send({
          account_id: accountId,
          zone_id: zoneId,
          subdomain: 'api',
          port: 3000,
          description: 'API Server'
        });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    test('POST /api/mappings should reject invalid subdomain', async () => {
      const res = await request(app)
        .post('/api/mappings')
        .send({
          account_id: accountId,
          zone_id: zoneId,
          subdomain: 'invalid.subdomain',
          port: 3000
        });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation_error');
    });

    test('POST /api/mappings should reject invalid port', async () => {
      const res = await request(app)
        .post('/api/mappings')
        .send({
          account_id: accountId,
          zone_id: zoneId,
          subdomain: 'api',
          port: 70000
        });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation_error');
    });

    test('GET /api/mappings should return paginated results', async () => {
      addMapping(accountId, zoneId, 'api', 3000);
      addMapping(accountId, zoneId, 'app', 3001);
      
      const res = await request(app).get('/api/mappings?page=1&limit=1');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.pagination).toBeDefined();
      expect(res.body.pagination.total).toBe(2);
    });

    test('GET /api/mappings should support filtering', async () => {
      addMapping(accountId, zoneId, 'api', 3000);
      addMapping(accountId, zoneId, 'admin', 3001);
      
      const res = await request(app).get('/api/mappings?filter=api');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].subdomain).toBe('api');
    });

    test('DELETE /api/mappings/:account/:zone/:subdomain should remove mapping', async () => {
      addMapping(accountId, zoneId, 'api', 3000);
      
      const res = await request(app)
        .delete(`/api/mappings/${accountId}/${zoneId}/api`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('PATCH /api/mappings/:account/:zone/:subdomain should toggle mapping', async () => {
      addMapping(accountId, zoneId, 'api', 3000);
      
      const res = await request(app)
        .patch(`/api/mappings/${accountId}/${zoneId}/api`)
        .send({ enabled: false });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('PUT /api/mappings/:account/:zone/:subdomain should update mapping', async () => {
      addMapping(accountId, zoneId, 'api', 3000);
      
      const res = await request(app)
        .put(`/api/mappings/${accountId}/${zoneId}/api`)
        .send({ enabled: false });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('Status Endpoints', () => {
    test('GET /api/status should return system status', async () => {
      const res = await request(app).get('/api/status');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('nginx');
      expect(res.body).toHaveProperty('accounts');
      expect(res.body).toHaveProperty('mappings');
    });

    test('GET /api/stats should return request stats', async () => {
      const res = await request(app).get('/api/stats');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('success');
      expect(res.body).toHaveProperty('errors');
    });
  });

  describe('IP List Endpoints', () => {
    test('POST /api/ip/whitelist should add IP', async () => {
      const res = await request(app)
        .post('/api/ip/whitelist')
        .send({ ip: '192.168.1.1' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('POST /api/ip/whitelist should reject invalid IP', async () => {
      const res = await request(app)
        .post('/api/ip/whitelist')
        .send({ ip: 'invalid-ip' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation_error');
    });
  });
});
