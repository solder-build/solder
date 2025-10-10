#!/usr/bin/env node

import prompts from "prompts";
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";
import ora from "ora";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get the template directory (example-app)
const getTemplatePath = () => {
  // From packages/cli/dist/index.js -> go up to workspace root -> apps/example-app
  const cliRoot = path.join(__dirname, "..", "..", "..");
  return path.join(cliRoot, "apps", "example-app");
};

interface CliAnswers {
  projectName: string;
  targetPath: string;
  confirmPath: boolean;
}

async function main() {
  console.log(chalk.bold.cyan("\n🔧 Create Solder App\n"));

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

  const { projectName, targetPath } = answers as CliAnswers;
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
    await fs.writeJson(packageJsonPath, packageJson, { spaces: 2 });

    // Create a .env.example file
    spinner.text = "Creating .env.example...";
    const envExample = `# Database Configuration
DATABASE_URL=postgresql://postgres:password123@127.0.0.1:6500/app

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

    // Print next steps
    console.log(chalk.bold("\n📝 Next steps:\n"));
    console.log(chalk.cyan(`  cd ${targetPath}`));
    console.log(chalk.cyan("  cp .env.example .env"));
    console.log(chalk.cyan("  # Update .env with your configuration"));
    console.log(chalk.cyan("  pnpm install"));
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

main();
