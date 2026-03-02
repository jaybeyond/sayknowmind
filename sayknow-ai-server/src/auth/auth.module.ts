import { Module, Global } from '@nestjs/common';
import { CryptoService } from './crypto.service';
import { SignatureGuard } from './signature.guard';

@Global()
@Module({
  providers: [CryptoService, SignatureGuard],
  exports: [CryptoService, SignatureGuard],
})
export class AuthModule {}
