FROM node:24.22.1-bookworm-slim AS build
WORKDIR /runtime
COPY services/browser/package*.json ./
RUN npm ci --no-audit --no-fund
RUN node node_modules/playwright/cli.js install --with-deps chromium
COPY packages/api/src/school/browser ./packages/api/src/school/browser
COPY packages/data-provider/src/browser.ts ./packages/data-provider/src/browser.ts
RUN ./node_modules/.bin/esbuild packages/api/src/school/browser/worker.ts packages/api/src/school/browser/guard.ts --bundle --platform=node --format=cjs --outdir=. --packages=external --alias:librechat-data-provider=./packages/data-provider/src/browser.ts --out-extension:.js=.cjs
RUN useradd --create-home --uid 10001 browser
RUN mkdir /state && chown browser:browser /state && chmod 700 /state
ENV PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright
RUN mv /root/.cache/ms-playwright /ms-playwright && chmod -R a+rX /ms-playwright
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
USER browser
ENV SCHOOL_BROWSER_WORKER=true
CMD ["node", "worker.cjs"]
