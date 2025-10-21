# Cloud Wallet Example

This is a proof of concept demonstrating Solder's Cloud Wallet integration with cloud-based Key Management Services for server-side Solana transaction signing.

## Features

- 🔐 **Secure Key Management**: Private keys stored in cloud KMS
- 🏭 **Factory Pattern**: Unified interface for cloud wallet providers
- 📝 **Transaction Signing**: Sign and send Solana transactions server-side
- ✍️ **Message Signing**: Sign arbitrary messages for authentication
- 🚀 **Modern APIs**: Uses `@solana/kit` for transaction building

## Supported Providers

- ✅ **GCP KMS**: Full Ed25519 support (recommended for Solana)
- ✅ **AWS KMS**: ECDSA P-256 support (message signing only, not Solana transactions)

## Quick Start

### 1. Prerequisites

- Node.js 18+
- Cloud provider account (GCP or AWS) with KMS enabled
- Solana devnet SOL for testing

### 2. Choose Your Provider

#### Option A: GCP KMS (Recommended for Solana)
Follow the detailed guide in [docs/GCP_SETUP.md](./docs/GCP_SETUP.md) to:
- Create a GCP project
- Enable KMS API
- Create a key ring and Ed25519 key
- Set up service account permissions

**✅ Full Solana support**: Transaction signing, message signing, all features work

#### Option B: AWS KMS (Message Signing Only)
Follow the detailed guide in [docs/AWS_SETUP.md](./docs/AWS_SETUP.md) to:
- Create an AWS account
- Enable KMS service
- Create an ECDSA P-256 key
- Set up IAM permissions

**⚠️ Limited support**: Message signing works, but Solana transactions fail due to ECDSA vs Ed25519 incompatibility

### 3. Install Dependencies

```bash
cd apps/cloud-wallet-example
pnpm install
```

### 4. Configure Environment

Copy the environment template and fill in your cloud provider details:

```bash
cp env.example .env
```

#### For GCP KMS:
Edit `.env` with your GCP configuration:
- `GCP_PROJECT_ID`: Your GCP project ID
- `GCP_KEY_RING`: Your KMS key ring name
- `GCP_KEY_NAME`: Your KMS key name
- `GCP_KEY_FILENAME`: Path to your service account JSON file

#### For AWS KMS:
Edit `.env` with your AWS configuration:
- `AWS_REGION`: Your AWS region (e.g., 'us-east-1')
- `AWS_KMS_KEY_ID`: Your KMS key ARN
- `AWS_ACCESS_KEY_ID`: Your AWS access key
- `AWS_SECRET_ACCESS_KEY`: Your AWS secret key

### 5. Build and Run

```bash
# Build the project
pnpm build

# GCP KMS Examples (Full Solana Support)
pnpm airdrop:gcp          # SOL airdrop transaction
pnpm transfer:gcp          # SOL transfer transaction
pnpm sign-message:gcp      # Message signing

# AWS KMS Examples (Message Signing Only)
pnpm airdrop:aws          # SOL airdrop transaction
pnpm transfer:aws      # ❌ Will fail - not compatible with Solana
pnpm sign-message:aws  # ✅ Works - message signing
```

## Examples

### GCP KMS (Full Solana Support)

```typescript
import { createCloudWallet } from '@solder-build/core';
import { createSolanaRpc } from '@solana/rpc';

// GCP KMS - Full Solana support
const wallet = createCloudWallet({
  provider: 'gcp',
  projectId: 'your-project',
  location: 'global',
  keyRing: 'your-key-ring',
  keyName: 'your-key',
  keyFilename: './service-account.json'
});

// Get wallet address
const address = await wallet.getAddress();
console.log('Wallet address:', address);

// ✅ Transaction signing works
const rpc = createSolanaRpc('https://api.devnet.solana.com');
// ... transaction building and signing

// ✅ Message signing works
const message = new TextEncoder().encode('Hello, Solana!');
const signature = await wallet.signMessage(message);
console.log('Message signature:', Buffer.from(signature).toString('base64'));
```

