import { KeyManagementServiceClient } from '@google-cloud/kms';
import { PublicKey } from '@solana/web3.js';
import { 
  CloudWallet, 
  CloudWalletSigner, 
  CloudWalletProvider, 
  GcpKmsConfig, 
  GcpKmsError 
} from '../types';

/**
 * GCP KMS implementation of CloudWallet
 */
export class GcpKmsWallet implements CloudWallet, CloudWalletSigner {
  private readonly kmsClient: KeyManagementServiceClient;
  private readonly keyPath: string;
  private publicKey: PublicKey | null = null;

  constructor(private readonly config: GcpKmsConfig) {
    // Initialize KMS client with credentials
    const clientConfig: any = {};
    
    if (config.keyFilename) {
      clientConfig.keyFilename = config.keyFilename;
    } else if (config.credentials) {
      clientConfig.credentials = config.credentials;
    }

    this.kmsClient = new KeyManagementServiceClient(clientConfig);
    
    // Build the key path
    const keyVersion = config.keyVersion || '1';
    this.keyPath = this.kmsClient.cryptoKeyVersionPath(
      config.projectId,
      config.location,
      config.keyRing,
      config.keyName,
      keyVersion
    );
  }

  /**
   * Get the public key from GCP KMS and convert to Solana format
   */
  async getPublicKey(): Promise<PublicKey> {
    if (this.publicKey) {
      return this.publicKey;
    }

    try {
      const [publicKeyResponse] = await this.kmsClient.getPublicKey({
        name: this.keyPath,
      });

      if (!publicKeyResponse.pem) {
        throw new GcpKmsError(
          'No public key found in KMS response',
          'getPublicKey'
        );
      }

      // Convert PEM to Solana PublicKey
      this.publicKey = this.pemToSolanaPublicKey(publicKeyResponse.pem);
      return this.publicKey;
    } catch (error) {
      throw new GcpKmsError(
        `Failed to retrieve public key from GCP KMS: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'getPublicKey',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get the Solana address (base58 encoded public key)
   */
  async getAddress(): Promise<string> {
    const publicKey = await this.getPublicKey();
    return publicKey.toBase58();
  }

  /**
   * Sign a message using GCP KMS
   */
  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    try {
      // For Ed25519 software keys, we must send the raw message, not a digest
      const [signResponse] = await this.kmsClient.asymmetricSign({
        name: this.keyPath,
        data: message,
      });

      if (!signResponse.signature) {
        throw new GcpKmsError(
          'No signature returned from KMS',
          'signMessage'
        );
      }

      return new Uint8Array(Buffer.from(signResponse.signature as Uint8Array));
    } catch (error) {
      throw new GcpKmsError(
        `Failed to sign message with GCP KMS: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'signMessage',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Sign a transaction message using GCP KMS
   */
  async signTransaction(transactionMessage: Uint8Array): Promise<Uint8Array> {
    // For Solana transactions, we sign the message directly
    return this.signMessage(transactionMessage);
  }

  /**
   * Get the signer interface for use with @solana/kit
   */
  getSigner(): CloudWalletSigner {
    return this;
  }

  /**
   * Get the provider type
   */
  getProvider(): CloudWalletProvider {
    return CloudWalletProvider.GCP;
  }

  /**
   * Convert PEM format public key to Solana PublicKey
   */
  private pemToSolanaPublicKey(pem: string): PublicKey {
    try {
      // Remove PEM headers and decode base64
      const base64Data = pem
        .replace(/-----BEGIN PUBLIC KEY-----/, '')
        .replace(/-----END PUBLIC KEY-----/, '')
        .replace(/\s/g, '');
      
      const keyBytes = Buffer.from(base64Data, 'base64');
      
      // For Ed25519, the public key is the last 32 bytes
      // GCP KMS returns DER format, we need to extract the raw key
      const publicKeyBytes = keyBytes.slice(-32);
      
      return new PublicKey(publicKeyBytes);
    } catch (error) {
      throw new GcpKmsError(
        `Failed to convert PEM to Solana PublicKey: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'pemToSolanaPublicKey',
        error instanceof Error ? error : undefined
      );
    }
  }

}
