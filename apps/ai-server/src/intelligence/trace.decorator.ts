import { Inject } from '@nestjs/common';
import { TracerService } from './tracer.service';
import { SpanType, SpanResult } from './dto/span.dto';

/**
 * TRACER_SERVICE injection 토large
 * 
 * decorator에서 TracerService를 injection받기 above한 심볼is.
 */
export const TRACER_SERVICE = Symbol('TRACER_SERVICE');

/**
 * @Trace decorator options
 */
export interface TraceOptions {
  /**
   * Span type (default: AI_CALL)
   */
  type?: SpanType;
  
  /**
   * userId를 추출할 파라미터 인덱스 또는 속성 경로
   * 예: 0 (first 파라미터), 'dto.userId' (object 속성)
   */
  userIdParam?: number | string;
  
  /**
   * sessionId를 추출할 파라미터 인덱스 또는 속성 경로
   * 예: 0 (first 파라미터), 'dto.sessionId' (object 속성)
   */
  sessionIdParam?: number | string;
  
  /**
   * 추가 Metadata를 추출할 함수
   */
  extractMetadata?: (args: any[]) => Record<string, any>;
}

/**
 * object에서 속성 경로로 value 추출
 * 
 * @param obj 대상 object
 * @param path 속성 경로 (예: 'user.id', 'dto.sessionId')
 * @returns 추출된 value 또는 undefined
 */
function getValueByPath(obj: any, path: string): any {
  if (!obj || !path) return undefined;
  
  const parts = path.split('.');
  let current = obj;
  
  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[part];
  }
  
  return current;
}

/**
 * 메서드 파라미터에서 userId 또는 sessionId 추출
 * 
 * @param args 메서드 인자 array
 * @param param 파라미터 인덱스 또는 속성 경로
 * @returns 추출된 value 또는 undefined
 */
function extractParam(args: any[], param: number | string | undefined): string | undefined {
  if (param === undefined) return undefined;
  
  if (typeof param === 'number') {
    // 인덱스로 직접 접근
    const value = args[param];
    return typeof value === 'string' ? value : undefined;
  }
  
  if (typeof param === 'string') {
    // 속성 경로로 접근 (예: '0.userId' 또는 'dto.userId')
    const parts = param.split('.');
    const firstPart = parts[0];
    
    // first partial이 숫자면 인덱스로 처리
    const index = parseInt(firstPart, 10);
    if (!isNaN(index) && index >= 0 && index < args.length) {
      const remainingPath = parts.slice(1).join('.');
      if (remainingPath) {
        return getValueByPath(args[index], remainingPath);
      }
      const value = args[index];
      return typeof value === 'string' ? value : undefined;
    }
    
    // 모든 인자에서 속성 경로 검색
    for (const arg of args) {
      if (arg && typeof arg === 'object') {
        const value = getValueByPath(arg, param);
        if (value !== undefined) {
          return typeof value === 'string' ? value : String(value);
        }
      }
    }
  }
  
  return undefined;
}

/**
 * @Trace decorator
 * 
 * 메서드를 자동으로 추적하는 decoratoris.
 * 메서드 호출 시 create Span하고, 완료 또는 on failure Span shutdowndoes.
 * 
 * Requirements: 7.3
 * - AI 호출이 발생할 when, Tracer_Service가 AI_Router에 injection되어 자동으로 추적해야 does
 * 
 * @param typeOrOptions SpanType 또는 TraceOptions
 * @returns 메서드 decorator
 * 
 * @example
 * // default 사용법 (SpanType만 지정)
 * @Trace(SpanType.AI_CALL)
 * async chatWithModel(messages: Message[]): Promise<Response> { ... }
 * 
 * @example
 * // options과 함께 사용
 * @Trace({
 *   type: SpanType.AI_CALL,
 *   userIdParam: '0.userId',
 *   sessionIdParam: '0.sessionId',
 * })
 * async chat(dto: ChatDto): Promise<Response> { ... }
 */
