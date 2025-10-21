import { KMSClient, GetPublicKeyCommand, SignCommand } from '@aws-sdk/client-kms';
import { PublicKey } from '@solana/web3.js';
import { 
  CloudWallet, 
  CloudWalletSigner, 
  CloudWalletProvider, 
  AwsKmsConfig, 
  AwsKmsError 
} from '../types';

/**
 * AWS KMS implementation of CloudWallet
 */
export class AwsKmsWallet implements CloudWallet, CloudWalletSigner {
  private readonly kmsClient: KMSClient;
  private readonly keyId: string;
  private publicKey: PublicKey | null = null;

  constructor(private readonly config: AwsKmsConfig) {
    // Initialize KMS client with credentials
    const clientConfig: any = {
      region: config.region,
    };
    
    // Add credentials if provided
    if (config.accessKeyId && config.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        ...(config.sessionToken && { sessionToken: config.sessionToken }),
      };
    }
    // Otherwise, AWS SDK will use environment variables or IAM roles

    this.kmsClient = new KMSClient(clientConfig);
    this.keyId = config.keyId;
  }

  /**
   * Get the public key from AWS KMS and convert to Solana format
   */
  async getPublicKey(): Promise<PublicKey> {
    if (this.publicKey) {
      return this.publicKey;
    }

    try {
      const command = new GetPublicKeyCommand({
        KeyId: this.keyId,
      });

      const response = await this.kmsClient.send(command);

      if (!response.PublicKey) {
        throw new AwsKmsError(
          'No public key found in AWS KMS response',
          'getPublicKey'
        );
      }

      // Convert DER to Solana PublicKey
      this.publicKey = this.derToSolanaPublicKey(response.PublicKey);
      return this.publicKey;
    } catch (error) {
      throw new AwsKmsError(
        `Failed to retrieve public key from AWS KMS: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
   * Sign a message using AWS KMS
   */
  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    try {
      const command = new SignCommand({
        KeyId: this.keyId,
        Message: message,
        MessageType: 'RAW', // For Ed25519, we send raw message
        SigningAlgorithm: 'ECDSA_SHA_256', // AWS uses ECDSA for Ed25519
      });

      const response = await this.kmsClient.send(command);

      if (!response.Signature) {
        throw new AwsKmsError(
          'No signature returned from AWS KMS',
          'signMessage'
        );
      }

      // AWS KMS returns DER-encoded signature, we need to extract the raw signature
      const derSignature = new Uint8Array(response.Signature);
      const rawSignature = this.extractRawSignatureFromDer(derSignature);
      
      return rawSignature;
    } catch (error) {
      throw new AwsKmsError(
        `Failed to sign message with AWS KMS: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'signMessage',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Sign a transaction message using AWS KMS
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
    return CloudWalletProvider.AWS;
  }

  /**
   * Convert DER format public key to Solana PublicKey
   * AWS KMS returns DER-encoded SubjectPublicKeyInfo format
   */
  private derToSolanaPublicKey(der: Uint8Array): PublicKey {
    try {
      // For Ed25519, the public key is typically the last 32 bytes of the DER structure
      // AWS KMS returns DER-encoded SubjectPublicKeyInfo
      
      // Find the start of the actual public key data
      // Look for the 0x04 byte that indicates uncompressed public key
      let keyStart = -1;
      for (let i = 0; i < der.length - 32; i++) {
        if (der[i] === 0x04) {
          keyStart = i + 1;
          break;
        }
      }

      if (keyStart === -1) {
        // Fallback: try to extract the last 32 bytes
        const publicKeyBytes = der.slice(-32);
        return new PublicKey(publicKeyBytes);
      }

      // Extract the 32-byte Ed25519 public key
      const publicKeyBytes = der.slice(keyStart, keyStart + 32);
      
      if (publicKeyBytes.length !== 32) {
        throw new AwsKmsError(
          `Invalid public key length: expected 32 bytes, got ${publicKeyBytes.length}`,
          'derToSolanaPublicKey'
        );
      }

      return new PublicKey(publicKeyBytes);
    } catch (error) {
      throw new AwsKmsError(
        `Failed to convert DER to Solana PublicKey: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'derToSolanaPublicKey',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Extract raw Ed25519 signature from DER-encoded signature
   * AWS KMS returns DER-encoded signature, but Solana expects raw 64-byte signature
   */
  private extractRawSignatureFromDer(derSignature: Uint8Array): Uint8Array {
    try {
      // DER signature structure for Ed25519:
      // 0x30 [length] 0x02 [r_length] [r_bytes] 0x02 [s_length] [s_bytes]
      
      if (derSignature.length < 8) {
        throw new AwsKmsError(
          `Invalid DER signature length: expected at least 8 bytes, got ${derSignature.length}`,
          'extractRawSignatureFromDer'
        );
      }

      // Find the start of the r component (after 0x30, length, 0x02)
      let rStart = 3;
      if (derSignature[1] === 0x81) {
        // Long form length encoding
        rStart = 4;
      } else if (derSignature[1] === 0x82) {
        // Very long form length encoding
        rStart = 5;
      }

      // Skip the r component to find s component
      const rLength = derSignature[rStart];
      if (rLength === undefined) {
        throw new AwsKmsError(
          'Invalid DER signature: missing r component length',
          'extractRawSignatureFromDer'
        );
      }
      
      let sStart = rStart + 1 + rLength + 1; // +1 for 0x02, +1 for s length byte
      
      const sLength = derSignature[sStart];
      if (sLength === undefined) {
        throw new AwsKmsError(
          'Invalid DER signature: missing s component length',
          'extractRawSignatureFromDer'
        );
      }
      
      const sBytes = derSignature.slice(sStart + 1, sStart + 1 + sLength);
      
      // Extract r bytes (skip leading zeros if any)
      const rBytes = derSignature.slice(rStart + 1, rStart + 1 + rLength);
      
      // Remove leading zeros to get 32-byte components
      const rTrimmed = this.removeLeadingZeros(rBytes);
      const sTrimmed = this.removeLeadingZeros(sBytes);
      
      // Pad to 32 bytes if needed
      const rPadded = this.padTo32Bytes(rTrimmed);
      const sPadded = this.padTo32Bytes(sTrimmed);
      
      // Combine r and s to get 64-byte raw signature
      const rawSignature = new Uint8Array(64);
      rawSignature.set(rPadded, 0);
      rawSignature.set(sPadded, 32);
      
      return rawSignature;
    } catch (error) {
      throw new AwsKmsError(
        `Failed to extract raw signature from DER: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'extractRawSignatureFromDer',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Remove leading zeros from a byte array
   */
  private removeLeadingZeros(bytes: Uint8Array): Uint8Array {
    let start = 0;
    while (start < bytes.length && bytes[start] === 0) {
      start++;
    }
    return bytes.slice(start);
  }

  /**
   * Pad a byte array to exactly 32 bytes
   */
  private padTo32Bytes(bytes: Uint8Array): Uint8Array {
    if (bytes.length > 32) {
      throw new AwsKmsError(
        `Signature component too long: expected max 32 bytes, got ${bytes.length}`,
        'padTo32Bytes'
      );
    }
    
    if (bytes.length === 32) {
      return bytes;
    }
    
    const padded = new Uint8Array(32);
    padded.set(bytes, 32 - bytes.length);
    return padded;
  }
}
