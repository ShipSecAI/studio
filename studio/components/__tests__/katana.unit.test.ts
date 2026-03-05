import { Katana } from '../katana';
import { exec } from 'child_process';
import { jest } from '@jest/globals';

jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

const execMock = exec as unknown as jest.Mock;

describe('Katana component unit tests', () => {
  let katana: Katana;

  beforeEach(() => {
    katana = new Katana();
    execMock.mockReset();
  });

  it('should throw error if URL is missing', async () => {
    await expect(katana.run({ url: '' })).rejects.toThrow('URL is required');
  });

  it('should run katana with default options', async () => {
    execMock.mockImplementation((cmd, cb) => cb(null, 'scan result', ''));
    const output = await katana.run({ url: 'https://example.com' });
    expect(output).toBe('scan result');
    expect(execMock).toHaveBeenCalledWith('katana https://example.com', expect.any(Function));
  });

  it('should include depth and output file arguments', async () => {
    execMock.mockImplementation((cmd, cb) => cb(null, 'scan result', ''));
    await katana.run({ url: 'https://example.com', depth: 3, outputFile: 'out.txt' });
    expect(execMock).toHaveBeenCalledWith('katana -depth 3 -o out.txt https://example.com', expect.any(Function));
  });
});