import { schoolBrowserSettingsSchema, schoolBrowserInputSchema } from 'librechat-data-provider';
import { admitBrowserUrl } from './policy';

const policy = schoolBrowserSettingsSchema.parse({});
test.each([
  'file:///etc/passwd',
  'data:text/html,hello',
  'javascript:alert(1)',
  'http://127.0.0.1',
  'http://[::1]',
  'http://169.254.169.254',
  'https://example.com:8443',
  'https://user:password@example.com',
  'https://app.internal',
  'https://localhost',
  'https://webb.instructure.com',
  'https://school.sharepoint.com',
])('rejects inadmissible navigation %s', (url) => {
  expect(admitBrowserUrl(url, policy)).toBeNull();
});
test('matches exact hosts and domain boundaries; deny wins', () => {
  const settings = {
    ...policy,
    allowedHosts: ['*.example.com'],
    blockedHosts: ['private.example.com'],
  };
  expect(admitBrowserUrl('https://example.com/path#part', settings)).toBe(
    'https://example.com/path#part',
  );
  expect(admitBrowserUrl('https://sub.example.com', settings)).toBe('https://sub.example.com/');
  expect(admitBrowserUrl('https://badexample.com', settings)).toBeNull();
  expect(admitBrowserUrl('https://example.com.attacker.org', settings)).toBeNull();
  expect(admitBrowserUrl('https://private.example.com', settings)).toBeNull();
});
test.each([
  'https://example.com/?access_token=synthetic',
  'https://example.com/#access_token=synthetic',
  'https://example.com/file?X-Amz-Signature=synthetic',
])('rejects common credential-bearing URLs %s', (url) => {
  expect(admitBrowserUrl(url, policy)).toBeNull();
});
test.each(['click', 'type', 'submit', 'evaluate', 'upload', 'cookies', 'restart'])(
  'does not admit arbitrary browser operation %s',
  (operation) => {
    expect(schoolBrowserInputSchema.safeParse({ operation }).success).toBe(false);
  },
);
test('rejects selectors and extra fields instead of forwarding them to MCP', () => {
  expect(schoolBrowserInputSchema.safeParse({ operation: 'follow', ref: '#submit' }).success).toBe(
    false,
  );
  expect(
    schoolBrowserInputSchema.safeParse({
      operation: 'open',
      url: 'https://example.com',
      script: 'secret',
    }).success,
  ).toBe(false);
});
