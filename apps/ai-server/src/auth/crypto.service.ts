import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class CryptoService implements OnModuleInit {
  private readonly logger = new Logger(CryptoService.name);
  
  private serverPrivateKey: string;
  private serverPublicKey: string;
  private clientPublicKeys: Map<string, string> = new Map();

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    await this.loadKeys();
  }

  private async loadKeys() {
    try {
      // Load from environment variables (for Railway) - v2
      const privateKeyEnv = this.configService.get('PRIVATE_KEY');
      this.logger.log(`🔑 PRIVATE_KEY env exists: ${!!privateKeyEnv}`);
      const publicKeyEnv = this.configService.get('PUBLIC_KEY');
      
      if (privateKeyEnv && publicKeyEnv) {
        // Load from environment variables (base64 decode)
        this.serverPrivateKey = Buffer.from(privateKeyEnv, 'base64').toString('utf8');
        this.serverPublicKey = Buffer.from(publicKeyEnv, 'base64').toString('utf8');
        this.logger.log('✅ Server RSA keys loaded from environment variables');
      } else {
        // Load from files (for local development)
        const privateKeyPath = this.configService.get('PRIVATE_KEY_PATH', './keys/private.pem');
        const publicKeyPath = this.configService.get('PUBLIC_KEY_PATH', './keys/public.pem');
        
        const privExists = fs.existsSync(path.resolve(privateKeyPath));
        const pubExists = fs.existsSync(path.resolve(publicKeyPath));
        
        if (privExists && pubExists) {
          this.serverPrivateKey = fs.readFileSync(path.resolve(privateKeyPath), 'utf8');
          this.serverPublicKey = fs.readFileSync(path.resolve(publicKeyPath), 'utf8');
          this.logger.log('✅ Server RSA keys loaded from files');
        } else {
          // No key files - auto-generate temporary keys (for Railway and container environments)
          this.logger.warn('⚠️ RSA key files not found, generating temporary keys...');
          const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
          });
          this.serverPrivateKey = privateKey;
          this.serverPublicKey = publicKey;
          this.logger.log('✅ Temporary RSA keys generated');
        }
      }

      // Load client public keys
      const clientKeyEnv = this.configService.get('CLIENT_PUBLIC_KEY');
      if (clientKeyEnv) {
        // Load from environment variables (base64 decode)
        const clientKey = Buffer.from(clientKeyEnv, 'base64').toString('utf8');
        this.clientPublicKeys.set('sayknowai-backend', clientKey);
        this.logger.log('✅ Client key loaded from environment variable');
      } else {
        // Load from files
        const clientKeysConfig = this.configService.get('ALLOWED_CLIENT_KEYS', '');
        const keyPaths = clientKeysConfig.split(',').filter(Boolean);
        
        for (const keyPath of keyPaths) {
          const resolvedPath = path.resolve(keyPath.trim());
          if (fs.existsSync(resolvedPath)) {
            const clientId = path.basename(keyPath, '.pub');
            const publicKey = fs.readFileSync(resolvedPath, 'utf8');
            this.clientPublicKeys.set(clientId, publicKey);
            this.logger.log(`✅ Client key loaded: ${clientId}`);
          }
        }
      }

      if (this.clientPublicKeys.size === 0) {
        this.logger.warn('⚠️ No client public keys loaded!');
      }
    } catch (error) {
      const skipAuth = this.configService.get('SKIP_AUTH', 'false') === 'true';
      if (skipAuth) {
        this.logger.warn('⚠️ RSA keys not found, but SKIP_AUTH=true — continuing without keys');
      } else {
        this.logger.error('❌ Failed to load RSA keys:', error.message);
        throw error;
      }
    }
  }

  /**
   * Verify client request signature
   */
  verifyClientSignature(
    clientId: string,
    payload: string,
    signature: string,
    timestamp: string
  ): boolean {
    try {
      const clientPublicKey = this.clientPublicKeys.get(clientId);
      if (!clientPublicKey) {
        this.logger.warn(`Unknown client: ${clientId}`);
        return false;
      }

      // Timestamp verification (within 5 minutes)
      const requestTime = parseInt(timestamp);
      const now = Date.now();
      if (Math.abs(now - requestTime) > 5 * 60 * 1000) {
        this.logger.warn(`Request timestamp expired: ${timestamp}`);
        return false;
      }

      // Signature verification
      const dataToVerify = `${timestamp}.${payload}`;
      const verifier = crypto.createVerify('RSA-SHA256');
      verifier.update(dataToVerify);
      
      const isValid = verifier.verify(clientPublicKey, signature, 'base64');
      
      if (!isValid) {
        this.logger.warn(`Invalid signature from client: ${clientId}`);
      }
      
      return isValid;
    } catch (error) {
      this.logger.error('Signature verification error:', error.message);
      return false;
    }
  }

  /**
   * Generate server response signature
   * Returns dummy signature in SKIP_AUTH mode (safe without keys)
   */
  signResponse(payload: string): { signature: string; timestamp: string } {
    const timestamp = Date.now().toString();
    
    if (!this.serverPrivateKey) {
      // Development mode (SKIP_AUTH=true) - return dummy signature without keys
      return { signature: 'dev-mode-no-signature', timestamp };
    }
    
    const dataToSign = `${timestamp}.${payload}`;
    
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(dataToSign);
    const signature = signer.sign(this.serverPrivateKey, 'base64');
    
    return { signature, timestamp };
  }

  /**
   * Return server public key (used by client for response verification)
   */
  getServerPublicKey(): string {
    return this.serverPublicKey;
  }

  /**
   * Register client (add new client at runtime)
   */
  registerClient(clientId: string, publicKey: string): void {
    this.clientPublicKeys.set(clientId, publicKey);
    this.logger.log(`✅ New client registered: ${clientId}`);
  }
}
