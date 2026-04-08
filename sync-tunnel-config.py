#!/usr/bin/env python3
"""
Sync cf-router tunnel config to Cloudflare Zero Trust dashboard.
Reads ~/.cloudflare-router/tunnel/config.yml and pushes to Cloudflare API.
"""

import yaml
import json
import requests
import sys
from pathlib import Path

# Load config
CONFIG_FILE = Path.home() / '.cloudflare-router' / 'config.yml'
TUNNEL_CONFIG = Path.home() / '.cloudflare-router' / 'tunnel' / 'config.yml'

with open(CONFIG_FILE) as f:
    config = yaml.safe_load(f)

# Get credentials
account = config['accounts'][0]
account_id = 'a3e2e1d923eed92e8809c685404009d8'  # Real Cloudflare account ID
api_key = account['api_key']
email = account['email']
zone = account['zones'][0]
tunnel_id = zone['tunnel_id']

print(f"Syncing tunnel config for {tunnel_id}...")
print(f"  Account: {account_id}")
print(f"  Zone: {zone['domain']}")

# Read tunnel config
with open(TUNNEL_CONFIG) as f:
    tunnel_config = yaml.safe_load(f)

# Convert ingress rules to Cloudflare format
ingress = []
for rule in tunnel_config.get('ingress', []):
    if 'hostname' in rule:
        ingress.append({
            'hostname': rule['hostname'],
            'service': rule['service'],
            'originRequest': rule.get('originRequest', {})
        })
    else:
        ingress.append({'service': rule['service']})

# Prepare payload
payload = {
    'config': {
        'ingress': ingress
    }
}

print(f"\nConfig to sync:")
print(f"  Routes: {len([r for r in ingress if 'hostname' in r])}")
for rule in ingress:
    if 'hostname' in rule:
        print(f"    {rule['hostname']} → {rule['service']}")

# Push to Cloudflare API
api_url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/cfd_tunnel/{tunnel_id}/configurations"
headers = {
    'X-Auth-Email': email,
    'X-Auth-Key': api_key,
    'Content-Type': 'application/json'
}

print(f"\nPushing to Cloudflare API...")
print(f"  URL: {api_url}")

response = requests.put(api_url, json=payload, headers=headers)

print(f"  Status: {response.status_code}")

if response.status_code == 200:
    result = response.json()
    if result.get('success'):
        print("✅ SUCCESS! Tunnel config synced to Cloudflare")
        print(f"   Version: {result.get('result', {}).get('version')}")
        sys.exit(0)
    else:
        print(f"❌ FAILED: {result.get('errors')}")
        sys.exit(1)
else:
    print(f"❌ API Error {response.status_code}")
    print(response.text)
    sys.exit(1)
