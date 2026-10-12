import base from './e2e.config.ts';
import type { E2EConfig, ModelInstance } from 'e2e';

/** Scripted responses exercise the production judgment protocol, not model intelligence. */
const model: ModelInstance = {
  specificationVersion: 'v4', provider: 'fixture', modelId: 'scripted-judgment', supportedUrls: {},
  async doGenerate(request: { prompt: { content: string | { type: string; text?: string }[] }[]; abortSignal?: AbortSignal }) {
    const prompt = request.prompt.map((message) => typeof message.content === 'string' ? message.content : message.content.map((part) => {
      if (part.type !== 'text') throw new Error('Mechanism fixture accepts text only');
      return part.text ?? '';
    }).join('\n')).join('\n');
    if (prompt.includes('MECHANISM_PROVIDER_ERROR')) throw new Error('Scripted provider failure');
    if (prompt.includes('MECHANISM_TIMEOUT')) await new Promise<never>((_resolve, reject) => {
      if (request.abortSignal?.aborted) reject(request.abortSignal.reason);
      else request.abortSignal?.addEventListener('abort', () => reject(request.abortSignal?.reason), { once: true });
    });
    const repair = prompt.includes('<previous-attempt-rejected>');
    let answer: unknown = { protocolVersion: 'agent-judgment-2', verdict: 'holds', explanation: 'Scripted protocol response, not a live model judgment.' };
    if (prompt.includes('MECHANISM_INVALID_ALWAYS') || (prompt.includes('MECHANISM_REPAIR_ONCE') && !repair)) answer = { unexpected: 'malformed judgment' };
    if (prompt.includes('MECHANISM_EXTRACT_REPAIR')) answer = { found: true, value: { quantity: repair ? 7 : 'seven' }, missing: null };
    if (prompt.includes('MECHANISM_EXTRACT_WRONG')) answer = { found: true, value: { quantity: 999 }, missing: null };
    return {
      content: [{ type: 'text', text: JSON.stringify(answer) }], finishReason: { unified: 'stop', raw: 'stop' }, warnings: [],
      usage: { inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 20, text: 20, reasoning: 0 }, totalTokens: 120 },
    };
  },
  async doStream(): Promise<never> { throw new Error('Scripted fixture does not stream'); },
} as ModelInstance;

export default { ...base, timeout: 30000, cache: 'off', retries: 0, agents: { default: { model, maxModelCalls: 4 } } } satisfies E2EConfig;
