/**
 * templates.js — Nginx config templates for common app types
 *
 * Each template generates a customized nginx server block.
 */

const TEMPLATES = {
  /**
   * Default — basic reverse proxy
   */
  default: {
    description: 'Basic reverse proxy',
    generate: ({ domain, port, listenPort, subdomain }) => `server {
    listen ${listenPort};
    server_name ${domain};

    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    location /cf-health {
        return 200 '{"status":"ok","service":"${subdomain}","domain":"${domain}"}';
        add_header Content-Type application/json;
    }
}
`,
  },

  /**
   * Next.js — optimized for Next.js with static asset caching
   */
  nextjs: {
    description: 'Next.js app — optimized caching for /_next/static',
    generate: ({ domain, port, listenPort, subdomain }) => `server {
    listen ${listenPort};
    server_name ${domain};

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
    gzip_vary on;

    # Next.js static assets — cache aggressively
    location /_next/static/ {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass 0;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    # Next.js image optimization
    location /_next/image {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_connect_timeout 60s;
        proxy_send_timeout 120s;
        proxy_read_timeout 300s;
    }

    location /cf-health {
        return 200 '{"status":"ok","service":"${subdomain}","domain":"${domain}"}';
        add_header Content-Type application/json;
    }
}
`,
  },

  /**
   * API — REST API with CORS, larger body, longer timeout
   */
  api: {
    description: 'REST API — CORS headers, 10MB body limit, 120s timeout',
    generate: ({ domain, port, listenPort, subdomain }) => `server {
    listen ${listenPort};
    server_name ${domain};

    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 30s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;

        # CORS headers
        add_header Access-Control-Allow-Origin * always;
        add_header Access-Control-Allow-Methods "GET, POST, PUT, PATCH, DELETE, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Authorization, Content-Type, X-Requested-With" always;

        if ($request_method = OPTIONS) {
            return 204;
        }
    }

    location /cf-health {
        return 200 '{"status":"ok","service":"${subdomain}","domain":"${domain}"}';
        add_header Content-Type application/json;
    }
}
`,
  },

  /**
   * WebSocket — explicit WebSocket upgrade handling
   */
  websocket: {
    description: 'WebSocket app — explicit upgrade headers',
    generate: ({ domain, port, listenPort, subdomain }) => `map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen ${listenPort};
    server_name ${domain};

    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;  # 24h for persistent WS connections
        proxy_send_timeout 86400s;
        proxy_connect_timeout 60s;
        proxy_buffering off;
    }

    location /cf-health {
        return 200 '{"status":"ok","service":"${subdomain}","domain":"${domain}"}';
        add_header Content-Type application/json;
    }
}
`,
  },

  /**
   * gRPC — uses grpc_pass with HTTP/2
   */
  grpc: {
    description: 'gRPC service — grpc_pass, HTTP/2',
    generate: ({ domain, port, listenPort, subdomain }) => `server {
    listen ${listenPort} http2;
    server_name ${domain};

    location / {
        grpc_pass grpc://127.0.0.1:${port};
        grpc_set_header Host $host;
        grpc_set_header X-Real-IP $remote_addr;
        grpc_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        grpc_connect_timeout 60s;
        grpc_read_timeout 300s;
        grpc_send_timeout 300s;

        # Handle gRPC errors
        error_page 502 = /error502grpc;
    }

    location = /error502grpc {
        internal;
        default_type application/grpc;
        add_header grpc-status 14;
        add_header content-length 0;
        return 204;
    }

    location /cf-health {
        return 200 '{"status":"ok","service":"${subdomain}","domain":"${domain}"}';
        add_header Content-Type application/json;
    }
}
`,
  },

  /**
   * Static — aggressive caching for static sites
   */
  static: {
    description: 'Static site — aggressive caching, 1 year max-age',
    generate: ({ domain, port, listenPort, subdomain }) => `server {
    listen ${listenPort};
    server_name ${domain};

    gzip on;
    gzip_static on;
    gzip_types text/plain text/css application/json application/javascript text/xml;

    location ~* \\.(?:ico|css|js|gif|jpe?g|png|woff2?|eot|ttf|svg|webp|avif)$ {
        proxy_pass http://127.0.0.1:${port};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        add_header Cache-Control "public, max-age=31536000, immutable";
        access_log off;
    }

    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 30s;
        add_header Cache-Control "public, max-age=3600";
    }

    location /cf-health {
        return 200 '{"status":"ok","service":"${subdomain}","domain":"${domain}"}';
        add_header Content-Type application/json;
    }
}
`,
  },

  /**
   * Large files — extended timeouts and body size for file uploads/downloads
   */
  largefiles: {
    description: 'Large file uploads — 2GB body limit, extended timeouts',
    generate: ({ domain, port, listenPort, subdomain }) => `server {
    listen ${listenPort};
    server_name ${domain};

    client_max_body_size 2g;
    proxy_request_buffering off;  # stream uploads directly

    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 60s;
        proxy_send_timeout 7200s;  # 2 hours
        proxy_read_timeout 7200s;
        proxy_buffering off;
        proxy_max_temp_file_size 0;
    }

    location /cf-health {
        return 200 '{"status":"ok","service":"${subdomain}","domain":"${domain}"}';
        add_header Content-Type application/json;
    }
}
`,
  },
};

/**
 * Generate nginx config for a mapping using a template.
 * @param {object} mapping - { full_domain, port, subdomain, template?, nginx_extra? }
 * @param {number} listenPort
 * @returns {string} nginx config block
 */
function generateFromTemplate(mapping, listenPort) {
  const templateName = mapping.template || 'default';
  const template = TEMPLATES[templateName] || TEMPLATES.default;

  let config = template.generate({
    domain: mapping.full_domain,
    port: mapping.port,
    listenPort,
    subdomain: mapping.subdomain || 'root',
  });

  // Inject nginx_extra into the main location block (before closing brace)
  if (mapping.nginx_extra) {
    const extraLines = mapping.nginx_extra.trim().split('\n').map(l => `        ${l.trim()}`).join('\n');
    // Insert before the last closing brace of the main location block
    config = config.replace(
      /( {4}location \/ \{[^}]*)(})/s,
      (match, body, close) => `${body}${extraLines}\n    ${close}`
    );
  }

  return config;
}

function listTemplates() {
  return Object.entries(TEMPLATES).map(([name, t]) => ({
    name,
    description: t.description,
  }));
}

function getTemplate(name) {
  return TEMPLATES[name] || null;
}

module.exports = { generateFromTemplate, listTemplates, getTemplate, TEMPLATES };
