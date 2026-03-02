import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as sharp from 'sharp';

interface FileInput {
  name: string;
  type: string;
  data: string; // base64
}

@Injectable()
export class OCRService implements OnModuleInit {
  private readonly logger = new Logger(OCRService.name);
  private ocrClient: AxiosInstance;
  private isAvailable = false;
  private ocrEndpoint: string;

  constructor(private configService: ConfigService) {
    this.ocrEndpoint = this.configService.get(
      'OCR_ENDPOINT',
      'http://localhost:8000'
    );

    this.ocrClient = axios.create({
      baseURL: this.ocrEndpoint,
      timeout: 120000, // 120 seconds (EasyOCR takes time on CPU)
    });
  }

  async onModuleInit() {
    await this.checkAvailability();
  }

  private async checkAvailability() {
    try {
      const response = await this.ocrClient.get('/health');
      const data = response.data;
      
      if (data.model_loaded) {
        this.isAvailable = true;
        this.logger.log('✅ PaddleOCR service is available');
      } else if (data.model_loading) {
        this.logger.log('⏳ PaddleOCR model is still loading...');
        this.isAvailable = false;
      } else {
        this.logger.warn(`⚠️ PaddleOCR model error: ${data.model_error}`);
        this.isAvailable = false;
      }
    } catch (error) {
      this.logger.warn('⚠️ PaddleOCR service not available');
      this.isAvailable = false;
    }
  }

  /**
   * Process file (image/PDF)
   */
  async processFile(file: FileInput): Promise<string> {
    const { name, type, data } = file;
    this.logger.log(`📄 Processing file: ${name} (${type}), data length: ${data?.length || 0}`);

    try {
      // Image file
      if (type.startsWith('image/')) {
        this.logger.log(`🖼️ Processing as image file`);
        const result = await this.processImage(data);
        this.logger.log(`📝 Image processing result: ${result.substring(0, 100)}...`);
        return result;
      }

      // PDF file
      if (type === 'application/pdf') {
        this.logger.log(`📑 Processing as PDF file`);
        const result = await this.processPDF(data);
        this.logger.log(`📝 PDF processing result: ${result.substring(0, 100)}...`);
        return result;
      }

      // Text file
      if (type.startsWith('text/') || type === 'application/json') {
        this.logger.log(`📝 Processing as text file`);
        return Buffer.from(data, 'base64').toString('utf-8');
      }

      this.logger.warn(`Unsupported file type: ${type}`);
      return `[File: ${name}] - Unsupported file format.`;
    } catch (error) {
      this.logger.error(`❌ File processing error: ${error.message}`);
      this.logger.error(`❌ Error stack: ${error.stack}`);
      return `[File: ${name}] - Error occurred during processing: ${error.message}`;
    }
  }

  /**
   * Image OCR processing
   */
  private async processImage(base64Data: string): Promise<string> {
    try {
      this.logger.log(`🔄 Starting image OCR processing...`);
      
      const imageBuffer = Buffer.from(base64Data, 'base64');
      this.logger.log(`📦 Image buffer size: ${imageBuffer.length} bytes`);
      
      const processedImage = await this.preprocessImage(imageBuffer);
      this.logger.log(`📐 Processed image size: ${processedImage.length} bytes`);

      // Re-check service availability
      if (!this.isAvailable) {
        this.logger.log(`⏳ OCR service not available, checking...`);
        await this.checkAvailability();
      }

      if (this.isAvailable) {
        this.logger.log(`📤 Sending image to OCR server: ${this.ocrEndpoint}/extract`);
        
        const response = await this.ocrClient.post('/extract', {
          image: processedImage.toString('base64'),
        });

        this.logger.log(`📥 OCR response status: ${response.status}`);
        this.logger.log(`📥 OCR response data: ${JSON.stringify(response.data).substring(0, 200)}`);

        const text = response.data.text || '';
        const confidence = response.data.confidence || 0;
        
        this.logger.log(`✅ OCR completed: ${text.length} chars, confidence: ${confidence.toFixed(2)}`);
        
        if (text.length === 0) {
          return '[Image] - Cannot extract text. Either no text in image or unsupported format.';
        }
        
        return text;
      } else {
        this.logger.warn(`⚠️ OCR service is not available`);
        return '[Image] - OCR service is disabled, cannot extract text.';
      }
    } catch (error) {
      this.logger.error(`❌ Image OCR error: ${error.message}`);
      this.logger.error(`❌ Error stack: ${error.stack}`);
      if (error.response) {
        this.logger.error(`❌ Response status: ${error.response.status}`);
        this.logger.error(`❌ Response data: ${JSON.stringify(error.response.data)}`);
      }
      // Return friendly message to user even on error (instead of throw)
      return `[Image] - OCR processing error: ${error.message}`;
    }
  }

  /**
   * PDF processing
   */
  private async processPDF(base64Data: string): Promise<string> {
    try {
      // Re-check service availability
      if (!this.isAvailable) {
        await this.checkAvailability();
      }

      if (this.isAvailable) {
        const response = await this.ocrClient.post('/extract-pdf', {
          pdf: base64Data,
          max_pages: 10,
        });

        const text = response.data.text || '';
        const pages = response.data.pages || 0;
        
        this.logger.log(`✅ PDF OCR completed: ${text.length} chars from ${pages} pages`);
        return text;
      } else {
        return '[PDF File] - OCR service is disabled, cannot extract text.';
      }
    } catch (error) {
      this.logger.error('PDF processing error:', error.message);
      throw error;
    }
  }

  /**
   * Image preprocessing
   */
  private async preprocessImage(imageBuffer: Buffer): Promise<Buffer> {
    try {
      const processed = await sharp(imageBuffer)
        .resize(2048, 2048, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .png()
        .toBuffer();

      return processed;
    } catch (error) {
      this.logger.warn('Image preprocessing failed, using original');
      return imageBuffer;
    }
  }

  /**
   * Check service status
   */
  isReady(): boolean {
    return this.isAvailable;
  }

  /**
   * Refresh service status
   */
  async refreshStatus(): Promise<boolean> {
    await this.checkAvailability();
    return this.isAvailable;
  }
}
