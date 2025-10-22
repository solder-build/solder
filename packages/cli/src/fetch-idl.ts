import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import fs from "fs-extra";
import path from "path";
import chalk from "chalk";
import ora from "ora";

export interface FetchIdlOptions {
  programId: string;
  rpcUrl?: string;
  outputDir?: string;
}

export async function fetchIdl(options: FetchIdlOptions): Promise<void> {
  const { programId, rpcUrl = "https://api.mainnet-beta.solana.com", outputDir = "src/idls" } = options;

  // Validate program ID
  let programPublicKey: PublicKey;
  try {
    programPublicKey = new PublicKey(programId);
  } catch (error) {
    throw new Error(`Invalid program ID: ${programId}. Please provide a valid Solana public key.`);
  }

  // Ensure output directory exists
  await fs.ensureDir(outputDir);

  const spinner = ora("Fetching IDL from Solana...").start();

  try {
    // Create connection
    const connection = new Connection(rpcUrl, "confirmed");

    // Create a dummy wallet for the provider (required by Anchor)
    const dummyKeypair = Keypair.generate();
    const provider = new AnchorProvider(connection, dummyKeypair as any, {
      commitment: "confirmed",
    });

    // Fetch the IDL
    const idl = await Program.fetchIdl(programPublicKey, provider);

    if (!idl) {
      spinner.fail(chalk.red("IDL not found"));
      throw new Error(
        `No IDL found for program ${programId}. This could mean:\n` +
        `- The program doesn't have an IDL uploaded on-chain\n` +
        `- The program ID is incorrect\n` +
        `- The program is not an Anchor program\n` +
        `- Network connectivity issues`
      );
    }

    // Generate filename from program ID (first 8 chars for readability)
    const shortId = programId.slice(0, 8);
    const filename = `${shortId}.json`;
    const filepath = path.join(outputDir, filename);

    // Save IDL to file with pretty formatting
    await fs.writeJson(filepath, idl, { spaces: 2 });

    spinner.succeed(chalk.green(`✓ IDL saved to ${filepath}`));

    // Show additional info
    console.log(chalk.cyan(`\nProgram ID: ${programId}`));
    console.log(chalk.cyan(`Program Name: ${(idl as any).name || "Unknown"}`));
    console.log(chalk.cyan(`Version: ${(idl as any).version || "Unknown"}`));
    console.log(chalk.cyan(`Instructions: ${idl.instructions?.length || 0}`));
    console.log(chalk.cyan(`Events: ${idl.events?.length || 0}`));
    console.log(chalk.cyan(`Accounts: ${idl.accounts?.length || 0}`));

    if (idl.instructions && idl.instructions.length > 0) {
      console.log(chalk.gray(`\nAvailable instructions:`));
      idl.instructions.forEach((instruction: any, index: number) => {
        console.log(chalk.gray(`  ${index + 1}. ${instruction.name}`));
      });
    }

    if (idl.events && idl.events.length > 0) {
      console.log(chalk.gray(`\nAvailable events:`));
      idl.events.forEach((event: any, index: number) => {
        console.log(chalk.gray(`  ${index + 1}. ${event.name}`));
      });
    }

    console.log(chalk.yellow(`\n💡 Next steps:`));
    console.log(chalk.yellow(`  1. Convert IDL to TypeScript (optional but recommended):`));
    console.log(chalk.gray(`     npx create-solder idl-to-ts ./${filepath}`));
    console.log(chalk.yellow(`  2. Import the IDL in your indexer:`));
    console.log(chalk.gray(`     import ${shortId}Idl from "./idls/${filename}" with { type: "json" };`));
    console.log(chalk.yellow(`  3. Use it in your event handler:`));
    console.log(chalk.gray(`     idl: ${shortId}Idl as unknown as Idl,`));

  } catch (error) {
    spinner.fail(chalk.red("Failed to fetch IDL"));
    
    if (error instanceof Error) {
      if (error.message.includes("Invalid program ID")) {
        throw error;
      } else if (error.message.includes("No IDL found")) {
        throw error;
      } else if (error.message.includes("fetch")) {
        throw new Error(
          `Network error: ${error.message}\n` +
          `Please check your RPC URL and internet connection.`
        );
      }
    }
    
    throw new Error(`Failed to fetch IDL: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}
