const request = require('supertest');
const { app } = require('../src/server');
const fs = require('fs');
const path = require('path');
const { CONFIG_DIR } = require('../src/config');

describe('Error Page API', () => {
    const errorPagesDir = path.join(CONFIG_DIR, 'error-pages');

    beforeAll(() => {
        if (!fs.existsSync(errorPagesDir)) {
            fs.mkdirSync(errorPagesDir, { recursive: true });
        }
    });

    test('GET /api/error-pages should return available codes', async () => {
        const res = await request(app).get('/api/error-pages');
        expect(res.statusCode).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        const codes = res.body.map(p => p.code);
        expect(codes).toContain('404');
        expect(codes).toContain('500');
        expect(codes).toContain('502');
        expect(codes).toContain('503');
    });

    test('GET /api/error-pages/:code should return page content', async () => {
        const res = await request(app).get('/api/error-pages/404');
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty('content');
        expect(typeof res.body.content).toBe('string');
    });

    test('PUT /api/error-pages/:code should save page content', async () => {
        const testContent = '<h1>Custom 404 Page</h1>';
        const res = await request(app)
            .put('/api/error-pages/404')
            .send({ content: testContent });

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);

        const verifyRes = await request(app).get('/api/error-pages/404');
        expect(verifyRes.body.content).toBe(testContent);
    });

    test('PUT /api/error-pages/:code should reject empty content', async () => {
        const res = await request(app)
            .put('/api/error-pages/404')
            .send({ content: '' });

        expect(res.statusCode).toBe(400);
        expect(res.body.code).toBe('validation_error');
    });
});
