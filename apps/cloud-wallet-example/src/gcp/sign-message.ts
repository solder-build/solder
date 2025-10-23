import 'dotenv/config';
import { 
  createCloudWallet, 
  CloudWalletProvider,
  type GcpKmsConfig 
} from '@solder-build/core';
import { getBase58Encoder } from '@solana/kit';

/**
 * Message signing example using GCP KMS cloud wallet
 */
async function main() {
  console.log('✍️  Starting Cloud Wallet Message Signing Example');
  console.log('==================================================');

  // Validate environment variables
  const requiredEnvVars = [
    'GCP_PROJECT_ID',
    'GCP_LOCATION', 
    'GCP_KEY_RING',
    'GCP_KEY_NAME'
  ];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      console.error(`❌ Missing required environment variable: ${envVar}`);
      console.error('Please check your .env file and ensure all GCP configuration is set.');
      process.exit(1);
    }
  }

  // Get configuration from environment
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
  } else {
    console.error('❌ No authentication method provided');
    console.error('Please set either GCP_KEY_FILENAME or GCP_CLIENT_EMAIL + GCP_PRIVATE_KEY');
    process.exit(1);
  }

  try {
    // Create cloud wallet
    console.log('🔐 Creating GCP KMS cloud wallet...');
    const wallet = createCloudWallet(config);
    
    // Get wallet address
    const address = await wallet.getAddress();
    console.log(`✅ Wallet address: ${address}`);

    // Sign different types of messages
    const messages = [
      'Hello, Solana!',
      'Cloud Wallet Message Signing',
      'GCP KMS Integration',
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
      const signatureBase58 = Buffer.from(signature).toString('base64');
      
      console.log(`   Signature: ${signatureBase58}`);
      console.log(`   Signature length: ${signature.length} bytes`);
    }

    // Demonstrate binary data signing
    console.log('\n🔢 Signing binary data...');
    console.log('========================');
    
    const binaryData = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05]);
    console.log(`Binary data: [${Array.from(binaryData).join(', ')}]`);
    
    const binarySignature = await wallet.signMessage(binaryData);
    const binarySignatureBase58 = Buffer.from(binarySignature).toString('base64');
    console.log(`Binary signature: ${binarySignatureBase58}`);

    // Demonstrate hash signing (common pattern)
    console.log('\n🔐 Signing message hash...');
    console.log('=========================');
    
    const messageToHash = 'Important message for authentication';
    const messageHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(messageToHash));
    const hashSignature = await wallet.signMessage(new Uint8Array(messageHash));
    const hashSignatureBase58 = Buffer.from(hashSignature).toString('base64');
    
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
