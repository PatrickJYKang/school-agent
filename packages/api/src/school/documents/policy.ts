import { DOCUMENT_TOOL_NAME } from 'librechat-data-provider';
import type { TCustomConfig } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import { extractFileContent } from '~/protection/adapters/submissions';
import { inspectContent } from '~/protection/runtime';
import { DocumentReadError } from './types';

export function schoolDocumentsEnabled(
  school: NonNullable<TCustomConfig['interface']>['school'],
  policy: { includedTools?: readonly string[]; filteredTools?: readonly string[] } = {},
): boolean {
  return (
    school?.enabled === true &&
    school.documents?.enabled === true &&
    (policy.includedTools?.length
      ? policy.includedTools.includes(DOCUMENT_TOOL_NAME)
      : !policy.filteredTools?.includes(DOCUMENT_TOOL_NAME))
  );
}

export function inspectSchoolDocument(
  filename: string,
  text: string,
  filters: AppConfig['filters'],
): void {
  if (inspectContent(extractFileContent({ filename, extractedText: text }), { filters }) != null)
    throw new DocumentReadError('document_blocked');
}
