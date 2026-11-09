import type { SchoolBrowserSettings } from 'librechat-data-provider';

export function hostMatches(host: string, rule: string): boolean {
  const value = rule.toLowerCase();
  return value.startsWith('*.')
    ? host === value.slice(2) || host.endsWith(value.slice(1))
    : host === value;
}

/** DNS/IP admission is enforced separately by the network proxy at connection time. */
export function admitBrowserUrl(
  value: string,
  settings: Pick<SchoolBrowserSettings, 'allowedHosts' | 'blockedHosts'>,
): string | null {
  try {
    const url = new URL(value);
    const credential =
      /^(access_token|id_token|api_key|apikey|password|client_secret|session|sessionid|samlresponse|x-amz-signature|x-amz-credential)$/i;
    if (
      [...url.searchParams.keys()].some((key) => credential.test(key)) ||
      /(?:^|[?&#])(?:access_token|id_token|api_key|password|session|samlresponse)=/i.test(
        decodeURIComponent(url.hash),
      )
    )
      return null;
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port ||
      value.length > 2048 ||
      !/^[a-z\d](?:[a-z\d.-]*[a-z\d])?\.[a-z]{2,}$/i.test(url.hostname) ||
      /\.(local|localhost|internal|test|invalid)$/i.test(url.hostname) ||
      settings.blockedHosts.some((rule) => hostMatches(url.hostname, rule)) ||
      (settings.allowedHosts.length > 0 &&
        !settings.allowedHosts.some((rule) => hostMatches(url.hostname, rule)))
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
