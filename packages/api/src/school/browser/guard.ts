import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { schoolBrowserSettingsSchema } from 'librechat-data-provider';
import type { Page } from 'playwright-core';
import { admitBrowserUrl } from './policy';

/** Trusted init hook, loaded by upstream Playwright MCP before navigation. */
export default async function initialize({ page }: { page: Page }): Promise<void> {
  const settings = schoolBrowserSettingsSchema.parse(
    JSON.parse(readFileSync(process.env.SCHOOL_BROWSER_POLICY_FILE!, 'utf8')),
  );
  const context = page.context();
  page.on('response', (response) => {
    const request = response.request();
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      writeFileSync(
        join(dirname(process.env.SCHOOL_BROWSER_POLICY_FILE!), 'navigation.json'),
        JSON.stringify({ status: response.status() }),
        { mode: 0o600 },
      );
    }
  });
  await context.route('**/*', (route) => {
    const request = route.request();
    if (!['GET', 'HEAD'].includes(request.method()) || !admitBrowserUrl(request.url(), settings))
      return route.abort('blockedbyclient');
    return route.continue();
  });
  await context.routeWebSocket('**/*', (socket) => socket.close());
  context.on('page', (popup) => {
    if (popup !== page) void popup.close();
  });
  page.on('download', (download) => {
    void download.cancel();
  });
  page.on('dialog', (dialog) => {
    void dialog.dismiss();
  });
}
