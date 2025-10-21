import { CloudWallet, CloudWalletConfig, CloudWalletProvider, CloudWalletError } from './types';
import { GcpKmsWallet } from './providers/gcp-kms';
import { AwsKmsWallet } from './providers/aws-kms';

/**
 * CloudWallet factory for creating cloud-based wallets
 */
export class CloudWalletFactory {
  /**
   * Create a cloud wallet instance based on the provider
   */
  static create(config: CloudWalletConfig): CloudWallet {
    this.validateConfig(config);

    switch (config.provider) {
      case CloudWalletProvider.GCP:
        return new GcpKmsWallet(config);
      
      case CloudWalletProvider.AWS:
        return new AwsKmsWallet(config);
      
      default:
        throw new CloudWalletError(
          `Unsupported cloud wallet provider: ${(config as any).provider}`,
          (config as any).provider,
          'create'
        );
    }
  }

  /**
   * Validate the configuration based on provider
   */
  private static validateConfig(config: CloudWalletConfig): void {
    if (!config.provider) {
      throw new CloudWalletError(
        'Provider is required',
        CloudWalletProvider.GCP, // Default for error context
        'validateConfig'
      );
    }

    switch (config.provider) {
      case CloudWalletProvider.GCP:
        this.validateGcpConfig(config as any);
        break;
      
      case CloudWalletProvider.AWS:
        this.validateAwsConfig(config as any);
        break;
      
      default:
        throw new CloudWalletError(
          `Unsupported provider: ${(config as any).provider}`,
          (config as any).provider,
          'validateConfig'
        );
    }
  }

  /**
   * Validate GCP KMS configuration
   */
  private static validateGcpConfig(config: CloudWalletConfig): void {
    if (config.provider !== CloudWalletProvider.GCP) {
      return;
    }

    const gcpConfig = config as any; // Type assertion for validation

    if (!gcpConfig.projectId) {
      throw new CloudWalletError(
        'GCP projectId is required',
        CloudWalletProvider.GCP,
        'validateGcpConfig'
      );
    }

    if (!gcpConfig.location) {
      throw new CloudWalletError(
        'GCP location is required',
        CloudWalletProvider.GCP,
        'validateGcpConfig'
      );
    }

    if (!gcpConfig.keyRing) {
      throw new CloudWalletError(
        'GCP keyRing is required',
        CloudWalletProvider.GCP,
        'validateGcpConfig'
      );
    }

    if (!gcpConfig.keyName) {
      throw new CloudWalletError(
        'GCP keyName is required',
        CloudWalletProvider.GCP,
        'validateGcpConfig'
      );
    }

    // Either keyFilename or credentials must be provided
    if (!gcpConfig.keyFilename && !gcpConfig.credentials) {
      throw new CloudWalletError(
        'Either keyFilename or credentials must be provided for GCP KMS',
        CloudWalletProvider.GCP,
        'validateGcpConfig'
      );
    }

    // If credentials are provided, validate required fields
    if (gcpConfig.credentials) {
      if (!gcpConfig.credentials.client_email) {
        throw new CloudWalletError(
          'GCP credentials.client_email is required',
          CloudWalletProvider.GCP,
          'validateGcpConfig'
        );
      }

      if (!gcpConfig.credentials.private_key) {
        throw new CloudWalletError(
          'GCP credentials.private_key is required',
          CloudWalletProvider.GCP,
          'validateGcpConfig'
        );
      }

      if (!gcpConfig.credentials.project_id) {
        throw new CloudWalletError(
          'GCP credentials.project_id is required',
          CloudWalletProvider.GCP,
          'validateGcpConfig'
        );
      }
    }
  }

  /**
   * Validate AWS KMS configuration
   */
  private static validateAwsConfig(config: CloudWalletConfig): void {
    if (config.provider !== CloudWalletProvider.AWS) {
      return;
    }

    const awsConfig = config as any; // Type assertion for validation

    if (!awsConfig.region) {
      throw new CloudWalletError(
        'AWS region is required',
        CloudWalletProvider.AWS,
        'validateAwsConfig'
      );
    }

    if (!awsConfig.keyId) {
      throw new CloudWalletError(
        'AWS keyId is required',
        CloudWalletProvider.AWS,
        'validateAwsConfig'
      );
    }

    // At least one authentication method must be available
    if (!awsConfig.accessKeyId && !process.env.AWS_ACCESS_KEY_ID) {
      throw new CloudWalletError(
        'AWS credentials required. Provide accessKeyId/secretAccessKey or set AWS_ACCESS_KEY_ID environment variable',
        CloudWalletProvider.AWS,
        'validateAwsConfig'
      );
    }
  }
}

/**
 * Convenience function to create a cloud wallet
 */
export function createCloudWallet(config: CloudWalletConfig): CloudWallet {
  return CloudWalletFactory.create(config);
}
