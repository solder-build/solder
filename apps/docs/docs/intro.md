---
sidebar_position: 1
---

# What is Solder?

Solder is a comprehensive Solana backend framework that abstracts away the complexity of building blockchain indexers and APIs. It provides:

- 🚀 **Indexer Abstraction** - Monitor Solana programs and events with minimal configuration
- 🗄️ **Built-in Database Support** - Integrated Drizzle ORM with PostgreSQL
- 🔌 **Auto-generated APIs** - RESTful CRUD endpoints created automatically from your schema
- 📝 **Type-safe** - Full TypeScript support with IDL-based type inference
- 📊 **Real-time Progress UI** - Live terminal interface with performance metrics and health monitoring
- ⚡ **Fast Development** - Go from zero to production-ready backend in minutes
- 🔥 **Hot Schema Reloading** - Automatic database schema synchronization during development

## Quick Start

### Requirements

- Node.js >= 18
- npm, pnpm, or yarn
- PostgreSQL database
- Solana RPC endpoint (optional: defaults to public mainnet RPC)

### Solder App Setup

The fastest way to get started with Solder is using the `create-solder` CLI:

```bash
npx create-solder
```

The CLI will:

1. Prompt you for a project name
2. Ask where you want to create the project
3. Ask if you want to install dependencies automatically
4. Set up a complete Solder project with example code

**After creation:**

```bash
cd your-project-name

# Copy and configure environment variables
cp .env.example .env
# Update .env with your RPC URL and database connection string

# Install dependencies (if you skipped during setup)
npm install

# Generate database schema
npm run generate

# Push schema to database
npm run push

# Start the indexer and API server
npm run dev
```