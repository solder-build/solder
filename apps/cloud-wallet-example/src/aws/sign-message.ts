import 'dotenv/config';
import { 
  createCloudWallet, 
  CloudWalletProvider,
  type AwsKmsConfig 
} from '@solder-build/core';
import bs58 from 'bs58';

/**
 * Message signing example using AWS KMS cloud wallet
 */
async function main() {
  console.log('✍️  Starting AWS KMS Cloud Wallet Message Signing Example');
  console.log('==========================================================');

  // Validate environment variables
  const requiredEnvVars = [
    'AWS_REGION',
    'AWS_KMS_KEY_ID'
  ];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      console.error(`❌ Missing required environment variable: ${envVar}`);
      console.error('Please check your .env file and ensure all AWS configuration is set.');
      process.exit(1);
    }
  }

  // Get configuration from environment
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
    console.log('🔐 Creating AWS KMS cloud wallet...');
    const wallet = createCloudWallet(config);
    
    // Get wallet address and public key
    const address = await wallet.getAddress();
    const publicKey = await wallet.getPublicKey();
    
    console.log(`✅ Wallet address: ${address}`);
    console.log(`✅ Public key: ${publicKey.toBase58()}`);
    console.log(`ℹ️  Note: In Solana, wallet address = base58-encoded public key`);

    // Sign different types of messages
    const messages = [
      'Hello, Solana!',
      'AWS KMS Message Signing',
      'Cloud Wallet Integration',
      JSON.stringify({ timestamp: Date.now(), action: 'test' })
    ];

    console.log('\n📝 Signing messages...');
    console.log('====================');

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const messageBytes = new TextEncoder().encode(message);
      
      console.log(`\n${i + 1}. Message: "${message}"`);
      console.log(`   Length: ${messageBytes.length} bytes`);
      
      // Sign the message
      const signature = await wallet.signMessage(messageBytes);
      const signatureBase58 = bs58.encode(signature);
      
      console.log(`   Signature: ${signatureBase58}`);
      console.log(`   Signature length: ${signature.length} bytes`);
    }

    // Demonstrate binary data signing
    console.log('\n🔢 Signing binary data...');
    console.log('========================');
    
    const binaryData = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05]);
    console.log(`Binary data: [${Array.from(binaryData).join(', ')}]`);
    
    const binarySignature = await wallet.signMessage(binaryData);
    const binarySignatureBase58 = bs58.encode(binarySignature);
    console.log(`Binary signature: ${binarySignatureBase58}`);

    // Demonstrate hash signing (common pattern)
    console.log('\n🔐 Signing message hash...');
    console.log('=========================');
    
    const messageToHash = 'Important message for authentication';
    const messageHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(messageToHash));
    const hashSignature = await wallet.signMessage(new Uint8Array(messageHash));
    const hashSignatureBase58 = bs58.encode(hashSignature);
    
    console.log(`Original message: "${messageToHash}"`);
    console.log(`SHA-256 hash: ${Buffer.from(messageHash).toString('hex')}`);
    console.log(`Hash signature: ${hashSignatureBase58}`);

    console.log('\n✅ All message signing examples completed successfully!');
    console.log('\n💡 Use cases for message signing:');
    console.log('   - User authentication');
    console.log('   - Data integrity verification');
    console.log('   - Non-repudiation');
    console.log('   - API request signing');

  } catch (error) {
    console.error('❌ Error occurred:');
    if (error instanceof Error) {
      console.error(`   Message: ${error.message}`);
      console.error(`   Stack: ${error.stack}`);
    } else {
      console.error(`   Unknown error: ${error}`);
    }
    process.exit(1);
  }
}

// Run the example
main().catch(console.error);
