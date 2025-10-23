# GCP KMS Setup Guide

This guide walks you through setting up Google Cloud Platform (GCP) Key Management Service (KMS) for use with Solder Cloud Wallet integration.

## Prerequisites

- Google Cloud Platform account
- Billing enabled on your GCP project
- Node.js 18+ installed locally

## Cost Information

**Software Keys (Recommended for PoC):**
- Key storage: ~$0.07/month (1,584 VND/month)
- Signing operations: ~$0.03 per 10,000 operations (792 VND per 10,000)

**Why Software Keys:**
- ✅ Support Ed25519 algorithm (required for Solana)
- ✅ Much cheaper than HSM keys
- ✅ Sufficient security for development and testing
- ✅ No additional HSM configuration needed

## Step-by-Step Setup

### 1. Create or Select GCP Project

1. Go to the [GCP Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Note your **Project ID** (you'll need this later)

### 2. Enable KMS API

1. Navigate to [APIs & Services > Library](https://console.cloud.google.com/apis/library)
2. Search for "Cloud Key Management Service"
3. Click on the result and press **Enable**

### 3. Create Key Ring

1. Go to [Security > Cryptographic Keys](https://console.cloud.google.com/security/kms)
2. Click **Create Key Ring**
3. Fill in the details:
   - **Name**: `solder-wallet-keys` (or your preferred name)
   - **Location**: Choose `global` or your preferred region
4. Click **Create**

### 4. Create Ed25519 Key

1. In your key ring, click **Create Key**
2. Choose **Asymmetric Sign** for the purpose
3. **IMPORTANT**: Select **Ed25519** algorithm (required for Solana)
4. **CRITICAL**: Choose **Software** protection level (not HSM)
   - HSM keys don't support Ed25519 in GCP KMS
   - Software keys are much cheaper (~$0.07/month vs ~$3-6/month)
5. Fill in the details:
   - **Name**: `solana-signing-key` (or your preferred name)
   - **Version**: `1` (default)
6. Click **Create**

### 5. Create Service Account

1. Go to [IAM & Admin > Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts)
2. Click **Create Service Account**
3. Fill in the details:
   - **Name**: `solder-kms-signer`
   - **Description**: `Service account for Solder Cloud Wallet KMS signing`
4. Click **Create and Continue**

### 6. Grant KMS Permissions

1. In the service account details, go to the **Permissions** tab
2. Click **Grant Access**
3. Add the following role:
   - **Cloud KMS CryptoKey Signer/Verifier**
4. Click **Save**

### 7. Download Service Account Key

1. In the service account details, go to the **Keys** tab
2. Click **Add Key** > **Create new key**
3. Choose **JSON** format
4. Click **Create**
5. **Important**: Save the downloaded JSON file securely and never commit it to version control

### 8. Configure Environment Variables

1. Copy the environment template:
   ```bash
   cp env.example .env
   ```

2. Edit `.env` with your GCP configuration:
   ```env
   # GCP Configuration
   GCP_PROJECT_ID=your-project-id
   GCP_LOCATION=global
   GCP_KEY_RING=solder-wallet-keys
   GCP_KEY_NAME=solana-signing-key
   GCP_KEY_VERSION=1
   
   # Authentication (choose one method)
   GCP_KEY_FILENAME=./path/to/service-account-key.json
   
   # Solana Configuration
   SOLANA_RPC_ENDPOINT=https://api.devnet.solana.com
   ```

### 9. Test Configuration

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Build the project:
   ```bash
   pnpm build
   ```

3. Test message signing:
   ```bash
   pnpm sign-message
   ```

4. If successful, you should see:
   - Your wallet address
   - Public key
   - Message signatures

## Troubleshooting

### Common Issues

#### Authentication Error
```
Error: Could not load the default credentials
```
**Solution**: Ensure your service account JSON file path is correct and the file exists.

#### Key Not Found
```
Error: Resource not found
```
**Solution**: Verify your project ID, key ring name, and key name are correct.

#### Invalid Key Algorithm
```
Error: Unsupported key algorithm
```
**Solution**: Ensure you created an Ed25519 key, not RSA or ECDSA.

#### Permission Denied
```
Error: Permission denied
```
**Solution**: Ensure your service account has the "Cloud KMS CryptoKey Signer/Verifier" role.

### Debug Mode

Enable detailed logging by setting:
```env
DEBUG=true
```

## Security Best Practices

### Key Management
- Store service account keys securely (use environment variables in production)
- Never commit keys to version control
- Use different keys for different environments (dev/staging/prod)
- Implement key rotation policies

### Access Control
- Use least-privilege IAM roles
- Regularly audit service account permissions
- Monitor KMS usage and access logs
- Consider using Workload Identity for production

### Network Security
- Restrict KMS access to specific IP ranges if possible
- Use VPC Service Controls for additional isolation
- Enable audit logging for compliance

## Production Considerations

### High Availability
- Consider multi-region key rings for disaster recovery
- Implement retry logic for KMS operations
- Set up monitoring and alerting

### Performance
- KMS operations have latency (typically 100-500ms)
- Consider caching public keys
- Batch operations when possible

### Cost Optimization
- Monitor KMS usage and costs
- Use appropriate key versions
- Consider regional vs global key rings

## Additional Resources

- [GCP KMS Documentation](https://cloud.google.com/kms/docs)
- [Solana Ed25519 Requirements](https://docs.solana.com/terminology#ed25519)
- [GCP IAM Best Practices](https://cloud.google.com/iam/docs/using-iam-securely)
- [Solder Documentation](https://github.com/your-org/solder)
