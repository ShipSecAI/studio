import { describe, it, expect } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { MarkdownView } from '../markdown'

describe('MarkdownView', () => {
  it('renders basic markdown', () => {
    render(<MarkdownView content="# Hello World" />)
    expect(screen.getByText('Hello World')).toBeInTheDocument()
  })

  it('renders GFM checkboxes', () => {
    const markdown = `
- [ ] Task 1
- [x] Task 2 (done)
- [ ] Task 3
`
    render(<MarkdownView content={markdown} />)
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(3)
    expect(checkboxes[1]).toBeChecked()
  })

  it('renders images', () => {
    const { container } = render(<MarkdownView content="![alt text](https://example.com/image.png)" />)
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img).toHaveAttribute('src', 'https://example.com/image.png')
  })

  it('renders code blocks', () => {
    const markdown = '```js\nconst x = 1\n```'
    render(<MarkdownView content={markdown} />)
    expect(screen.getByText(/const x = 1/)).toBeInTheDocument()
  })
})
