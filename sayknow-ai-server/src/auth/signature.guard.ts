import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from './crypto.service';

@Injectable()
export class SignatureGuard implements CanActivate {
  private readonly logger = new Logger(SignatureGuard.name);
  private readonly skipAuth: boolean;
  private readonly aiApiKey: string;

  constructor(
    private cryptoService: CryptoService,
    private configService: ConfigService,
  ) {
    this.skipAuth = this.configService.get('SKIP_AUTH', 'false') === 'true';
    this.aiApiKey = this.configService.get('AI_API_KEY', '');

    if (this.skipAuth) {
      this.logger.warn('⚠️  AUTH DISABLED - Development mode only!');
    } else if (this.aiApiKey) {
      this.logger.log('🔐 AI API Key authentication enabled');
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // Development mode: skip authentication
    if (this.skipAuth) {
      request.clientId = 'dev-client';
      return true;
    }

    // 1) API key authentication (priority)
    const apiKey = request.headers['x-ai-api-key'] || request.headers['authorization']?.replace('Bearer ', '');
    if (apiKey && this.aiApiKey && apiKey === this.aiApiKey) {
      request.clientId = request.headers['x-client-id'] || 'api-key-client';
      this.logger.debug(`✅ API key authenticated: ${request.clientId}`);
      return true;
    }

    // If API key is configured but missing or invalid, reject
    if (this.aiApiKey && !request.headers['x-signature']) {
      throw new UnauthorizedException('Invalid or missing AI API key');
    }

    // 2) RSA signature authentication (legacy fallback)
    const signature = request.headers['x-signature'];
    const timestamp = request.headers['x-timestamp'];
    const clientId = request.headers['x-client-id'];

    if (!signature || !timestamp || !clientId) {
      this.logger.warn('Missing authentication headers');
      throw new UnauthorizedException('Missing authentication headers');
    }

    const payload = JSON.stringify(request.body);
    const isValid = this.cryptoService.verifyClientSignature(
      clientId,
      payload,
      signature,
      timestamp
    );

    if (!isValid) {
      this.logger.warn(`Authentication failed for client: ${clientId}`);
      throw new UnauthorizedException('Invalid signature');
    }

    request.clientId = clientId;
    this.logger.debug(`✅ Authenticated request from: ${clientId}`);
    return true;
  }
}
