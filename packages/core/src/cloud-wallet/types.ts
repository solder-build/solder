import { PublicKey } from "@solana/web3.js";

/**
 * Supported cloud wallet providers
 */
export enum CloudWalletProvider {
  GCP = 'gcp',
  AWS = 'aws',
  // Future providers
  // AZURE = 'azure',
}

/**
 * Base configuration for all cloud wallet providers
 */
export interface BaseCloudWalletConfig {
  /** The cloud provider to use */
  provider: CloudWalletProvider;
  /** Optional custom RPC endpoint for Solana */
  rpcEndpoint?: string;
}

/**
 * GCP KMS specific configuration
 */
export interface GcpKmsConfig extends BaseCloudWalletConfig {
  provider: CloudWalletProvider.GCP;
  /** GCP project ID */
  projectId: string;
  /** GCP location (e.g., 'global', 'us-central1') */
  location: string;
  /** Key ring name in GCP KMS */
  keyRing: string;
  /** Key name in GCP KMS */
  keyName: string;
  /** Key version (optional, defaults to latest) */
  keyVersion?: string;
  /** Path to service account JSON file (optional) */
  keyFilename?: string;
  /** Service account credentials object (alternative to keyFilename) */
  credentials?: {
    client_email: string;
    private_key: string;
    project_id: string;
  };
}

/**
 * AWS KMS specific configuration
 */
export interface AwsKmsConfig extends BaseCloudWalletConfig {
  provider: CloudWalletProvider.AWS;
  /** AWS region (e.g., 'us-east-1') */
  region: string;
  /** KMS key ID or ARN */
  keyId: string;
  /** AWS access key ID (optional, can use environment variables) */
  accessKeyId?: string;
  /** AWS secret access key (optional, can use environment variables) */
  secretAccessKey?: string;
  /** AWS session token (optional, for temporary credentials) */
  sessionToken?: string;
}

/**
 * Union type for all provider configurations
 */
export type CloudWalletConfig = GcpKmsConfig | AwsKmsConfig;

/**
 * Signer interface compatible with @solana/kit
 */
export interface CloudWalletSigner {
  /** Get the public key associated with this wallet */
  getPublicKey(): Promise<PublicKey>;
  /** Sign a message and return the signature */
  signMessage(message: Uint8Array): Promise<Uint8Array>;
  /** Sign a transaction message and return the signature */
  signTransaction(transactionMessage: Uint8Array): Promise<Uint8Array>;
}

/**
 * Cloud wallet interface providing wallet operations
 */
export interface CloudWallet {
  /** Get the public key of this wallet */
  getPublicKey(): Promise<PublicKey>;
  /** Get the Solana address (base58 encoded public key) */
  getAddress(): Promise<string>;
  /** Sign a message */
  signMessage(message: Uint8Array): Promise<Uint8Array>;
  /** Sign a transaction message */
  signTransaction(transactionMessage: Uint8Array): Promise<Uint8Array>;
  /** Get the underlying signer for use with @solana/kit */
  getSigner(): CloudWalletSigner;
  /** Get the provider type */
  getProvider(): CloudWalletProvider;
}

/**
 * Error thrown when cloud wallet operations fail
 */
export class CloudWalletError extends Error {
  constructor(
    message: string,
    public readonly provider: CloudWalletProvider,
    public readonly operation: string,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'CloudWalletError';
  }
}

/**
 * Error thrown when GCP KMS operations fail
 */
export class GcpKmsError extends CloudWalletError {
  constructor(
    message: string,
    operation: string,
    originalError?: Error
  ) {
    super(message, CloudWalletProvider.GCP, operation, originalError);
    this.name = 'GcpKmsError';
  }
}

/**
 * Error thrown when AWS KMS operations fail
 */
export class AwsKmsError extends CloudWalletError {
  constructor(
    message: string,
    operation: string,
    originalError?: Error
  ) {
    super(message, CloudWalletProvider.AWS, operation, originalError);
    this.name = 'AwsKmsError';
  }
}
