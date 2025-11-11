import 'dotenv/config';
import { 
  createCloudWallet, 
  CloudWalletProvider,
  type GcpKmsConfig 
} from '@solder-build/core';
import { 
  createSolanaRpc, 
  createSolanaRpcSubscriptions,
  address,
  createTransactionMessage, 
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  pipe,
  createNoopSigner,
  compileTransactionMessage,
  getCompiledTransactionMessageEncoder,
  getBase64EncodedWireTransaction,
  signatureBytes
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';

/**
 * Simple SOL transfer example using GCP KMS cloud wallet
 */
async function main() {
  console.log('💸 Starting Cloud Wallet Simple Transfer Example');
  console.log('================================================');

  // Validate environment variables
  const requiredEnvVars = [
    'GCP_PROJECT_ID',
    'GCP_LOCATION', 
    'GCP_KEY_RING',
    'GCP_KEY_NAME',
    'SOLANA_RPC_ENDPOINT',
    'RECIPIENT_ADDRESS',
    'TRANSFER_AMOUNT_LAMPORTS'
  ];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      console.error(`❌ Missing required environment variable: ${envVar}`);
      console.error('Please check your .env file and ensure all configuration is set.');
      process.exit(1);
    }
  }

  // Parse transfer amount
  const transferAmount = BigInt(process.env.TRANSFER_AMOUNT_LAMPORTS!);
  const recipientAddress = process.env.RECIPIENT_ADDRESS!;

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
  } else {
    console.error('❌ No authentication method provided');
    console.error('Please set either GCP_KEY_FILENAME or GCP_CLIENT_EMAIL + GCP_PRIVATE_KEY');
    process.exit(1);
  }

  try {
    // Create cloud wallet
    console.log('🔐 Initializing GCP KMS cloud wallet...');
    const wallet = createCloudWallet(config);
    
    // Get wallet address and public key
    const walletAddress = await wallet.getAddress();
    const publicKey = await wallet.getPublicKey();
    
    console.log(`✅ Wallet address: ${walletAddress}`);
    console.log(`✅ Public key: ${publicKey.toBase58()}`);

    // Create RPC connection
    console.log('\n🌐 Connecting to Solana RPC...');
    const rpc = createSolanaRpc(process.env.SOLANA_RPC_ENDPOINT!);
    const rpcSubscriptions = createSolanaRpcSubscriptions(
      process.env.SOLANA_RPC_ENDPOINT!.replace('https://', 'wss://').replace('http://', 'ws://')
    );

    // Check balance
    console.log('\n💰 Checking wallet balance...');
    const balance = await rpc.getBalance(address(walletAddress)).send();
    const balanceSol = Number(balance.value) / 1_000_000_000;
    const transferSol = Number(transferAmount) / 1_000_000_000;
    
    console.log(`   Balance: ${balanceSol.toFixed(9)} SOL (${balance.value} lamports)`);
    console.log(`   Transfer amount: ${transferSol.toFixed(9)} SOL (${transferAmount} lamports)`);
    
    if (balance.value < transferAmount) {
      console.error(`❌ Insufficient balance for transfer`);
      console.error(`   Required: ${transferAmount} lamports`);
      console.error(`   Available: ${balance.value} lamports`);
      process.exit(1);
    }

    // Get recent blockhash
    console.log('\n📦 Fetching recent blockhash...');
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    console.log(`✅ Blockhash: ${latestBlockhash.blockhash}`);

    // Build transfer instruction
    console.log('\n🔨 Building transfer transaction...');
    console.log(`   From: ${walletAddress}`);
    console.log(`   To: ${recipientAddress}`);
    console.log(`   Amount: ${transferAmount} lamports`);

    // Create a noop signer for the wallet address (we'll sign manually with GCP KMS)
    const walletSigner = createNoopSigner(address(walletAddress));

    // Create transfer instruction
    const transferInstruction = getTransferSolInstruction({
      source: walletSigner,
      destination: address(recipientAddress),
      amount: transferAmount
    });

    // Build transaction message using pipe
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      tx => setTransactionMessageFeePayerSigner(walletSigner, tx),
      tx => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      tx => appendTransactionMessageInstruction(transferInstruction, tx)
    );

    console.log('✅ Transaction message created');

    // Compile the transaction message
    const compiledMessage = compileTransactionMessage(transactionMessage);
    console.log('✅ Transaction message compiled');

    // Encode the compiled message to bytes
    const messageEncoder = getCompiledTransactionMessageEncoder();
    const encodedMessageBytes = messageEncoder.encode(compiledMessage);
    console.log('✅ Transaction message encoded');

    // Convert ReadonlyUint8Array to Uint8Array for signing
    const messageBytes = new Uint8Array(encodedMessageBytes);

    // Sign transaction manually with GCP KMS
    console.log('\n✍️  Signing transaction with GCP KMS...');
    
    // Sign the message bytes
    const txSignature = await wallet.signTransaction(messageBytes);
    
    // Convert signature to the proper branded type
    const txSignatureBytes = signatureBytes(txSignature);
    
    // Create signed transaction by adding the signature
    const signedTransaction = {
      messageBytes: encodedMessageBytes as any, // Cast to satisfy the branded type
      signatures: {
        [address(walletAddress)]: txSignatureBytes
      }
    };
    
    console.log('✅ Transaction signed');

    // Send transaction
    console.log('\n📤 Sending transaction to network...');
    const encodedTransaction = getBase64EncodedWireTransaction(signedTransaction);
    const txSignatureString = await rpc.sendTransaction(encodedTransaction, {
      encoding: 'base64',
      skipPreflight: false,
      preflightCommitment: 'confirmed'
    }).send();

    console.log('✅ Transaction sent!');
    console.log(`\n🎉 Transaction signature: ${txSignatureString}`);
    
    // Generate explorer link
    const network = process.env.SOLANA_RPC_ENDPOINT!.includes('devnet') 
      ? 'devnet' 
      : process.env.SOLANA_RPC_ENDPOINT!.includes('testnet')
      ? 'testnet'
      : 'mainnet-beta';
    console.log(`🔍 View on Solana Explorer: https://explorer.solana.com/tx/${txSignatureString}?cluster=${network}`);

    // Wait for confirmation
    console.log('\n⏳ Waiting for confirmation...');
    const confirmationPromise = new Promise((resolve) => {
      (async () => {
        const subscription = await rpcSubscriptions
          .signatureNotifications(txSignatureString, { commitment: 'confirmed' })
          .subscribe({ abortSignal: new AbortController().signal });

        for await (const notification of subscription) {
          if (notification.value.err) {
            console.error('❌ Transaction failed:', notification.value.err);
            resolve(false);
          } else {
            console.log('✅ Transaction confirmed!');
            resolve(true);
          }
          break;
        }
      })();
    });

    await confirmationPromise;

    // Check final balance
    console.log('\n💰 Final wallet balance...');
    const finalBalance = await rpc.getBalance(address(walletAddress)).send();
    const finalBalanceSol = Number(finalBalance.value) / 1_000_000_000;
    console.log(`   Balance: ${finalBalanceSol.toFixed(9)} SOL (${finalBalance.value} lamports)`);

    console.log('\n✅ Transfer completed successfully!');

    return;
  } catch (error) {
    console.error('\n❌ Error occurred:');
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

