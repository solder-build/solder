#!/usr/bin/env node

import prompts from "prompts";
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";
import ora from "ora";

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
  useCloudWallets: boolean;
  setupGit: boolean;
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
      {
        type: "confirm",
        name: "useCloudWallets",
        message: "Use GCP Cloud Wallets?",
        initial: false,
      },
      {
        type: "confirm",
        name: "setupGit",
        message: "Set up Git Repository?",
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

  const { projectName, targetPath, installDeps, useCloudWallets, setupGit } = answers as CliAnswers;
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
    // Set @solder-build/core and solder-cli versions to match create-solder version
    // get current CLI package version by reading its own package.json
    try {
      const cliPackageJsonPath = path.join(__dirname, "..", "package.json");
      const cliPackageJson = await fs.readJson(cliPackageJsonPath);
      const cliVersion = cliPackageJson.version || "latest";
      packageJson.dependencies["@solder-build/core"] = `^${cliVersion}`;
      packageJson.dependencies["solder-cli"] = `^${cliVersion}`;
    } catch (e) {
      packageJson.dependencies["@solder-build/core"] = "latest";
      packageJson.dependencies["solder-cli"] = "latest";
    }
    await fs.writeJson(packageJsonPath, packageJson, { spaces: 2 });

    // Cloud wallet integration
    if (useCloudWallets) {
      spinner.text = "Setting up cloud wallet integration...";
      
      // Add cloud wallet dependencies
      packageJson.dependencies["@google-cloud/kms"] = "^3.0.0";
      packageJson.dependencies["@solana/kit"] = "^4.0.0";
      packageJson.dependencies["@solana/rpc"] = "^4.0.0";
      packageJson.dependencies["@solana/programs"] = "^4.0.0";
      packageJson.dependencies["@solana-program/system"] = "^0.9.0";
      packageJson.dependencies["bs58"] = "^6.0.0";
      await fs.writeJson(packageJsonPath, packageJson, { spaces: 2 });
      
      // Create cloud wallet files
      await createCloudWalletFiles(resolvedTargetPath);
      
      // Update main index.ts with cloud wallet routes
      await updateIndexWithCloudWallet(resolvedTargetPath);
    }

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
    let envExample = `# Database Configuration
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/solder

# Solana RPC Configuration
RPC_URL=https://api.mainnet-beta.solana.com

# Server Configuration
PORT=4000
`;

    if (useCloudWallets) {
      envExample += `
# GCP Cloud Wallet Configuration
GCP_PROJECT_ID=your-project-id
GCP_LOCATION=global
GCP_KEY_RING=your-key-ring
GCP_KEY_NAME=your-key-name
GCP_KEY_VERSION=1

# GCP Authentication (choose one method)
# Method 1: Service Account JSON file
GCP_KEY_FILENAME=./path/to/service-account-key.json

# Method 2: Service Account credentials (alternative to keyFilename)
# GCP_CLIENT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
# GCP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n"
# GCP_PROJECT_ID_FROM_CREDS=your-project-id

# Solana Configuration for Cloud Wallet
SOLANA_RPC_ENDPOINT=https://api.devnet.solana.com
# Alternative endpoints:
# SOLANA_RPC_ENDPOINT=https://api.mainnet-beta.solana.com
# SOLANA_RPC_ENDPOINT=https://api.testnet.solana.com
`;
    }

    await fs.writeFile(
      path.join(resolvedTargetPath, ".env.example"),
      envExample,
    );

    spinner.succeed(chalk.green("✓ Project created successfully!"));

    if (setupGit) {
      spinner.start("Initializing Git repository...");
      try {
        const { spawn } = await import("child_process");
        await new Promise<void>((resolve, reject) => {
          const gitInit = spawn("git", ["init"], {
            cwd: resolvedTargetPath,
            stdio: "inherit",
            shell: true,
          });

          gitInit.on("close", (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`git init exited with code ${code}`));
            }
          });

          gitInit.on("error", (err) => {
            reject(err);
          });
        });
        spinner.succeed(chalk.green("✓ Git repository initialized!"));
      } catch (error) {
        spinner.fail(chalk.yellow("Failed to initialize Git repository"));
        console.log(
          chalk.yellow(
            "  You can initialize it manually by running: git init",
          ),
        );
      }
    }

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

