import 'dotenv/config';
import { 
  createCloudWallet, 
  CloudWalletProvider,
  type GcpKmsConfig 
} from '@solder-build/core';
import { 
  createSolanaRpc,
  address,
  lamports
} from '@solana/kit';

/**
 * Airdrop SOL to the GCP KMS wallet for testing
 */
async function main() {
  console.log('💰 Airdropping SOL to GCP KMS wallet');
  console.log('====================================');

  // Get GCP configuration from environment
  const config: GcpKmsConfig = {
    provider: CloudWalletProvider.GCP,
    projectId: process.env.GCP_PROJECT_ID!,
    location: process.env.GCP_LOCATION!,
    keyRing: process.env.GCP_KEY_RING!,
    keyName: process.env.GCP_KEY_NAME!,
    keyVersion: process.env.GCP_KEY_VERSION || '1'
  };

  // Add authentication method
  if (process.env.GCP_KEY_FILENAME) {
    config.keyFilename = process.env.GCP_KEY_FILENAME;
  } else if (process.env.GCP_CLIENT_EMAIL && process.env.GCP_PRIVATE_KEY) {
    config.credentials = {
      client_email: process.env.GCP_CLIENT_EMAIL,
      private_key: process.env.GCP_PRIVATE_KEY.replace(/\\n/g, '\n'),
      project_id: process.env.GCP_PROJECT_ID_FROM_CREDS || process.env.GCP_PROJECT_ID!
    };
  }

  try {
    // Create cloud wallet
    const wallet = createCloudWallet(config);
    const walletAddress = await wallet.getAddress();
    
    console.log(`✅ Wallet address: ${walletAddress}`);

    // Create RPC connection
    const rpc = createSolanaRpc(process.env.SOLANA_RPC_ENDPOINT!);
    
    // Check current balance
    const balance = await rpc.getBalance(address(walletAddress)).send();
    const balanceSol = Number(balance.value) / 1_000_000_000;
    console.log(`   Current balance: ${balanceSol.toFixed(9)} SOL (${balance.value} lamports)`);

    if (balance.value > 0) {
      console.log('✅ Wallet already has SOL, no airdrop needed');
      return;
    }

    // Request airdrop
    console.log('\n🪂 Requesting airdrop...');
    const airdropAmount = lamports(BigInt(2_000_000_000)); // 2 SOL
    const signature = await rpc.requestAirdrop(address(walletAddress), airdropAmount).send();
    
    console.log(`✅ Airdrop requested! Signature: ${signature}`);
    
    // Wait for confirmation
    console.log('⏳ Waiting for airdrop confirmation...');
    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
    
    // Check new balance
    const newBalance = await rpc.getBalance(address(walletAddress)).send();
    const newBalanceSol = Number(newBalance.value) / 1_000_000_000;
    console.log(`   New balance: ${newBalanceSol.toFixed(9)} SOL (${newBalance.value} lamports)`);
    
    if (newBalance.value > 0) {
      console.log('✅ Airdrop successful!');
    } else {
      console.log('❌ Airdrop may still be processing...');
    }

  } catch (error) {
    console.error('❌ Error occurred:');
    if (error instanceof Error) {
      console.error(`   Message: ${error.message}`);
    } else {
      console.error(`   Unknown error: ${error}`);
    }
    process.exit(1);
  }
}

// Run the airdrop
main().catch(console.error);
