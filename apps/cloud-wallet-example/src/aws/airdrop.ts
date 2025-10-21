import 'dotenv/config';
import { 
  createCloudWallet, 
  CloudWalletProvider,
  type AwsKmsConfig 
} from '@solder-build/core';
import { 
  createSolanaRpc,
  address,
  lamports
} from '@solana/kit';

/**
 * Airdrop SOL to the AWS KMS wallet for testing
 */
async function main() {
  console.log('💰 Airdropping SOL to AWS KMS wallet');
  console.log('====================================');

  // Get AWS configuration from environment
  const config: AwsKmsConfig = {
    provider: CloudWalletProvider.AWS,
    region: process.env.AWS_REGION!,
    keyId: process.env.AWS_KMS_KEY_ID!,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken: process.env.AWS_SESSION_TOKEN
  };

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
