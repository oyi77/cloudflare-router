const fs = require('fs');
const path = require('path');
const { CONFIG_DIR } = require('./config');

const ERROR_PAGES_DIR = path.join(CONFIG_DIR, 'error-pages');
const DEFAULT_ERRORS_DIR = path.join(__dirname, 'errors');

// Ensure error pages directory exists
if (!fs.existsSync(ERROR_PAGES_DIR)) {
    fs.mkdirSync(ERROR_PAGES_DIR, { recursive: true });
}

const DEFAULT_PAGES = ['404', '500', '502', '503'];

function getErrorPagePath(code) {
    return path.join(ERROR_PAGES_DIR, `${code}.html`);
}

function getErrorPageMetadataPath(code) {
    return path.join(ERROR_PAGES_DIR, `${code}.json`);
}

function getErrorPage(code) {
    const customPath = getErrorPagePath(code);
    if (fs.existsSync(customPath)) {
        return fs.readFileSync(customPath, 'utf8');
    }

    const defaultPath = path.join(DEFAULT_ERRORS_DIR, `${code}.html`);
    if (fs.existsSync(defaultPath)) {
        return fs.readFileSync(defaultPath, 'utf8');
    }

    // Fallback for missing defaults
    return `<!DOCTYPE html><html><body><h1>Error ${code}</h1></body></html>`;
}

function saveErrorPage(code, content, metadata = {}) {
    const pagePath = getErrorPagePath(code);
    const metaPath = getErrorPageMetadataPath(code);

    fs.writeFileSync(pagePath, content);
    fs.writeFileSync(metaPath, JSON.stringify({
        code,
        updatedAt: new Date().toISOString(),
        ...metadata
    }, null, 2));

    return true;
}

function listErrorPages() {
    const pages = [...DEFAULT_PAGES];

    // Add any other custom codes found in the directory
    if (fs.existsSync(ERROR_PAGES_DIR)) {
        const files = fs.readdirSync(ERROR_PAGES_DIR);
        files.forEach(file => {
            if (file.endsWith('.html')) {
                const code = file.replace('.html', '');
                if (!pages.includes(code)) pages.push(code);
            }
        });
    }

    return pages.map(code => {
        const metaPath = getErrorPageMetadataPath(code);
        let metadata = { code, name: `Error ${code}` };

        if (fs.existsSync(metaPath)) {
            try {
                metadata = { ...metadata, ...JSON.parse(fs.readFileSync(metaPath, 'utf8')) };
            } catch (e) {
                console.error(`Failed to parse metadata for ${code}:`, e);
            }
        }

        return metadata;
    });
}

function initializeDefaultPages() {
    DEFAULT_PAGES.forEach(code => {
        const customPath = getErrorPagePath(code);
        if (!fs.existsSync(customPath)) {
            const defaultPath = path.join(DEFAULT_ERRORS_DIR, `${code}.html`);
            if (fs.existsSync(defaultPath)) {
                saveErrorPage(code, fs.readFileSync(defaultPath, 'utf8'), { isDefault: true });
            } else {
                saveErrorPage(code, `<!DOCTYPE html><html><body><h1>Error ${code}</h1></body></html>`, { isDefault: true });
            }
        }
    });
}

module.exports = {
    getErrorPage,
    saveErrorPage,
    listErrorPages,
    initializeDefaultPages,
    ERROR_PAGES_DIR
};
