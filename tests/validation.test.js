const { body, param, query, validationResult } = require('express-validator');

const mockReq = (data) => ({ body: data, params: data, query: data });
const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('Validation Tests', () => {
  describe('Account Validation', () => {
    test('should validate name length', async () => {
      const req = { body: { name: '', email: 'test@example.com', api_token: 'token123' } };
      const validations = [
        body('name').trim().isLength({ min: 1, max: 100 }).withMessage('Name is required')
      ];
      
      for (const validation of validations) {
        await validation.run(req);
      }
      
      const errors = validationResult(req);
      expect(errors.isEmpty()).toBe(false);
    });

    test('should validate email format', async () => {
      const req = { body: { name: 'Test', email: 'invalid-email', api_token: 'token123' } };
      const validations = [
        body('email').trim().isEmail().normalizeEmail()
      ];
      
      for (const validation of validations) {
        await validation.run(req);
      }
      
      const errors = validationResult(req);
      expect(errors.isEmpty()).toBe(false);
    });
  });

  describe('Mapping Validation', () => {
    test('should validate subdomain format', async () => {
      const invalidSubdomains = ['-invalid', 'invalid-', 'invalid.sub', 'invalid_space'];
      
      for (const subdomain of invalidSubdomains) {
        const req = { 
          body: { 
            account_id: 'acc-123',
            zone_id: 'zone-456',
            subdomain,
            port: 3000
          } 
        };
        const validations = [
          body('subdomain').trim().matches(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/i)
        ];
        
        for (const validation of validations) {
          await validation.run(req);
        }
        
        const errors = validationResult(req);
        expect(errors.isEmpty()).toBe(false);
      }
    });

    test('should accept valid subdomain', async () => {
      const validSubdomains = ['api', 'admin-panel', 'api123', 'www'];
      
      for (const subdomain of validSubdomains) {
        const req = { 
          body: { 
            account_id: 'acc-123',
            zone_id: 'zone-456',
            subdomain,
            port: 3000
          } 
        };
        const validations = [
          body('subdomain').trim().matches(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/i)
        ];
        
        for (const validation of validations) {
          await validation.run(req);
        }
        
        const errors = validationResult(req);
        expect(errors.isEmpty()).toBe(true);
      }
    });

    test('should validate port range', async () => {
      const invalidPorts = [0, 70000, -1, 99999];
      
      for (const port of invalidPorts) {
        const req = { 
          body: { 
            account_id: 'acc-123',
            zone_id: 'zone-456',
            subdomain: 'api',
            port
          } 
        };
        const validations = [
          body('port').isInt({ min: 1, max: 65535 })
        ];
        
        for (const validation of validations) {
          await validation.run(req);
        }
        
        const errors = validationResult(req);
        expect(errors.isEmpty()).toBe(false);
      }
    });
  });

  describe('Pagination Validation', () => {
    test('should validate page and limit', async () => {
      const req = { query: { page: 'invalid', limit: '200' } };
      const validations = [
        query('page').optional().isInt({ min: 1 }).toInt(),
        query('limit').optional().isInt({ min: 1, max: 100 }).toInt()
      ];
      
      for (const validation of validations) {
        await validation.run(req);
      }
      
      const errors = validationResult(req);
      expect(errors.isEmpty()).toBe(false);
    });
  });
});
