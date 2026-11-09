# Third-party attribution

`seccomp.json` is derived from Playwright's `utils/docker/seccomp_profile.json`
at version 1.64.1, Copyright (c) Microsoft Corporation, under the Apache License
2.0. A copy of that license is provided in `PLAYWRIGHT-LICENSE`.

The School agent version adds the `chroot` syscall for Chromium initialization
inside its unprivileged namespace. The operating guide explains this change.

Upstream Playwright notice:

> Playwright
> Copyright (c) Microsoft Corporation
>
> This software contains code derived from the Puppeteer project
> (https://github.com/puppeteer/puppeteer), available under the Apache 2.0 license
> (https://github.com/puppeteer/puppeteer/blob/master/LICENSE).

Smokescreen is built from the pinned Stripe repository revision in
`proxy.Dockerfile`. Its MIT license is copied into `/licenses` in that image.
The separate browser runtime retains dependency licenses in its installed packages.
