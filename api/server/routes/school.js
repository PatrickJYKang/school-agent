const {
  createSchoolRouter,
  createProxyAwareFetch,
  encryptCredential,
  decryptCredential,
  createSchoolBrowserClient,
} = require('@librechat/api');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const { getAppConfig } = require('~/server/services/Config');
const store = require('~/models');

module.exports = createSchoolRouter({
  createBrowserClient: ({ user, conversationId, settings }) =>
    createSchoolBrowserClient({
      user,
      conversationId,
      settings,
      token: process.env[settings.tokenEnv],
      fetchFn: fetch,
    }),
  store,
  getAppConfig,
  requireJwtAuth,
  fetchFn: createProxyAwareFetch(),
  encrypt: encryptCredential,
  decrypt: decryptCredential,
});
