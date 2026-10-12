import base from './e2e.config.ts';
import { chatgpt } from 'e2e/oauth/chatgpt';
import type { E2EConfig } from 'e2e';

export default {
  ...base, timeout: 60000, retries: 0, cache: 'off',
  agents: { default: { model: chatgpt('gpt-6-astra'), maxModelCalls: 4 } },
} satisfies E2EConfig;
