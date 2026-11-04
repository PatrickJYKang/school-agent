import { EModelEndpoint, isEphemeralAgentId } from 'librechat-data-provider';
import type { TSpecsConfig } from 'librechat-data-provider';

/** Saved-agent access is authorized separately by the normal resource ACL middleware. */
export function shouldEnforceModelSpec({
  modelSpecs,
  endpoint,
  agentId,
  spec,
}: {
  modelSpecs?: TSpecsConfig;
  endpoint?: string;
  agentId?: unknown;
  spec?: unknown;
}): boolean {
  if (!modelSpecs?.enforce || !modelSpecs.list?.length) return false;
  if (spec != null && spec !== '') return true;
  return !(
    endpoint === EModelEndpoint.agents &&
    modelSpecs.addedEndpoints?.includes(EModelEndpoint.agents) &&
    typeof agentId === 'string' &&
    /^agent_[A-Za-z0-9_-]+$/.test(agentId) &&
    !isEphemeralAgentId(agentId)
  );
}
