import type { E2EConfig } from 'e2e';
import config from './e2e.config.ts';

export default {
  ...config,
  cache: { mode: 'read-write', dir: '.e2e/report-diagnostics-cache' },
  agents: { default: { executor: {
    name: 'report-diagnostics', version: '1',
    async runStep(context) {
      const observation = await context.observe();
      const id = observation.text.match(/#(\S+) button "Apply"/)?.[1];
      if (!id) return { status: 'failed', summary: 'Apply is absent' };
      await context.actions.tap({ id });
      return { status: 'passed', summary: 'Applied the form' };
    },
  } } },
} satisfies E2EConfig;
