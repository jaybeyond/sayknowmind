import { GdprService } from './gdpr.service';

/**
 * Minimal stubs for services GdprService depends on.
 * Only the methods called by deleteUserData / deleteUserMemory are implemented.
 */
function makeSpanStub() {
  return {
    deleteByUser: jest.fn().mockResolvedValue(3),
  };
}

function makeFeedbackStub() {
  return {
    deleteByUser: jest.fn().mockResolvedValue(2),
    findByUser: jest.fn().mockResolvedValue([]),
  };
}

function makeAdapterStub() {
  return {
    deleteUserAggregations: jest.fn().mockResolvedValue(1),
  };
}

function makeUserMemoryStub() {
  return {};
}

function makeSemanticMemoryStub() {
  return {};
}

function makeEntityStoreStub() {
  return {};
}

/**
 * Build a mock RedisService where scanKeys returns the provided key map
 * and delMultiple is tracked.
 *
 * keyMap: { [pattern]: string[] } — maps each pattern to the keys it should return
 */
function makeRedisStub(keyMap: Record<string, string[]> = {}) {
  return {
    isReady: jest.fn().mockReturnValue(true),
    scanKeys: jest.fn().mockImplementation((pattern: string) => {
      return Promise.resolve(keyMap[pattern] ?? []);
    }),
    delMultiple: jest.fn().mockResolvedValue(undefined),
  };
}

function buildService(redis: ReturnType<typeof makeRedisStub>) {
  return new GdprService(
    makeSpanStub() as any,
    makeFeedbackStub() as any,
    makeAdapterStub() as any,
    redis as any,
    makeUserMemoryStub() as any,
    makeSemanticMemoryStub() as any,
    makeEntityStoreStub() as any,
  );
}

describe('GdprService.deleteUserData — memory key deletion', () => {
  const userId = 'user-42';

  it('deletes memory keys across multiple org prefixes and legacy keys', async () => {
    const seedKeys: Record<string, string[]> = {
      [`org:*:user:${userId}:memory`]: [
        `org:org-A:user:${userId}:memory`,
        `org:org-B:user:${userId}:memory`,
      ],
      [`org:*:user:${userId}:entities`]: [
        `org:org-A:user:${userId}:entities`,
      ],
      [`org:*:semantic:${userId}`]: [
        `org:org-A:semantic:${userId}`,
      ],
      [`org:*:semantic:index:${userId}`]: [],
      [`user:${userId}:memory`]: [`user:${userId}:memory`],
      [`user:${userId}:entities`]: [`user:${userId}:entities`],
      [`semantic:${userId}`]: [`semantic:${userId}`],
      [`semantic:index:${userId}`]: [],
    };

    const redis = makeRedisStub(seedKeys);
    const service = buildService(redis);

    const result = await service.deleteUserData(userId);

    expect(result.success).toBe(true);
    expect(result.memoriesDeleted).toBe(7); // 2+1+1+0+1+1+1+0

    const allDeletedKeys: string[] = (redis.delMultiple.mock.calls[0] as [string[]])[0];
    expect(allDeletedKeys).toContain(`org:org-A:user:${userId}:memory`);
    expect(allDeletedKeys).toContain(`org:org-B:user:${userId}:memory`);
    expect(allDeletedKeys).toContain(`org:org-A:user:${userId}:entities`);
    expect(allDeletedKeys).toContain(`org:org-A:semantic:${userId}`);
    expect(allDeletedKeys).toContain(`user:${userId}:memory`);
    expect(allDeletedKeys).toContain(`user:${userId}:entities`);
    expect(allDeletedKeys).toContain(`semantic:${userId}`);
  });

  it('does not delete keys belonging to a different user', async () => {
    const otherUserId = 'user-99';
    const seedKeys: Record<string, string[]> = {
      [`org:*:user:${userId}:memory`]: [`org:org-A:user:${userId}:memory`],
      [`org:*:user:${userId}:entities`]: [],
      [`org:*:semantic:${userId}`]: [],
      [`org:*:semantic:index:${userId}`]: [],
      [`user:${userId}:memory`]: [],
      [`user:${userId}:entities`]: [],
      [`semantic:${userId}`]: [],
      [`semantic:index:${userId}`]: [],
    };

    const redis = makeRedisStub(seedKeys);
    const service = buildService(redis);
    await service.deleteUserData(userId);

    const allDeletedKeys: string[] = (redis.delMultiple.mock.calls[0] as [string[]])[0];
    const otherUserKeys = allDeletedKeys.filter(k => k.includes(otherUserId));
    expect(otherUserKeys).toHaveLength(0);
  });

  it('returns memoriesDeleted=0 and success=true when no memory keys exist', async () => {
    const redis = makeRedisStub({});
    const service = buildService(redis);

    const result = await service.deleteUserData(userId);

    expect(result.success).toBe(true);
    expect(result.memoriesDeleted).toBe(0);
    expect(redis.delMultiple).not.toHaveBeenCalled();
  });

  it('returns success=true even when Redis is not ready', async () => {
    const redis = makeRedisStub();
    redis.isReady.mockReturnValue(false);
    const service = buildService(redis);

    const result = await service.deleteUserData(userId);

    expect(result.success).toBe(true);
    expect(result.memoriesDeleted).toBe(0);
    expect(redis.delMultiple).not.toHaveBeenCalled();
  });

  it('accumulates totalDeleted from all subsystems', async () => {
    const seedKeys: Record<string, string[]> = {
      [`org:*:user:${userId}:memory`]: [`org:org-A:user:${userId}:memory`],
      [`org:*:user:${userId}:entities`]: [],
      [`org:*:semantic:${userId}`]: [],
      [`org:*:semantic:index:${userId}`]: [],
      [`user:${userId}:memory`]: [],
      [`user:${userId}:entities`]: [],
      [`semantic:${userId}`]: [],
      [`semantic:index:${userId}`]: [],
    };

    const redis = makeRedisStub(seedKeys);
    const service = buildService(redis);

    const result = await service.deleteUserData(userId);

    // spans(3) + feedbacks(2) + aggregations(1) + memories(1) = 7
    expect(result.totalDeleted).toBe(7);
    expect(result.spansDeleted).toBe(3);
    expect(result.feedbacksDeleted).toBe(2);
    expect(result.aggregationsDeleted).toBe(1);
    expect(result.memoriesDeleted).toBe(1);
  });
});
