import { chromium, Page, Browser, BrowserContext } from 'playwright';
import path from 'path';
import { 
  BrowserAutomationInput, 
  BrowserAutomationOutput,
  ActionResult,
  BrowserAction
} from '@shipsec/shared';

const INPUT = JSON.parse(process.env.SHIPSEC_INPUT || '{}') as BrowserAutomationInput;
const OUTPUT_DIR = '/outputs';

async function run() {
  const results: ActionResult[] = [];
  const screenshots: any[] = [];
  const consoleLogs: any[] = [];
  
  const streamLog = (level: string, text: string) => {
    const timestamp = new Date().toISOString();
    consoleLogs.push({ 
      level: level as any, 
      text, 
      timestamp 
    });
    console.log(`[${level.toUpperCase()}] ${text}`);
  };

  const takeScreenshot = async (page: Page, name: string, fullPage = false) => {
    try {
      const timestamp = new Date().toISOString();
      const filename = `${name}-${Date.now()}.png`;
      const filepath = path.join(OUTPUT_DIR, filename);
      
      await page.screenshot({
        path: filepath,
        fullPage,
        type: 'png',
      });

      screenshots.push({
        name,
        path: filename,
        timestamp,
      });
    } catch (err: any) {
      streamLog('warn', `Failed to capture screenshot ${name}: ${err.message}`);
    }
  };

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({
      headless: INPUT.options?.headless ?? true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    const context: BrowserContext = await browser.newContext({
      viewport: INPUT.options?.viewport ?? { width: 1280, height: 720 },
      userAgent: INPUT.options?.userAgent,
    });

    const page: Page = await context.newPage();

    if (INPUT.options?.captureConsole) {
      page.on('console', (msg) => {
        streamLog(msg.type(), msg.text());
      });
    }

    if (INPUT.options?.blockTracking) {
      await page.route('**/*', (route) => {
        const url = route.request().url();
        const blockedDomains = ['doubleclick.net', 'google-analytics.com', 'googletagmanager.com'];
        if (blockedDomains.some(d => url.includes(d))) route.abort();
        else route.continue();
      });
    }

    if (INPUT.options?.screenshotOnStart) {
      await takeScreenshot(page, '00-start', INPUT.options?.fullPageScreenshots);
    }

    // Execute first navigation
    const startTime = Date.now();
    try {
      await page.goto(INPUT.url, { waitUntil: 'load', timeout: INPUT.options?.timeout ?? 30000 });
      results.push({
        action: 'goto',
        success: true,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
        url: page.url(),
        title: await page.title().catch(() => ''),
      } as any);
    } catch (err: any) {
       results.push({
        action: 'goto',
        success: false,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
        error: err.message,
        url: INPUT.url,
      } as any);
      throw err;
    }

    // Execute actions
    for (const action of (INPUT.actions || [])) {
      const aStart = Date.now();
      try {
        switch (action.type) {
          case 'goto':
            await page.goto(action.url, { waitUntil: action.waitUntil, timeout: action.timeout ?? INPUT.options?.timeout });
            results.push({ action: 'goto', success: true, timestamp: new Date().toISOString(), duration: Date.now() - aStart, url: page.url() } as any);
            break;
          case 'click':
            if (action.waitForSelector) await page.waitForSelector(action.selector, { timeout: action.timeout ?? INPUT.options?.timeout });
            await page.click(action.selector, { timeout: action.timeout ?? INPUT.options?.timeout });
            results.push({ action: 'click', success: true, timestamp: new Date().toISOString(), duration: Date.now() - aStart, selector: action.selector } as any);
            break;
          case 'fill':
            await page.fill(action.selector, action.value, { timeout: action.timeout ?? INPUT.options?.timeout });
            results.push({ action: 'fill', success: true, timestamp: new Date().toISOString(), duration: Date.now() - aStart, selector: action.selector } as any);
            break;
          case 'screenshot':
            await takeScreenshot(page, action.name || 'screenshot', action.fullPage);
            results.push({ action: 'screenshot', success: true, timestamp: new Date().toISOString(), duration: Date.now() - aStart, name: action.name } as any);
            break;
          case 'getText':
            const text = await page.textContent(action.selector);
            results.push({ action: 'getText', success: true, timestamp: new Date().toISOString(), duration: Date.now() - aStart, selector: action.selector, text: text || '' } as any);
            break;
          case 'getHTML':
            const html = action.selector ? await page.innerHTML(action.selector) : await page.content();
            results.push({ action: 'getHTML', success: true, timestamp: new Date().toISOString(), duration: Date.now() - aStart, selector: action.selector, html } as any);
            break;
          case 'waitFor':
            await page.waitForSelector(action.selector, { state: action.state, timeout: action.timeout ?? INPUT.options?.timeout });
            results.push({ action: 'waitFor', success: true, timestamp: new Date().toISOString(), duration: Date.now() - aStart, selector: action.selector } as any);
            break;
          case 'evaluate':
            const res = await page.evaluate(action.script);
            results.push({ action: 'evaluate', success: true, timestamp: new Date().toISOString(), duration: Date.now() - aStart, result: res } as any);
            break;
          case 'select':
            await page.selectOption(action.selector, action.value);
            results.push({ action: 'select', success: true, timestamp: new Date().toISOString(), duration: Date.now() - aStart, selector: action.selector } as any);
            break;
          case 'hover':
            await page.hover(action.selector, { timeout: action.timeout ?? INPUT.options?.timeout });
            results.push({ action: 'hover', success: true, timestamp: new Date().toISOString(), duration: Date.now() - aStart, selector: action.selector } as any);
            break;
          case 'scroll':
            if (action.position === 'top') await page.evaluate(() => window.scrollTo(0, 0));
            else if (action.position === 'bottom') await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            else if (action.selector) await page.locator(action.selector).scrollIntoViewIfNeeded({ timeout: action.timeout ?? INPUT.options?.timeout });
            results.push({ action: 'scroll', success: true, timestamp: new Date().toISOString(), duration: Date.now() - aStart } as any);
            break;
        }
      } catch (err: any) {
        results.push({
          action: action.type,
          success: false,
          timestamp: new Date().toISOString(),
          duration: Date.now() - aStart,
          error: err.message,
        } as any);
        throw err;
      }
    }

    if (INPUT.options?.screenshotOnEnd) {
      await takeScreenshot(page, '99-end', INPUT.options?.fullPageScreenshots);
    }

    const finalUrl = page.url();
    const pageTitle = await page.title().catch(() => '');

    const output: BrowserAutomationOutput = {
      success: true,
      results,
      screenshots,
      consoleLogs: consoleLogs as any,
      finalUrl,
      pageTitle,
    };

    process.stdout.write('---RESULT_START---' + JSON.stringify(output) + '---RESULT_END---');

  } catch (err: any) {
    const output: BrowserAutomationOutput = {
       success: false,
       results,
       screenshots,
       consoleLogs: consoleLogs as any,
       error: err.message,
    };
    process.stdout.write('---RESULT_START---' + JSON.stringify(output) + '---RESULT_END---');
    process.exit(0);
  } finally {
    if (browser) await browser.close();
  }
}

run();
