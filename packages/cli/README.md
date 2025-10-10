# create-solder-app

Create a new Solder indexer application with a single command.

## Usage

### Using NPX (Recommended)

```bash
npx create-solder-app
```

### Using NPM

```bash
npm create solder-app
```

### Using PNPM

```bash
pnpm create solder-app
```

### Using Yarn

```bash
yarn create solder-app
```

## What it does

The CLI will:

1. Prompt you for a project name
2. Ask where you want to create the project
3. Ask if you want to install dependencies automatically
4. Copy the Solder template files
5. Update the package.json with your project name
6. Create a `.env.example` file with configuration templates
7. Optionally run `pnpm install` for you

## After creation

Once your project is created, follow these steps:

```bash
cd your-project-name
cp .env.example .env
# Update .env with your configuration

# If you chose not to install dependencies during setup:
pnpm install

# Then run:
pnpm run generate
pnpm run push
pnpm run dev
```

> **Note**: If you chose to install dependencies during setup, you can skip the `pnpm install` step.

## Requirements

- Node.js >= 18
- A PostgreSQL database

## What's included

The generated project includes:

- Solana indexer setup with solder
- Hono web server with auto-generated CRUD API
- Drizzle ORM for database management
- Example pump.fun trade event indexer
- TypeScript configuration
- Development tooling (tsx, drizzle-kit)

## License

MIT
