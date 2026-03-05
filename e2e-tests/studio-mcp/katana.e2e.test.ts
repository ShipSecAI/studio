import { Katana } from '../../studio/components/katana';

describe('Katana component E2E tests', () => {
  const katana = new Katana();

  it('should run a Katana scan against a test URL', async () => {
    const url = 'https://httpbin.org/get';
    const output = await katana.run({ url, depth: 1 });
    expect(output).toContain('http'); // Basic validation that Katana returned some output
  }, 30000); // allow up to 30s for scan

  it('should throw an error for invalid URL', async () => {
    await expect(katana.run({ url: 'invalid-url' })).rejects.toThrow();
  });
});