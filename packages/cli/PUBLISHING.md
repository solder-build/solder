# Publishing create-solder-app to NPM

This guide explains how to publish the `create-solder-app` CLI to NPM so it can be used with `npx`.

## Pre-publishing Checklist

1. **Update version** in `package.json`
2. **Build the package**: `pnpm run build`
3. **Test locally** (see Testing section below)
4. **Update repository URL** in `package.json` if needed

## Testing Locally Before Publishing

### Option 1: Using npm link

```bash
cd packages/cli
pnpm run build
npm link

# Test in another directory
cd /tmp
create-solder-app
```

### Option 2: Using npm pack

```bash
cd packages/cli
pnpm run build
npm pack

# This creates create-solder-app-0.0.1.tgz
# Install it globally to test
npm install -g ./create-solder-app-0.0.1.tgz

# Test
cd /tmp
create-solder-app
```

## Publishing to NPM

### First Time Setup

```bash
# Login to NPM (you'll need an NPM account)
npm login
```

### Publishing

```bash
cd packages/cli

# Make sure everything is built
pnpm run build

# Dry run to see what will be published
npm publish --dry-run

# Actually publish (add --access public if it's a scoped package)
npm publish
```

## What Gets Published

The `files` field in `package.json` specifies:
- `dist/` - Compiled JavaScript and type definitions
- `template/` - The example app template files

The `.npmignore` file ensures source files are excluded.

## After Publishing

Test the published package:

```bash
npx create-solder-app@latest
```

## Version Management

Follow semantic versioning:
- **Patch** (0.0.x): Bug fixes
- **Minor** (0.x.0): New features, backward compatible
- **Major** (x.0.0): Breaking changes

Update version before each publish:

```bash
npm version patch  # 0.0.1 -> 0.0.2
npm version minor  # 0.0.2 -> 0.1.0
npm version major  # 0.1.0 -> 1.0.0
```

## Troubleshooting

### "Package already exists"
- Increment the version number in `package.json`

### "Template not found" when running
- Ensure `template/` is listed in the `files` array in `package.json`
- Check that `npm pack` includes the template folder

### Missing dependencies
- Ensure all runtime dependencies are in `dependencies`, not `devDependencies`

