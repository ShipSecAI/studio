import { describe, it, expect } from 'bun:test';
import { render, screen } from '@testing-library/react';
import { MarkdownView } from '../markdown';

describe('MarkdownView', () => {
  it('renders basic markdown', () => {
    render(<MarkdownView content="# Hello World" />);
    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });

  it('renders GFM checkboxes', () => {
    const markdown = `
- [ ] Task 1
- [x] Task 2 (done)
- [ ] Task 3
`;
    render(<MarkdownView content={markdown} />);
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(3);
    expect(checkboxes[1]).toBeChecked();
  });

  it('renders images', () => {
    const { container } = render(
      <MarkdownView content="![alt text](https://example.com/image.png)" />,
    );
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', 'https://example.com/image.png');
  });

  it('renders code blocks', () => {
    const markdown = '```js\nconst x = 1\n```';
    const { container } = render(<MarkdownView content={markdown} />);
    // With syntax highlighting, text is split across multiple span elements
    const codeBlock = container.querySelector('pre.code-block');
    expect(codeBlock).not.toBeNull();
    expect(codeBlock).toHaveAttribute('data-language', 'js');
    // Check that the code content exists (may be split across spans for highlighting)
    const codeElement = codeBlock?.querySelector('code');
    expect(codeElement?.textContent).toContain('const');
    expect(codeElement?.textContent).toContain('x = 1');
  });
});
