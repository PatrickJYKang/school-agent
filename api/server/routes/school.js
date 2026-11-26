const {
  createSchoolRouter,
  generateCheckAccess,
  createProxyAwareFetch,
  encryptCredential,
  decryptCredential,
  createSchoolBrowserClient,
} = require('@librechat/api');
const { PermissionTypes, Permissions } = require('librechat-data-provider');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const { getAppConfig } = require('~/server/services/Config');
const store = require('~/models');

module.exports = createSchoolRouter({
  workspaceStore: store,
  requireSharingAccess: generateCheckAccess({
    permissionType: PermissionTypes.SHARED_LINKS,
    permissions: [Permissions.CREATE],
    getRoleByName: store.getRoleByName,
  }),
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
