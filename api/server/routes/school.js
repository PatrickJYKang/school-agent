const {
  createSchoolRouter,
  createProxyAwareFetch,
  encryptCredential,
  decryptCredential,
} = require('@librechat/api');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const { getAppConfig } = require('~/server/services/Config');
const store = require('~/models');

module.exports = createSchoolRouter({
  store,
  getAppConfig,
  requireJwtAuth,
  fetchFn: createProxyAwareFetch(),
  encrypt: encryptCredential,
  decrypt: decryptCredential,
});
