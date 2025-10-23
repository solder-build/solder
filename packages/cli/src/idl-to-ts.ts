import fs from "fs-extra";
import path from "path";
import chalk from "chalk";
import ora from "ora";

export interface IdlToTsOptions {
  inputPath: string;
  outputPath?: string;
}

export async function idlToTs(options: IdlToTsOptions): Promise<void> {
  const { inputPath, outputPath } = options;

  // Validate input file exists and is JSON
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file does not exist: ${inputPath}`);
  }

  if (!inputPath.endsWith('.json')) {
    throw new Error(`Input file must be a JSON file: ${inputPath}`);
  }

  // Determine output path
  const finalOutputPath = outputPath || inputPath.replace('.json', '.ts');

  const spinner = ora("Converting IDL to TypeScript...").start();

  try {
    // Read the IDL JSON file
    const idlData = await fs.readJson(inputPath);

    // Generate the TypeScript content
    const tsContent = generateTypeScriptContent(idlData, path.basename(inputPath, '.json'));

    // Write the TypeScript file
    await fs.writeFile(finalOutputPath, tsContent, 'utf8');

    spinner.succeed(chalk.green(`✓ TypeScript file generated: ${finalOutputPath}`));

    // Show additional info
    console.log(chalk.cyan(`\nInput file: ${inputPath}`));
    console.log(chalk.cyan(`Output file: ${finalOutputPath}`));
    console.log(chalk.cyan(`Program name: ${idlData.name || "Unknown"}`));
    console.log(chalk.cyan(`Version: ${idlData.version || "Unknown"}`));
    console.log(chalk.cyan(`Instructions: ${idlData.instructions?.length || 0}`));
    console.log(chalk.cyan(`Events: ${idlData.events?.length || 0}`));
    console.log(chalk.cyan(`Accounts: ${idlData.accounts?.length || 0}`));

    console.log(chalk.yellow(`\n💡 Usage:`));
    console.log(chalk.gray(`  import { ${getVariableName(path.basename(inputPath, '.json'))} } from "./${path.basename(finalOutputPath, '.ts')}";`));
    console.log(chalk.gray(`  // Use with Anchor:`));
    console.log(chalk.gray(`  idl: ${getVariableName(path.basename(inputPath, '.json'))} as unknown as Idl,`));

  } catch (error) {
    spinner.fail(chalk.red("Failed to convert IDL to TypeScript"));
    
    if (error instanceof Error) {
      if (error.message.includes("does not exist")) {
        throw error;
      } else if (error.message.includes("must be a JSON file")) {
        throw error;
      }
    }
    
    throw new Error(`Failed to convert IDL: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

export function generateTypeScriptContent(idlData: any, baseName: string): string {
  const variableName = getVariableName(baseName);
  
  // Convert the IDL data to a properly formatted TypeScript object
  const idlString = JSON.stringify(idlData, null, 2);
  
  return `import type { Idl } from "@coral-xyz/anchor";

export const ${variableName} = ${idlString} as const satisfies Idl;
`;
}

export function getVariableName(baseName: string): string {
  // Convert kebab-case or snake_case to camelCase
  return baseName
    .replace(/[-_]/g, ' ')
    .split(' ')
    .map((word, index) => {
      if (index === 0) {
        return word.toLowerCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join('') + 'Idl';
}
