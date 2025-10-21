---
sidebar_position: 4
---

# What's Inside This Monorepo?

This Turborepo includes the following packages and apps:

## Apps

- **`apps/docs`** - Documentation website (Docusaurus)
- **`apps/web`** - Marketing website (Next.js)
- **`apps/example-app`** - Example Solder application indexing pump.fun trades

## Packages

- **`packages/core`** - Core Solder framework (`solder`)
- **`packages/cli`** - CLI for scaffolding projects (`create-solder`)
- **`@repo/ui`** - Shared React component library
- **`@repo/eslint-config`** - Shared ESLint configurations
- **`@repo/typescript-config`** - Shared TypeScript configurations

## Development Commands

```bash
# Build all packages
pnpm build

# Run all apps in development mode
pnpm dev

# Lint all packages
pnpm lint

# Format code
pnpm format

# Create a new Solder app
pnpm create-app
```
