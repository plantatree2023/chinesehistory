#!/usr/bin/env node

const fs = require('fs');
const { execSync } = require('child_process');

try {
  const updatedAt = new Date().toISOString();
  const commit = execSync('git rev-parse --short HEAD').toString().trim();
  const commitAt = execSync('git log -1 --format=%cI').toString().trim();

  const version = {
    updatedAt,
    commit,
    commitAt,
    source: 'cloudflare'
  };

  fs.writeFileSync('version.json', JSON.stringify(version) + '\n');
  console.log('✓ Generated version.json:', JSON.stringify(version));
} catch (error) {
  console.error('✗ Failed to generate version.json:', error.message);
  process.exit(1);
}
