import { MemoryKeysHelper } from './memory-keys.helper';

describe('MemoryKeysHelper — org-scoping', () => {
  const userId = 'user-abc';
  const orgId = 'org-xyz';

  describe('with organizationId', () => {
    const keys = new MemoryKeysHelper(orgId);

    it('userMemory includes org prefix', () => {
      expect(keys.userMemory(userId)).toBe(`org:${orgId}:user:${userId}:memory`);
    });

    it('userEntities includes org prefix', () => {
      expect(keys.userEntities(userId)).toBe(`org:${orgId}:user:${userId}:entities`);
    });

    it('semanticMemory includes org prefix', () => {
      expect(keys.semanticMemory(userId)).toBe(`org:${orgId}:semantic:${userId}`);
    });

    it('semanticIndex includes org prefix', () => {
      expect(keys.semanticIndex(userId)).toBe(`org:${orgId}:semantic:index:${userId}`);
    });
  });

  describe('without organizationId (legacy)', () => {
    const keys = new MemoryKeysHelper();

    it('userMemory uses legacy user: prefix', () => {
      expect(keys.userMemory(userId)).toBe(`user:${userId}:memory`);
    });

    it('userEntities uses legacy user: prefix', () => {
      expect(keys.userEntities(userId)).toBe(`user:${userId}:entities`);
    });

    it('semanticMemory uses legacy semantic: prefix', () => {
      expect(keys.semanticMemory(userId)).toBe(`semantic:${userId}`);
    });

    it('semanticIndex uses legacy semantic:index: prefix', () => {
      expect(keys.semanticIndex(userId)).toBe(`semantic:index:${userId}`);
    });
  });

  describe('cross-org isolation', () => {
    it('keys for different orgs are distinct', () => {
      const keysA = new MemoryKeysHelper('org-A');
      const keysB = new MemoryKeysHelper('org-B');
      expect(keysA.userMemory(userId)).not.toBe(keysB.userMemory(userId));
    });

    it('org key and legacy key are distinct', () => {
      const withOrg = new MemoryKeysHelper(orgId);
      const withoutOrg = new MemoryKeysHelper();
      expect(withOrg.userMemory(userId)).not.toBe(withoutOrg.userMemory(userId));
    });
  });
});
