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
    // Syntax highlighting splits code into tokens, so check for individual parts
    expect(screen.getByText('const')).toBeInTheDocument();
    expect(screen.getByText('x')).toBeInTheDocument();
    // Check that the CodeBlock component wrapper is rendered
    expect(container.querySelector('.rounded-lg.border')).toBeInTheDocument();
    // Verify the language label is shown
    expect(screen.getByText('js')).toBeInTheDocument();
  });
});
