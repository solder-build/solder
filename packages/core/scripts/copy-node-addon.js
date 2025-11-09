#!/usr/bin/env node
/**
 * Copy the compiled native addon to accessible locations
 * This ensures the .node file is available for both dev and production use
 */

const fs = require('fs');
const path = require('path');

const TARGETS = [
  path.join(__dirname, '..', 'index.node'), // Root of packages/core
  path.join(__dirname, '..', 'dist', 'index.node'), // For bundled distribution
];

const SOURCE_CANDIDATES = [
  path.join(__dirname, '..', 'target', 'release', 'libvixen_indexer_node.node'),
  path.join(__dirname, '..', 'target', 'release', 'libvixen_indexer_node.dylib'),
  path.join(__dirname, '..', 'target', 'release', 'libvixen_indexer_node.so'),
  path.join(__dirname, '..', 'target', 'release', 'vixen_indexer_node.node'),
  path.join(__dirname, '..', 'src', 'indexer', 'native-stream', 'index.node'),
];

function findExistingSource() {
  for (const candidate of SOURCE_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function copyAddon() {
  const source = findExistingSource();

  if (!source) {
    console.error('ERROR: Native addon not found. Build it first with:');
    console.error('  cargo build --release -p vixen-indexer-node');
    console.error(`\nSearched locations:`);
    SOURCE_CANDIDATES.forEach((candidate) => console.error(`  - ${candidate}`));
    process.exit(1);
  }

  copyFile(source, TARGETS);
}

function copyFile(source, targets) {
  targets.forEach(target => {
    const targetDir = path.dirname(target);
    
    // Ensure target directory exists
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    
    try {
      fs.copyFileSync(source, target);
      console.log(`✓ Copied ${path.basename(source)} → ${target}`);
    } catch (err) {
      console.error(`✗ Failed to copy to ${target}:`, err.message);
    }
  });
}

copyAddon();