async function createCloudWalletFiles(targetPath: string) {
  const cloudWalletDir = path.join(targetPath, "src", "cloud-wallet");
  await fs.ensureDir(cloudWalletDir);

  const signMessageTs = `import { 
  createCloudWallet, 
  type GcpKmsConfig,
  CloudWalletProvider 
} from '@solder-build/core';

export async function signMessage(message: string): Promise<string> {
  const config: GcpKmsConfig = {
    provider: CloudWalletProvider.GCP,
    projectId: process.env.GCP_PROJECT_ID!,
    location: process.env.GCP_LOCATION!,
    keyRing: process.env.GCP_KEY_RING!,
    keyName: process.env.GCP_KEY_NAME!,
    keyVersion: process.env.GCP_KEY_VERSION || '1'
  };

  if (process.env.GCP_KEY_FILENAME) {
    config.keyFilename = process.env.GCP_KEY_FILENAME;
  } else if (process.env.GCP_CLIENT_EMAIL && process.env.GCP_PRIVATE_KEY) {
    config.credentials = {
      client_email: process.env.GCP_CLIENT_EMAIL,
      private_key: process.env.GCP_PRIVATE_KEY.replace(/\\\\n/g, '\\n'),
      project_id: process.env.GCP_PROJECT_ID_FROM_CREDS || process.env.GCP_PROJECT_ID!
    };
  }

  const wallet = createCloudWallet(config);
  const messageBytes = new TextEncoder().encode(message);
  const signature = await wallet.signMessage(messageBytes);
  
  return Buffer.from(signature).toString('base64');
}`;

  await fs.writeFile(path.join(cloudWalletDir, "sign-message.ts"), signMessageTs);
  await fs.writeFile(path.join(cloudWalletDir, "index.ts"), `export * from './sign-message';`);
}

async function updateIndexWithCloudWallet(targetPath: string) {
  const indexPath = path.join(targetPath, "src", "index.ts");
  const indexContent = await fs.readFile(indexPath, 'utf-8');
  
  const cloudWalletImport = `
// Cloud wallet functionality
let signMessage: ((message: string) => Promise<string>) | null = null;
try {
  const cloudWallet = await import("./cloud-wallet/sign-message.js");
  signMessage = cloudWallet.signMessage;
  console.log("[APP] Cloud wallet functionality loaded");
} catch (error) {
  console.log("[APP] Cloud wallet not configured");
}
`;

  const cloudWalletRoutes = `
// Cloud wallet API endpoints
if (signMessage) {
  app.post("/api/sign-message", async (c) => {
    try {
      const { message } = await c.req.json();
      
      if (!message) {
        return c.json({ error: "Message is required" }, 400);
      }

      const signature = await signMessage(message);
      
      return c.json({
        success: true,
        message,
        signature,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("Sign message error:", error);
      return c.json({ 
        error: "Failed to sign message",
        details: error instanceof Error ? error.message : "Unknown error"
      }, 500);
    }
  });

  app.get("/api/cloud-wallet/status", (c) => {
    return c.json({
      enabled: true,
      provider: "GCP",
      endpoints: ["/api/sign-message"]
    });
  });
} else {
  app.get("/api/cloud-wallet/status", (c) => {
    return c.json({
      enabled: false,
      message: "Cloud wallet not configured"
    });
  });
}
`;

  const lines = indexContent.split('\n');
  const appGetIndex = lines.findIndex(line => line.includes('app.get("/", (c) =>'));
  lines.splice(appGetIndex, 0, cloudWalletImport);
  
  const indexerIndex = lines.findIndex(line => line.includes('let indexer: Indexer | null = null;'));
  lines.splice(indexerIndex, 0, cloudWalletRoutes);
  
  await fs.writeFile(indexPath, lines.join('\n'));
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  // Handle different commands
  if (command === "create" || !command) {
    // Default to create command for backwards compatibility
    await createCommand();
  } else {
    console.error(chalk.red(`✖ Unknown command: ${command}`));
    console.log(chalk.yellow("\nAvailable commands:"));
    console.log(chalk.cyan("  create     Create a new Solder project (default)"));
    console.log(chalk.yellow("\nUsage:"));
    console.log(chalk.cyan("  npx create-solder [command] [options]"));
    console.log(chalk.yellow("\nFor IDL tools, use:"));
    console.log(chalk.cyan("  npx solder-cli fetch-idl <PROGRAM_ID>"));
    console.log(chalk.cyan("  npx solder-cli idl-to-ts <INPUT_FILE>"));
    process.exit(1);
  }
}

main();
