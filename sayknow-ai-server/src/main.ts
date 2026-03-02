import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { json, urlencoded } from 'express';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
  });

  // Body size limit for image uploads (10MB)
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '10mb' }));

  // Global validation pipe
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  // CORS - Allow backend server + admin panel
  app.enableCors({
    origin: (origin, callback) => {
      // Allow all localhost (development environment)
      if (!origin || origin.startsWith('http://localhost')) {
        callback(null, true);
      } else if (process.env.ALLOWED_ORIGINS?.split(',').includes(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    methods: ['POST', 'GET', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Signature', 'X-Timestamp', 'X-Client-Id', 'X-AI-Api-Key', 'Authorization'],
  });

  const port = process.env.PORT || 4000;
  await app.listen(port);
  
  const useZai = process.env.USE_ZAI !== 'false';
  const hasZaiKey = !!process.env.ZAI_API_KEY;
  
  logger.log(`🚀 SayKnow AI Server running on port ${port}`);
  logger.log(`🔐 RSA Authentication: ${process.env.SKIP_AUTH === 'true' ? 'DISABLED' : 'ENABLED'}`);
  logger.log(`🤖 AI: Z.AI (GLM-4.7) ${useZai && hasZaiKey ? '✅' : '❌'} → Vertex AI (fallback)`);
  logger.log(`📄 OCR: PaddleOCR`);
  logger.log(`🔍 Search: SearXNG`);
}

bootstrap();
