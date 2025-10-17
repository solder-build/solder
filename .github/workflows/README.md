# CI/CD Workflows

This directory contains GitHub Actions workflows for automated building, versioning, and publishing of the Solder packages.

## Workflows

### 1. `publish-to-npm.yaml` - Production Release

**Triggers:**

- Push to `main` branch (automatic)
- Manual dispatch via GitHub Actions UI

**What it does:**

1. Installs dependencies with `pnpm install`
2. Builds `@solder-build/core` and `create-solder` packages
3. Determines version bump type:
   - **Manual trigger**: Uses the selected version bump type (major/minor/patch)
   - **Push to main**: Parses the commit message:
     - Contains `[major]` → major version bump (e.g., 1.0.0 → 2.0.0)
     - Contains `[minor]` → minor version bump (e.g., 1.0.0 → 1.1.0)
     - Default → patch version bump (e.g., 1.0.0 → 1.0.1)
4. Bumps version in both packages
5. Commits the version changes
6. Publishes both packages to NPM with provenance
7. Creates git tags for the releases

**Example commit messages:**

```bash
git commit -m "feat: add new feature [minor]"
git commit -m "fix: critical bug fix [major]"
git commit -m "fix: small bug fix"  # defaults to patch
```

**Manual trigger:**

1. Go to Actions tab in GitHub
2. Select "Publish to NPM" workflow
3. Click "Run workflow"
4. Select version bump type (major/minor/patch)
5. Click "Run workflow"

### 2. `publish-to-npm-alpha.yaml` - Prerelease

**Triggers:**

- Manual dispatch only

**What it does:**

1. Installs dependencies with `pnpm install`
2. Builds both packages
3. Bumps prerelease version (e.g., 1.0.0 → 1.0.1-alpha.0)
4. Publishes to NPM with the prerelease tag (alpha/beta/rc)
5. Creates git tags for the releases

**Usage:**

1. Go to Actions tab in GitHub
2. Select "Publish Alpha to NPM" workflow
3. Click "Run workflow"
4. Select prerelease identifier (alpha/beta/rc)
5. Click "Run workflow"

Users can install prerelease versions with:

```bash
npm install @solder-build/core@alpha
npx create-solder@alpha
```

## Required Secrets

### NPM_TOKEN

You need to configure an NPM access token as a repository secret:

1. **Generate NPM Token:**

   ```bash
   npm login
   npm token create --access public
   ```

   Copy the generated token.

2. **Add to GitHub:**
   - Go to your repository on GitHub
   - Navigate to Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `NPM_TOKEN`
   - Value: Paste your NPM token
   - Click "Add secret"

## Package Details

### @solder-build/core

- **Location**: `packages/core/`
- **Build command**: `pnpm run build`
- **Registry**: npm (public)
- **Provenance**: Enabled

### create-solder

- **Location**: `packages/cli/`
- **Build command**: `pnpm run build`
- **Registry**: npm (public)
- **Provenance**: Enabled

## Permissions

The workflows require the following permissions:

- `contents: write` - To commit version bumps and create tags
- `id-token: write` - For NPM provenance

## Version Strategy

Both packages are versioned together and will have the same version number after each release. This ensures compatibility between the CLI and the core library.

### Version Bump Examples

**Patch (default):**

- Bug fixes
- Documentation updates
- Performance improvements
- 0.1.18 → 0.1.19

**Minor:**

- New features
- New APIs
- Non-breaking changes
- 0.1.18 → 0.2.0

**Major:**

- Breaking changes
- API removals
- Major refactoring
- 0.1.18 → 1.0.0

**Prerelease:**

- Testing new features
- Alpha/beta releases
- 0.1.18 → 0.1.19-alpha.0

## Troubleshooting

### Build fails

- Check that both packages build successfully locally
- Ensure all dependencies are listed in package.json
- Check for TypeScript errors

### Publish fails with authentication error

- Verify NPM_TOKEN is correctly set in repository secrets
- Ensure the token has publish permissions
- Check token hasn't expired

### Version bump fails

- Ensure package.json files have valid version fields
- Check git is configured correctly
- Verify GITHUB_TOKEN has write permissions

### Provenance fails

- Ensure `id-token: write` permission is set
- Check NPM package is public
- Verify using npm CLI for publishing

## Best Practices

1. **Commit Messages**: Always include `[major]` or `[minor]` in commit messages when appropriate
2. **Testing**: Test builds locally before pushing to main
3. **Prereleases**: Use alpha/beta tags for testing before production releases
4. **Monitoring**: Check the Actions tab for workflow run status
5. **Rollback**: If a release has issues, publish a new version with fixes rather than unpublishing
