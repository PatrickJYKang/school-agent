import { Constants, EModelEndpoint, specsConfigSchema } from 'librechat-data-provider';
import { shouldEnforceModelSpec } from './specs';

const modelSpecs = specsConfigSchema.parse({
  enforce: true,
  addedEndpoints: [EModelEndpoint.agents],
  list: [
    {
      name: 'study',
      label: 'Study',
      preset: { endpoint: EModelEndpoint.openAI, model: 'school-model' },
    },
  ],
});

describe('saved-agent model specification enforcement', () => {
  const input = { modelSpecs, endpoint: EModelEndpoint.agents, agentId: 'agent_study' };

  test.each([undefined, null, ''])(
    'admits an explicitly added saved agent with spec %p',
    (spec) => {
      expect(shouldEnforceModelSpec({ ...input, spec })).toBe(false);
    },
  );

  test('still enforces ordinary model requests when agents are added', () => {
    expect(shouldEnforceModelSpec({ ...input, endpoint: EModelEndpoint.openAI })).toBe(true);
  });

  test('requires explicit administrator admission of the saved-agent endpoint', () => {
    expect(
      shouldEnforceModelSpec({ ...input, modelSpecs: { ...modelSpecs, addedEndpoints: [] } }),
    ).toBe(true);
  });

  test.each([undefined, '', 123, 'agent_', Constants.EPHEMERAL_AGENT_ID])(
    'does not exempt missing, invalid or ephemeral agent identity %p',
    (agentId) => {
      expect(shouldEnforceModelSpec({ ...input, agentId })).toBe(true);
    },
  );

  test.each(['study', 'invalid-spec', ' ', 123, false, {}])(
    'keeps a supplied specification subject to its existing validation: %p',
    (spec) => {
      expect(shouldEnforceModelSpec({ ...input, spec })).toBe(true);
    },
  );

  test('preserves deployments without enforced specifications', () => {
    expect(shouldEnforceModelSpec({ ...input, modelSpecs: undefined })).toBe(false);
    expect(
      shouldEnforceModelSpec({ ...input, modelSpecs: { ...modelSpecs, enforce: false } }),
    ).toBe(false);
    expect(shouldEnforceModelSpec({ ...input, modelSpecs: { ...modelSpecs, list: [] } })).toBe(
      false,
    );
  });
});
