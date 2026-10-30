import { Agent } from 'undici';
import type { SchoolFetch } from '../http';
import { createSSRFSafeUndiciConnect } from '~/auth';

export type DocumentTransport = { fetchFn: SchoolFetch; close: () => Promise<void> };

/** Validate DNS at connection time; redirect handling and credential scope belong to the caller. */
export function createSchoolDocumentTransport(): DocumentTransport {
  const dispatcher = new Agent({ connect: createSSRFSafeUndiciConnect() });
  return {
    fetchFn: (url, options) =>
      fetch(url, { ...options, dispatcher, redirect: 'manual' } as RequestInit),
    close: () => dispatcher.close(),
  };
}
