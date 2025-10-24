import { test, expect } from '@playwright/test'

const undoShortcut = process.platform === 'darwin' ? 'Meta+KeyZ' : 'Control+KeyZ'

test.describe('Workflow undo playground', () => {
  test('restores a deleted node when undo is pressed', async ({ page }) => {
    await page.goto('/__playground__/undo')

    const nodeCount = page.getByTestId('node-count')
    await expect(nodeCount).toHaveText(/Nodes: 2/)
    await expect(page.getByTestId('edge-count')).toHaveText(/Edges: 1/)

    const sourceNode = page.getByRole('button', { name: /Source Node/i })
    await sourceNode.click()

    await page.keyboard.press('Delete')
    await expect(nodeCount).toHaveText(/Nodes: 1/)
    await expect(page.getByTestId('edge-count')).toHaveText(/Edges: 0/)

    await page.keyboard.press(undoShortcut)
    await expect(nodeCount).toHaveText(/Nodes: 2/)
    await expect(page.getByTestId('edge-count')).toHaveText(/Edges: 1/)
  })
})
