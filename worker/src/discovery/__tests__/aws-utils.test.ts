import { describe, it, expect } from 'bun:test';
import {
  isAccessDenied,
  getPartition,
  synthesizeArn,
  sanitizeMetadata,
  withRetry,
} from '../providers/aws-utils';

describe('isAccessDenied', () => {
  it('detects AccessDeniedException by name', () => {
    const err = new Error('denied');
    (err as any).name = 'AccessDeniedException';
    expect(isAccessDenied(err)).toBe(true);
  });

  it('detects UnauthorizedAccess by name', () => {
    const err = new Error('denied');
    (err as any).name = 'UnauthorizedAccess';
    expect(isAccessDenied(err)).toBe(true);
  });

  it('detects AccessDenied by code', () => {
    expect(isAccessDenied({ Code: 'AccessDenied' })).toBe(true);
    expect(isAccessDenied({ code: 'AccessDeniedException' })).toBe(true);
  });

  it('detects 403 status code', () => {
    expect(isAccessDenied({ $metadata: { httpStatusCode: 403 } })).toBe(true);
  });

  it('returns false for other errors', () => {
    expect(isAccessDenied(new Error('timeout'))).toBe(false);
    expect(isAccessDenied(null)).toBe(false);
    expect(isAccessDenied(undefined)).toBe(false);
    expect(isAccessDenied({ $metadata: { httpStatusCode: 500 } })).toBe(false);
  });
});

describe('getPartition', () => {
  it('returns aws for standard regions', () => {
    expect(getPartition('us-east-1')).toBe('aws');
    expect(getPartition('eu-west-1')).toBe('aws');
    expect(getPartition('ap-southeast-1')).toBe('aws');
  });

  it('returns aws-cn for China regions', () => {
    expect(getPartition('cn-north-1')).toBe('aws-cn');
    expect(getPartition('cn-northwest-1')).toBe('aws-cn');
  });

  it('returns aws-us-gov for GovCloud regions', () => {
    expect(getPartition('us-gov-west-1')).toBe('aws-us-gov');
    expect(getPartition('us-gov-east-1')).toBe('aws-us-gov');
  });
});

describe('synthesizeArn', () => {
  it('creates a standard ARN', () => {
    expect(
      synthesizeArn({
        service: 'ec2',
        region: 'us-east-1',
        accountId: '123456789012',
        resourceType: 'instance',
        resourceId: 'i-1234567890abcdef0',
      }),
    ).toBe('arn:aws:ec2:us-east-1:123456789012:instance/i-1234567890abcdef0');
  });

  it('handles global region', () => {
    const arn = synthesizeArn({
      service: 's3',
      region: 'global',
      accountId: '123456789012',
      resourceType: 'bucket',
      resourceId: 'my-bucket',
    });
    expect(arn).toBe('arn:aws:s3::123456789012:bucket/my-bucket');
  });

  it('uses correct partition for China regions', () => {
    const arn = synthesizeArn({
      service: 'ec2',
      region: 'cn-north-1',
      accountId: '123456789012',
      resourceType: 'instance',
      resourceId: 'i-abc',
    });
    expect(arn).toContain('arn:aws-cn:');
  });
});

describe('sanitizeMetadata', () => {
  it('returns simple metadata unchanged', () => {
    const input = { key: 'value', num: 42, bool: true };
    const { metadata, truncated } = sanitizeMetadata(input);
    expect(metadata).toEqual(input);
    expect(truncated).toBe(false);
  });

  it('truncates deep nesting', () => {
    const input = {
      a: { b: { c: { d: { e: 'too deep' } } } },
    };
    const { metadata, truncated } = sanitizeMetadata(input);
    expect(truncated).toBe(true);
    // Depth 3 should be the limit
    expect((metadata as any).a.b.c.d).toBe('[truncated]');
  });

  it('truncates large arrays', () => {
    const input = {
      items: Array.from({ length: 200 }, (_, i) => i),
    };
    const { metadata, truncated } = sanitizeMetadata(input);
    expect(truncated).toBe(true);
    expect((metadata as any).items).toHaveLength(100);
  });

  it('converts Date objects to ISO strings', () => {
    const date = new Date('2024-01-15T10:00:00Z');
    const { metadata } = sanitizeMetadata({ date });
    expect((metadata as any).date).toBe('2024-01-15T10:00:00.000Z');
  });

  it('handles null and undefined values', () => {
    const { metadata } = sanitizeMetadata({ a: null, b: undefined });
    expect((metadata as any).a).toBeNull();
    expect((metadata as any).b).toBeUndefined();
  });

  it('truncates metadata exceeding 64KB', () => {
    const input = {
      bigString: 'x'.repeat(100_000),
    };
    const { metadata, truncated } = sanitizeMetadata(input);
    expect(truncated).toBe(true);
    expect((metadata as any)._metadataTruncated).toBe(true);
  });
});

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const result = await withRetry(async () => 42);
    expect(result).toBe(42);
  });

  it('retries on throttling errors', async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts++;
      if (attempts < 3) {
        const err = new Error('throttled');
        (err as any).name = 'ThrottlingException';
        throw err;
      }
      return 'ok';
    }, 5);
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('does not retry on non-throttling errors', async () => {
    let attempts = 0;
    await expect(
      withRetry(async () => {
        attempts++;
        throw new Error('not throttled');
      }),
    ).rejects.toThrow('not throttled');
    expect(attempts).toBe(1);
  });
});
