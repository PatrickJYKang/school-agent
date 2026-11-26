import type { AppConfig, SchoolMethods } from '@librechat/data-schemas';
import type { SchoolBrowserSettings } from 'librechat-data-provider';
import type { RequestHandler } from 'express';
import type { BrowserTransport } from './browser/client';
import type { GetAppConfigOptions } from '~/app/service';
import type { CanvasFetch } from './canvas';

export type SchoolDependencies = {
  workspaceStore?: SchoolMethods;
  requireSharingAccess?: RequestHandler;
  createBrowserClient?: (input: {
    user: { id: string; tenantId?: string };
    conversationId: string;
    settings: SchoolBrowserSettings;
  }) => BrowserTransport;
  getAppConfig: (options: GetAppConfigOptions) => Promise<AppConfig>;
  requireJwtAuth: RequestHandler;
  fetchFn: CanvasFetch;
  encrypt: (value: string, format?: 'v3' | 'legacy') => Promise<string>;
  decrypt: (value: string) => Promise<string>;
  store: {
    findOnePluginAuth: (input: {
      userId: string;
      authField: string;
      pluginKey: string;
    }) => Promise<{ value: string } | null>;
    updatePluginAuth: (input: {
      userId: string;
      authField: string;
      pluginKey: string;
      value: string;
    }) => Promise<{ value: string }>;
    deletePluginAuth: (input: {
      userId: string;
      pluginKey: string;
      all: boolean;
    }) => Promise<{ deletedCount?: number }>;
  };
};
