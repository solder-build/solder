#!/usr/bin/env node

import chalk from "chalk";
import { fetchIdl } from "./fetch-idl.js";
import { idlToTs } from "./idl-to-ts.js";
import { migrateSchema } from "./ci-migrate.js";

function showBanner() {
  console.log(
    chalk.bold.greenBright(
      `
    ███████╗ ██████╗ ██╗     ██████╗  ███████╗██████╗ 
    ██╔════╝██╔═══██╗██║     ██╔═══██╗██╔════╝██╔══██╗
    ███████╗██║   ██║██║     ██║   ██║█████╗  ██████╔╝
    ╚════██║██║   ██║██║     ██║   ██║██╔══╝  ██╔══██╗
    ███████║╚██████╔╝███████╗██████╔╝ ███████╗██║  ██║
    ╚══════╝ ╚═════╝ ╚══════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝
  `,
    ),
  );
}

async function fetchIdlCommand(args: string[]) {
  showBanner();
  console.log(chalk.bold.green("\n📥 Fetch Solana Program IDL\n"));

  // Parse arguments
  const programId = args[0];
  let rpcUrl: string | undefined;

  // Simple argument parsing for --rpc-url
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--rpc-url" && i + 1 < args.length) {
      rpcUrl = args[i + 1];
      i++; // Skip the next argument since we consumed it
    }
  }

  if (!programId) {
    console.error(chalk.red("✖ Program ID is required"));
    console.log(chalk.yellow("\nUsage:"));
    console.log(chalk.cyan("  solder-cli fetch-idl <PROGRAM_ID> [--rpc-url <RPC_URL>]"));
    console.log(chalk.gray("\nExamples:"));
    console.log(chalk.gray("  solder-cli fetch-idl 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"));
    console.log(chalk.gray("  solder-cli fetch-idl 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P --rpc-url https://api.devnet.solana.com"));
    process.exit(1);
  }

  try {
    await fetchIdl({
      programId,
      rpcUrl,
    });
  } catch (error) {
    console.error(chalk.red(`\n✖ ${error instanceof Error ? error.message : "Unknown error"}`));
    process.exit(1);
  }
}

async function idlToTsCommand(args: string[]) {
  showBanner();
  console.log(chalk.bold.green("\n🔄 Convert IDL to TypeScript\n"));

  // Parse arguments
  const inputPath = args[0];
  const outputPath = args[1]; // Optional output path

  if (!inputPath) {
    console.error(chalk.red("✖ Input file path is required"));
    console.log(chalk.yellow("\nUsage:"));
    console.log(chalk.cyan("  solder-cli idl-to-ts <INPUT_FILE> [OUTPUT_FILE]"));
    console.log(chalk.gray("\nExamples:"));
    console.log(chalk.gray("  solder-cli idl-to-ts ./src/idls/pump-fun.json"));
    console.log(chalk.gray("  solder-cli idl-to-ts ./src/idls/pump-fun.json ./src/types/pump-fun.ts"));
    process.exit(1);
  }

  try {
    await idlToTs({
      inputPath,
      outputPath,
    });
  } catch (error) {
    console.error(chalk.red(`\n✖ ${error instanceof Error ? error.message : "Unknown error"}`));
    process.exit(1);
  }
}

async function ciMigrateCommand(args: string[]) {
  showBanner();
  console.log(chalk.bold.green("\n🚀 CI Migration\n"));

  // Parse arguments - filter out flags first
  const flags = args.filter(arg => arg.startsWith("--") || arg.startsWith("-"));
  const nonFlags = args.filter(arg => !arg.startsWith("--") && !arg.startsWith("-"));
  
  const configPath = nonFlags[0] || "./drizzle.config.ts";
  const verbose = flags.includes("--verbose") || flags.includes("-v");

  try {
    const result = await migrateSchema({
      drizzleConfigPath: configPath,
      verbose,
    });

    if (result.success) {
      console.log(chalk.green("\n✅ CI migration completed successfully"));
      process.exit(0);
    } else {
      console.error(chalk.red(`\n✖ Migration failed: ${result.error}`));
      process.exit(1);
    }
  } catch (error) {
    console.error(chalk.red(`\n✖ ${error instanceof Error ? error.message : "Unknown error"}`));
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  // Handle different commands
  if (command === "fetch-idl") {
    await fetchIdlCommand(args.slice(1));
  } else if (command === "idl-to-ts") {
    await idlToTsCommand(args.slice(1));
  } else if (command === "ci-migrate") {
    await ciMigrateCommand(args.slice(1));
  } else if (!command) {
    // Show help when no command provided
    showBanner();
    console.log(chalk.bold.green("\n🔧 Solder CLI Tools\n"));
    console.log(chalk.yellow("Available commands:"));
    console.log(chalk.cyan("  fetch-idl    Fetch IDL from a Solana program"));
    console.log(chalk.cyan("  idl-to-ts    Convert IDL JSON to TypeScript"));
    console.log(chalk.cyan("  ci-migrate   Run database migrations for CI"));
    console.log(chalk.yellow("\nUsage:"));
    console.log(chalk.cyan("  solder-cli [command] [options]"));
    console.log(chalk.yellow("\nExamples:"));
    console.log(chalk.gray("  solder-cli fetch-idl 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"));
    console.log(chalk.gray("  solder-cli idl-to-ts ./src/idls/pump-fun.json"));
    console.log(chalk.gray("  solder-cli ci-migrate --verbose"));
  } else {
    console.error(chalk.red(`✖ Unknown command: ${command}`));
    console.log(chalk.yellow("\nAvailable commands:"));
    console.log(chalk.cyan("  fetch-idl    Fetch IDL from a Solana program"));
    console.log(chalk.cyan("  idl-to-ts    Convert IDL JSON to TypeScript"));
    console.log(chalk.cyan("  ci-migrate   Run database migrations for CI"));
    console.log(chalk.yellow("\nUsage:"));
    console.log(chalk.cyan("  solder-cli [command] [options]"));
    process.exit(1);
  }
}

main();