### AWS KMS (Message Signing Only)

```typescript
import { createCloudWallet } from '@solder-build/core';

// AWS KMS - Message signing only
const wallet = createCloudWallet({
  provider: 'aws',
  region: 'us-east-1',
  keyId: 'arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012'
});

// Get wallet address
const address = await wallet.getAddress();
console.log('Wallet address:', address);

// ✅ Message signing works
const message = new TextEncoder().encode('Hello, AWS!');
const signature = await wallet.signMessage(message);
console.log('Message signature:', Buffer.from(signature).toString('base64'));

// ❌ Transaction signing fails - AWS uses ECDSA, Solana requires Ed25519
// const txSignature = await wallet.signTransaction(txBytes); // This will fail
```

## Provider Comparison

| Feature | GCP KMS | AWS KMS | Notes |
|---------|---------|---------|-------|
| **Algorithm** | Ed25519 | ECDSA P-256 | Solana requires Ed25519 |
| **Transaction Signing** | ✅ Works | ❌ Fails | AWS signatures incompatible |
| **Message Signing** | ✅ Works | ✅ Works | Both support message signing |
| **Public Key Retrieval** | ✅ Works | ✅ Works | Both return valid addresses |
| **Enterprise Integration** | ✅ Works | ✅ Works | Both have enterprise features |
| **Cost** | ~$0.06/month | ~$1.00/month | GCP is more cost-effective |
| **Setup Complexity** | Medium | Medium | Similar setup requirements |

## Architecture

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for detailed information about:
- Factory pattern implementation
- GCP KMS integration flow
- AWS KMS integration flow
- Security considerations
- Algorithm compatibility

## Troubleshooting

### Common Issues

#### GCP KMS Issues
1. **Authentication Error**: Ensure your service account has the correct KMS permissions
2. **Key Not Found**: Verify your key ring, key name, and project ID are correct
3. **Invalid Key Format**: Ensure your KMS key uses the Ed25519 algorithm
4. **RPC Connection**: Check your Solana RPC endpoint is accessible

#### AWS KMS Issues
1. **Transaction Signing Fails**: This is expected - AWS KMS uses ECDSA, not Ed25519
2. **Authentication Error**: Ensure your IAM user has KMS permissions
3. **Key Not Found**: Verify your key ID/ARN is correct
4. **Wrong Algorithm**: AWS KMS only supports ECDSA P-256, P-384, P-521

#### General Issues
1. **Message Signing Works, Transactions Fail**: Check if you're using AWS KMS (not compatible with Solana)
2. **Signature Verification Failure**: Usually indicates algorithm mismatch (ECDSA vs Ed25519)

### Debug Mode

Set `DEBUG=true` in your `.env` file for detailed logging.

## Use Cases

### GCP KMS (Recommended for Solana)
- ✅ **Solana DApps**: Full transaction and message signing support
- ✅ **DeFi Applications**: Complete blockchain integration
- ✅ **NFT Marketplaces**: Transaction signing for minting/trading
- ✅ **Enterprise Solana**: Production-ready Solana applications

### AWS KMS (Alternative Use Cases)
- ✅ **API Authentication**: Sign API requests for security
- ✅ **Data Integrity**: Sign documents and data for verification
- ✅ **Non-Solana Blockchains**: Ethereum, Bitcoin, other ECDSA chains
- ✅ **Enterprise Systems**: General cryptographic operations
- ❌ **Solana Applications**: Not compatible due to algorithm mismatch

## Contributing

This is a proof of concept. For production use, consider:
- Adding retry logic for KMS operations
- Implementing key rotation strategies
- Adding comprehensive error handling
- Setting up monitoring and alerting
- Supporting additional cloud providers (Azure Key Vault, etc.)
