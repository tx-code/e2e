import { chatgpt } from 'e2e/oauth/chatgpt';
import type { E2EConfig } from 'e2e';
import config from './e2e.config.ts';

export default {
  ...config,
  cache: { mode: 'read-write', dir: '.e2e/cache-benchmark-instrumented' },
  agents: { default: { model: chatgpt('gpt-6-luna'), maxModelCalls: 8 } },
} satisfies E2EConfig;