export function Trace(typeOrOptions?: SpanType | TraceOptions): MethodDecorator {
  // options 정규화
  const options: TraceOptions = typeof typeOrOptions === 'string'
    ? { type: typeOrOptions as SpanType }
    : typeOrOptions || {};
  
  const spanType = options.type || SpanType.AI_CALL;

  return function (
    target: any,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor {
    const originalMethod = descriptor.value;
    const methodName = String(propertyKey);

    descriptor.value = async function (...args: any[]): Promise<any> {
      // TracerService 인스턴스 가져오기
      const tracerService: TracerService | undefined = 
        (this as any).tracerService || 
        (this as any).tracer ||
        (this as any)[TRACER_SERVICE];

      // TracerServiceif not present 원본 메서드 실행
      if (!tracerService) {
        return originalMethod.apply(this, args);
      }

      // userId, sessionId 추출
      const userId = extractParam(args, options.userIdParam);
      const sessionId = extractParam(args, options.sessionIdParam);

      // 추가 Metadata 추출
      let additionalMetadata: Record<string, any> = {};
      if (options.extractMetadata) {
        try {
          additionalMetadata = options.extractMetadata(args);
        } catch {
          // Metadata 추출 on failure 무시
        }
      }

      // Start Span
      const span = tracerService.startSpan({
        type: spanType,
        userId,
        sessionId,
        metadata: {
          method: methodName,
          className: target.constructor?.name || 'Unknown',
          ...additionalMetadata,
        },
      });

      const startTime = Date.now();

      try {
        // 원본 메서드 실행
        const result = await originalMethod.apply(this, args);

        // End Span (성공)
        const latencyMs = Date.now() - startTime;
        const spanResult: SpanResult = {
          success: true,
          latencyMs,
          // Result에서 추가 info 추출 시도
          modelUsed: result?.modelUsed || result?.model,
          tokensUsed: result?.tokensUsed || result?.usage?.total_tokens,
          responseLength: typeof result === 'string' 
            ? result.length 
            : result?.content?.length || result?.response?.length,
        };

        await tracerService.endSpan(span.id, spanResult);

        return result;
      } catch (error) {
        // End Span (실패)
        const latencyMs = Date.now() - startTime;
        
        // fallback 사용 whether 확인
        const fallbackUsed = (error as any)?.fallbackUsed || false;
        
        await tracerService.recordError(
          span.id, 
          error instanceof Error ? error : new Error(String(error)),
          fallbackUsed,
        );

        // 원래 에러 다시 throw
        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * TracerService injection decorator
 * 
 * 클래스에 TracerService를 injection하기 above한 프로퍼티 decoratoris.
 * @Trace decorator와 함께 uses.
 * 
 * @example
 * @Injectable()
 * class MyService {
 *   @InjectTracer()
 *   private tracerService: TracerService;
 *   
 *   @Trace(SpanType.AI_CALL)
 *   async myMethod() { ... }
 * }
 */
export function InjectTracer(): PropertyDecorator {
  return Inject(TracerService);
}

/**
 * 클래스 레벨 Trace decorator
 * 
 * 클래스의 모든 public async 메서드에 자동으로 @Trace를 applies.
 * 
 * @param defaultType default SpanType
 * @returns 클래스 decorator
 * 
 * @example
 * @TraceAll(SpanType.AI_CALL)
 * @Injectable()
 * class AIService {
 *   constructor(private tracerService: TracerService) {}
 *   
 *   async chat() { ... }  // 자동으로 추적됨
 *   async search() { ... } // 자동으로 추적됨
 * }
 */
export function TraceAll(defaultType: SpanType = SpanType.AI_CALL): ClassDecorator {
  return function (target: Function): void {
    const prototype = target.prototype;
    const propertyNames = Object.getOwnPropertyNames(prototype);

    for (const propertyName of propertyNames) {
      // constructor 제외
      if (propertyName === 'constructor') continue;

      const descriptor = Object.getOwnPropertyDescriptor(prototype, propertyName);
      if (!descriptor || typeof descriptor.value !== 'function') continue;

      // async 함수인지 확인 (AsyncFunction 또는 Promise 반환)
      const isAsync = descriptor.value.constructor?.name === 'AsyncFunction' ||
        descriptor.value.toString().includes('async');

      if (isAsync) {
        // @Trace decorator 적용
        const tracedDescriptor = Trace(defaultType)(
          prototype,
          propertyName,
          descriptor,
        );
        
        if (tracedDescriptor) {
          Object.defineProperty(prototype, propertyName, tracedDescriptor);
        }
      }
    }
  };
}
