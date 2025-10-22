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

## Quick Start

### 1. Prerequisites

- Node.js 18+
- GCP account with KMS enabled
- Solana devnet SOL for testing

### 2. Setup GCP KMS
Follow the detailed guide in [docs/GCP_SETUP.md](./docs/GCP_SETUP.md) to:
- Create a GCP project
- Enable KMS API
- Create a key ring and Ed25519 key
- Set up service account permissions

**✅ Full Solana support**: Transaction signing, message signing, all features work

### 2. Install Dependencies

```bash
cd apps/cloud-wallet-example
pnpm install
```

### 3. Configure Environment

Copy the environment template and fill in your GCP configuration:

```bash
cp env.example .env
```

Edit `.env` with your GCP configuration:
- `GCP_PROJECT_ID`: Your GCP project ID
- `GCP_KEY_RING`: Your KMS key ring name
- `GCP_KEY_NAME`: Your KMS key name
- `GCP_KEY_FILENAME`: Path to your service account JSON file

### 4. Build and Run

```bash
# Build the project
pnpm build

# GCP KMS Examples (Full Solana Support)
pnpm airdrop:gcp          # SOL airdrop transaction
pnpm transfer:gcp          # SOL transfer transaction
pnpm sign-message:gcp      # Message signing
```

## Examples

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

## Features

| Feature | GCP KMS | Notes |
|---------|---------|-------|
| **Algorithm** | Ed25519 | Solana requires Ed25519 |
| **Transaction Signing** | ✅ Works | Full Solana transaction support |
| **Message Signing** | ✅ Works | Sign arbitrary messages |
| **Public Key Retrieval** | ✅ Works | Returns valid Solana addresses |
| **Enterprise Integration** | ✅ Works | Full enterprise features |
| **Cost** | ~$0.06/month | Cost-effective for production |
| **Setup Complexity** | Medium | Straightforward setup process |

## Architecture

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for detailed information about:
- Factory pattern implementation
- GCP KMS integration flow
- Security considerations
- Algorithm compatibility

## Troubleshooting

### Common Issues

1. **Authentication Error**: Ensure your service account has the correct KMS permissions
2. **Key Not Found**: Verify your key ring, key name, and project ID are correct
3. **Invalid Key Format**: Ensure your KMS key uses the Ed25519 algorithm
4. **RPC Connection**: Check your Solana RPC endpoint is accessible
5. **Signature Verification Failure**: Usually indicates algorithm mismatch or incorrect key configuration

### Debug Mode

Set `DEBUG=true` in your `.env` file for detailed logging.

## Use Cases

- ✅ **Solana DApps**: Full transaction and message signing support
- ✅ **DeFi Applications**: Complete blockchain integration
- ✅ **NFT Marketplaces**: Transaction signing for minting/trading
- ✅ **Enterprise Solana**: Production-ready Solana applications
- ✅ **API Authentication**: Sign API requests for security
- ✅ **Data Integrity**: Sign documents and data for verification

## Contributing

This is a proof of concept. For production use, consider:
- Adding retry logic for KMS operations
- Implementing key rotation strategies
- Adding comprehensive error handling
- Setting up monitoring and alerting
- Supporting additional cloud providers (Azure Key Vault, etc.)
