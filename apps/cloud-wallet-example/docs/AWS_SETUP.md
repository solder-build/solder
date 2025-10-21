# AWS KMS Setup Guide

⚠️ **IMPORTANT NOTICE**: AWS KMS does not support Ed25519 algorithm, which is required for Solana. This implementation is for demonstration purposes only. For production Solana applications, use **GCP KMS** instead.

This guide walks you through setting up Amazon Web Services (AWS) Key Management Service (KMS) for use with Solder Cloud Wallet integration.

## Prerequisites

- Amazon Web Services account
- AWS CLI installed (optional but recommended)
- Node.js 18+ installed locally

## Cost Information

**AWS KMS Pricing:**
- Key storage: ~$1.00/month per key
- Signing operations: ~$0.03 per 10,000 operations

**⚠️ Important Limitation:**
- ❌ AWS KMS does **NOT** support Ed25519 algorithm (required for Solana)
- ✅ AWS KMS supports ECDSA P-256, P-384, P-521 curves
- ✅ For Solana Ed25519 support, use **GCP KMS** instead

**Why AWS KMS (for non-Solana use cases):**
- ✅ Enterprise-grade security and compliance
- ✅ Integration with AWS ecosystem
- ✅ Flexible authentication methods
- ✅ Supports ECDSA algorithms

## Step-by-Step Setup

### 1. Create or Select AWS Account

1. Go to the [AWS Console](https://console.aws.amazon.com/)
2. Sign in or create a new account
3. Note your **Account ID** (you'll need this for the key ARN)

### 2. Enable KMS Service

1. Navigate to [Key Management Service](https://console.aws.amazon.com/kms/)
2. If prompted, click **Get Started** to enable KMS
3. Accept the terms and conditions

### 3. Create Customer Managed Key

1. In the KMS console, click **Create key**
2. Choose **Symmetric** or **Asymmetric** key type
3. For **Asymmetric** keys:
   - **Key usage**: Sign and verify
   - **Key spec**: ECC_NIST_P256 (or ECC_ED25519 if available)
   - **Key purpose**: Digital signature
4. Fill in the details:
   - **Alias**: `solder-wallet-key` (or your preferred name)
   - **Description**: `Solana wallet signing key for Solder Cloud Wallet`
   - **Optionial**: You can select optional choice based on your reference
5. Click **Create key**
6. Copy the key's **ARN**

### 4. Create IAM User (for Programmatic Access)

1. Go to [IAM > Users](https://console.aws.amazon.com/iam/home#/users)
2. Click **Create user**
3. Fill in the details:
   - **User name**: `solder-kms-user`
4. Click **Next: Permissions**

### 5. Attach KMS Policy

1. Click **Attach existing policies directly**
2. **For development/testing**: Search for and select `AWSKeyManagementServicePowerUser`
3. **For production**: Create a custom policy with minimal permissions:
   
   **Option A: Create Custom Policy (Recommended)**
   - Click **Create policy**
   - Switch to **JSON** tab
   - Paste the following policy (replace `REGION`, `ACCOUNT`, and `KEY-ID` with your values):
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "kms:GetPublicKey",
           "kms:Sign"
         ],
         "Resource": "arn:aws:kms:REGION:ACCOUNT:key/KEY-ID"
       }
     ]
   }
   ```
   - Name it: `SolderCloudWalletKMSPolicy`
   - Click **Create policy**
   - Search for and select your new policy

4. Click **Next: Tags** (optional)
5. Click **Next: Review**
6. Click **Create user**

**Policy Comparison:**
- `AWSKeyManagementServicePowerUser`: Good for development (KMS management + operations)
- Custom `SolderCloudWalletKMSPolicy`: Best for production (minimal permissions)

### 6. Download Access Keys

1. In the user details, go to the **Security credentials** tab
2. Click **Create access key**
3. Choose **Application running outside AWS**
4. Click **Create access key**
5. **Important**: Download the CSV file or copy the credentials
6. Store these credentials securely

### 7. Configure Environment Variables

1. Copy the environment template:
   ```bash
   cp env.example .env
   ```

2. Edit `.env` with your AWS configuration:
   ```env
   # AWS Configuration
   AWS_REGION=us-east-1
   AWS_KMS_KEY_ID=arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012
   
   # AWS Authentication
   AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
   AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
   
   # Solana Configuration
   SOLANA_RPC_ENDPOINT=https://api.devnet.solana.com
   ```

### 8. Test Configuration

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
   pnpm sign-message:aws
   ```

4. If successful, you should see:
   - Your wallet address
   - Public key
   - Message signatures

## Troubleshooting

### Common Issues

#### Access Denied Error
```
Error: User is not authorized to perform: kms:GetPublicKey
```
**Solution**: Ensure your IAM user has the correct KMS permissions.

#### Key Not Found
```
Error: InvalidKeyId.NotFound
```
**Solution**: Verify your key ID/ARN is correct and the key exists in the specified region.

#### Invalid Key Algorithm
```
Error: InvalidKeyUsageException
```
**Solution**: Ensure your KMS key is configured for signing operations with Ed25519 or ECDSA.

#### Region Mismatch
```
Error: The security token included in the request is invalid
```
**Solution**: Ensure your AWS region matches the region where your key was created.

### Debug Mode

Enable detailed logging by setting:
```env
DEBUG=true
```

## Security Best Practices

### Key Management
- Use different keys for different environments (dev/staging/prod)
- Implement key rotation policies
- Monitor key usage and access patterns
- Use least-privilege IAM policies

### Access Control
- Regularly audit IAM permissions
- Use temporary credentials when possible
- Enable CloudTrail logging for KMS operations
- Consider using IAM roles instead of access keys

### Network Security
- Use VPC endpoints for KMS if running in AWS
- Restrict access by IP range if possible
- Enable encryption in transit

## Production Considerations

### High Availability
- Consider multi-region key replication
- Implement retry logic for KMS operations
- Set up CloudWatch monitoring and alerting

### Performance
- KMS operations have latency (typically 100-500ms)
- Consider caching public keys
- Monitor KMS quotas and limits

### Cost Optimization
- Monitor KMS usage and costs
- Use appropriate key types
- Consider regional vs global keys

## Alternative Authentication Methods

### 1. IAM Roles (Recommended for AWS Services)
```typescript
// When running on EC2, Lambda, or ECS
const wallet = createCloudWallet({
  provider: 'aws',
  region: 'us-east-1',
  keyId: 'arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012'
  // No credentials needed - uses IAM role
});
```

### 2. AWS Credentials File
```bash
# Place in ~/.aws/credentials
[default]
aws_access_key_id = AKIAIOSFODNN7EXAMPLE
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

### 3. Environment Variables
```bash
export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
export AWS_DEFAULT_REGION=us-east-1
```

## Additional Resources

- [AWS KMS Documentation](https://docs.aws.amazon.com/kms/)
- [AWS IAM Best Practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)
- [AWS KMS Pricing](https://aws.amazon.com/kms/pricing/)
- [Solder Documentation](https://github.com/your-org/solder)
