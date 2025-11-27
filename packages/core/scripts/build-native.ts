#!/usr/bin/env ts-node
/**
 * Build script for the native Rust addon
 * Orchestrates cargo build and copies the .node file to the correct locations
 */

import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const PACKAGE_ROOT = path.join(__dirname, '..');
const NATIVE_DIR = path.join(PACKAGE_ROOT, 'native');

function buildNative() {
  console.log('🔨 Building native Rust addon...\n');

  try {
    // Check if Rust toolchain is available
    try {
      execSync('cargo --version', { stdio: 'pipe' });
    } catch {
      console.error('ERROR: cargo not found. Install Rust from https://rustup.rs');
      process.exit(1);
    }

    // Build the native addon
    const buildCmd = 'cargo build --release -p solder-node';
    console.log(`Running: ${buildCmd}`);
    console.log(`Working directory: ${PACKAGE_ROOT}\n`);

    execSync(buildCmd, {
      cwd: PACKAGE_ROOT,
      stdio: 'inherit',
      env: {
        ...process.env,
        // Ensure we're building from the correct workspace
      },
    });

    console.log('\n✅ Native addon built successfully');
    
    // Copy the addon to accessible locations
    console.log('\n📦 Copying addon...');
    execSync('node scripts/copy-node-addon.js', {
      cwd: PACKAGE_ROOT,
      stdio: 'inherit',
    });

    console.log('\n🎉 Build complete!');
  } catch (error: any) {
    console.error('\n❌ Build failed:', error.message);
    process.exit(1);
  }
}

// Check if we're being run directly
if (require.main === module) {
  buildNative();
}

export { buildNative };

