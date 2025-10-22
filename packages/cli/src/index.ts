#!/usr/bin/env node

import prompts from "prompts";
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";
import ora from "ora";
import { fetchIdl } from "./fetch-idl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get the template directory
const getTemplatePath = () => {
  // When running from NPX, template is bundled with the package
  // From packages/cli/dist/index.js -> ../template
  const bundledTemplate = path.join(__dirname, "..", "template");

  // Check if bundled template exists (NPX/NPM install)
  if (fs.existsSync(bundledTemplate)) {
    return bundledTemplate;
  }

  // Fallback to monorepo structure (development)
  // From packages/cli/dist/index.js -> go up to workspace root -> apps/example-app
  const cliRoot = path.join(__dirname, "..", "..", "..");
  const monoRepoTemplate = path.join(cliRoot, "apps", "example-app");

  if (fs.existsSync(monoRepoTemplate)) {
    return monoRepoTemplate;
  }

  // If neither exists, return bundled path and let error handling catch it
  return bundledTemplate;
};

interface CliAnswers {
  projectName: string;
  targetPath: string;
  confirmPath: boolean;
  installDeps: boolean;
}

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

async function createCommand() {
  showBanner();
  console.log(chalk.bold.green("\n🔧 Create Solder App\n"));

  const answers = await prompts(
    [
      {
        type: "text",
        name: "projectName",
        message: "What is your project name?",
        initial: "my-solder-app",
        validate: (value: string) =>
          value.length > 0 ? true : "Project name is required",
      },
      {
        type: "text",
        name: "targetPath",
        message: "Where should we create your project?",
        initial: (prev: string) => `./${prev}`,
        validate: (value: string) =>
          value.length > 0 ? true : "Target path is required",
      },
      {
        type: "confirm",
        name: "confirmPath",
        message: (prev: string) =>
          `Create project at ${chalk.cyan(path.resolve(prev))}?`,
        initial: true,
      },
      {
        type: "confirm",
        name: "installDeps",
        message: "Install dependencies with pnpm?",
        initial: true,
      },
    ],
    {
      onCancel: () => {
        console.log(chalk.red("\n✖ Operation cancelled"));
        process.exit(0);
      },
    },
  );

  if (!answers.confirmPath) {
    console.log(chalk.red("\n✖ Operation cancelled"));
    process.exit(0);
  }

  const { projectName, targetPath, installDeps } = answers as CliAnswers;
  const resolvedTargetPath = path.resolve(targetPath);
  const templatePath = getTemplatePath();

  // Check if template exists
  if (!fs.existsSync(templatePath)) {
    console.error(
      chalk.red(
        `\n✖ Template not found at ${templatePath}. Make sure you're running this from the Solder monorepo.`,
      ),
    );
    process.exit(1);
  }

  // Check if target directory already exists
  if (fs.existsSync(resolvedTargetPath)) {
    const { overwrite } = await prompts({
      type: "confirm",
      name: "overwrite",
      message: chalk.yellow(
        `Directory ${resolvedTargetPath} already exists. Overwrite?`,
      ),
      initial: false,
    });

    if (!overwrite) {
      console.log(chalk.red("\n✖ Operation cancelled"));
      process.exit(0);
    }

    // Remove existing directory
    await fs.remove(resolvedTargetPath);
  }

  const spinner = ora("Creating project...").start();

  try {
    // Create target directory
    await fs.ensureDir(resolvedTargetPath);

    // Copy template files
    spinner.text = "Copying template files...";
    await fs.copy(templatePath, resolvedTargetPath, {
      filter: (src) => {
        // Skip node_modules, dist, and other build artifacts
        const relativePath = path.relative(templatePath, src);
        if (
          relativePath.includes("node_modules") ||
          relativePath.includes("dist") ||
          relativePath.includes(".turbo") ||
          relativePath === "pnpm-lock.yaml"
        ) {
          return false;
        }
        return true;
      },
    });

    // Update package.json with new project name
    spinner.text = "Updating package.json...";
    const packageJsonPath = path.join(resolvedTargetPath, "package.json");
    const packageJson = await fs.readJson(packageJsonPath);
    packageJson.name = projectName;
    // Set @solder-build/core version to match create-solder version
    // get current CLI package version by reading its own package.json
    try {
      const cliPackageJsonPath = path.join(__dirname, "..", "package.json");
      const cliPackageJson = await fs.readJson(cliPackageJsonPath);
      const cliVersion = cliPackageJson.version || "latest";
      packageJson.dependencies["@solder-build/core"] = `^${cliVersion}`;
    } catch (e) {
      packageJson.dependencies["@solder-build/core"] = "latest";
    }
    await fs.writeJson(packageJsonPath, packageJson, { spaces: 2 });

    // Rename gitignore file (template has it without the dot to avoid npm issues)
    const gitignoreTemplatePath = path.join(templatePath, "gitignore");
    if (fs.existsSync(gitignoreTemplatePath)) {
      spinner.text = "Setting up .gitignore...";
      await fs.copy(
        gitignoreTemplatePath,
        path.join(resolvedTargetPath, ".gitignore"),
      );
    }

    // Create a .env.example file
    spinner.text = "Creating .env.example...";
    const envExample = `# Database Configuration
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/solder

# Solana RPC Configuration
RPC_URL=https://api.mainnet-beta.solana.com

# Server Configuration
PORT=4000
`;
    await fs.writeFile(
      path.join(resolvedTargetPath, ".env.example"),
      envExample,
    );

    spinner.succeed(chalk.green("✓ Project created successfully!"));

    // Install dependencies if requested
    if (installDeps) {
      spinner.start("Installing dependencies with pnpm...");
      try {
        const { spawn } = await import("child_process");
        await new Promise<void>((resolve, reject) => {
          const install = spawn("pnpm", ["install"], {
            cwd: resolvedTargetPath,
            stdio: "inherit",
            shell: true,
          });

          install.on("close", (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`pnpm install exited with code ${code}`));
            }
          });

          install.on("error", (err) => {
            reject(err);
          });
        });
        spinner.succeed(chalk.green("✓ Dependencies installed!"));
      } catch (error) {
        spinner.fail(chalk.yellow("Failed to install dependencies"));
        console.log(
          chalk.yellow(
            "  You can install them manually by running: pnpm install",
          ),
        );
      }
    }

    // Print next steps
    console.log(chalk.bold("\n📝 Next steps:\n"));
    console.log(chalk.cyan(`  cd ${targetPath}`));
    console.log(chalk.cyan("  cp .env.example .env"));
    console.log(chalk.cyan("  # Update .env with your configuration"));
    if (!installDeps) {
      console.log(chalk.cyan("  pnpm install"));
    }
    console.log(chalk.cyan("  pnpm run generate"));
    console.log(chalk.cyan("  pnpm run push"));
    console.log(chalk.cyan("  pnpm run dev"));
    console.log(chalk.bold("\n🚀 Happy coding!\n"));
  } catch (error) {
    spinner.fail(chalk.red("Failed to create project"));
    console.error(error);
    process.exit(1);
  }
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
    console.log(chalk.cyan("  npx create-solder fetch-idl <PROGRAM_ID> [--rpc-url <RPC_URL>]"));
    console.log(chalk.gray("\nExamples:"));
    console.log(chalk.gray("  npx create-solder fetch-idl 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"));
    console.log(chalk.gray("  npx create-solder fetch-idl 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P --rpc-url https://api.devnet.solana.com"));
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

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  // Handle different commands
  if (command === "fetch-idl") {
    await fetchIdlCommand(args.slice(1));
  } else if (command === "create" || !command) {
    // Default to create command for backwards compatibility
    await createCommand();
  } else {
    console.error(chalk.red(`✖ Unknown command: ${command}`));
    console.log(chalk.yellow("\nAvailable commands:"));
    console.log(chalk.cyan("  create     Create a new Solder project (default)"));
    console.log(chalk.cyan("  fetch-idl  Fetch IDL from a Solana program"));
    console.log(chalk.yellow("\nUsage:"));
    console.log(chalk.cyan("  npx create-solder [command] [options]"));
    process.exit(1);
  }
}

main();
