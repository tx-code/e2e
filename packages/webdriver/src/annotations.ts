import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { defineTool, getToolContext, type DefinedTool } from 'e2e/agent';
import { EngineError, raceAbort, type SemanticNode } from 'e2e/engine';
import type { WebDriverSession } from './index.ts';
import { captureDocument, type DomCapture } from './dom.ts';

const inputSchema = z.object({
  annotations: z.array(z.object({
    role: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(300),
    text: z.string().trim().min(1).max(120),
  })).min(1).max(8),
});
type Input = z.infer<typeof inputSchema>;
interface Rect { x: number; y: number; width: number; height: number }
interface Layout { width: number; height: number; url: string; rects: Rect[] }

/** Reads viewport coordinates without scrolling, focusing or changing the page. */
function layout(ids: string[]): Layout {
  const state = window as typeof window & { e2eWebDriverNodes?: { elements: Map<string, WeakRef<Element>> } };
  const rects = ids.map((id) => {
    const element = state.e2eWebDriverNodes?.elements.get(id)?.deref();
    if (!element?.isConnected || element.matches('input[type="password"]')) throw new Error('Annotation target is stale or secure');
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.x < 0 || rect.y < 0 || rect.right > innerWidth || rect.bottom > innerHeight) throw new Error('Annotation target must be fully inside the viewport');
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    if (!hit || !element.contains(hit)) throw new Error('Annotation target is covered by another element');
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  return { width: innerWidth, height: innerHeight, url: location.href, rects };
}

/** Escapes all model-authored prose before it enters the local SVG renderer. */
function xml(value: string): string {
  // Control characters are invalid XML even when the model supplies them in a label.
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f]/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Produces local report evidence; never returns image bytes to the model. */
export function screenshotAnnotationTools(options: {
  readonly session: () => WebDriverSession | undefined;
  /** Trusted, source-masked viewport PNG provider. No full-page or cropped captures. */
  readonly screenshot: (session: WebDriverSession, signal: AbortSignal) => Promise<Uint8Array>;
}): Readonly<Record<string, DefinedTool>> {
  return { annotate_screenshot: defineTool({
    description: 'Capture local screenshot evidence and mark visible page controls with numbered red boxes and text. Supply exact semantic role and name plus annotation text. Targets must be unique and fully in the viewport. Does not click, scroll, or edit the page. Attaches original and annotated PNGs to this report step; returns references only, not pixels. This records evidence, not a success assertion.',
    inputSchema,
    execute: async (raw: Input, execution: { abortSignal?: AbortSignal }) => {
      const input = inputSchema.parse(raw);
      const context = getToolContext(execution);
      const session = options.session();
      if (!session) throw new EngineError('INVALID_STATE', 'No owned WebDriver session is active', { retryable: false });
      const signal = AbortSignal.any([...(execution.abortSignal ? [execution.abortSignal] : []), AbortSignal.timeout(15000)]);
      const check = () => {
        signal.throwIfAborted();
        if (options.session() !== session) throw new EngineError('INVALID_STATE', 'Screenshot session changed', { retryable: false });
      };
      const result = await raceAbort((async () => {
        check();
        const capture = await session.driver.executeScript<DomCapture>(captureDocument, [], 'data-testid', 10000);
        if (capture.truncated) throw new EngineError('ENGINE_FAILURE', 'Annotation capture exceeds the node budget', { retryable: false });
        const nodes: SemanticNode[] = [];
        const visit = (node: SemanticNode) => { nodes.push(node); for (const child of node.children ?? []) visit(child); };
        visit(capture.root);
        const ids = input.annotations.map(({ role, name }) => {
          const matches = nodes.filter((node) => node.role === role && node.name === name);
          if (matches.length !== 1) throw new EngineError('NOT_ACTIONABLE', `Annotation target must match exactly once; found ${matches.length}`, { retryable: false });
          return matches[0]!.ref.id;
        });
        const before = await session.driver.executeScript<Layout>(layout, ids);
        check();
        const original = Buffer.from(await options.screenshot(session, signal));
        check();
        const after = await session.driver.executeScript<Layout>(layout, ids);
        if (JSON.stringify(before) !== JSON.stringify(after)) throw new EngineError('NOT_ACTIONABLE', 'Page layout changed during screenshot; capture again after it settles', { retryable: false });
        if (original.length > 20_000_000) throw new EngineError('ENGINE_FAILURE', 'Screenshot exceeds the annotation byte budget', { retryable: false });
        const metadata = await sharp(original, { limitInputPixels: 25_000_000 }).metadata();
        const width = metadata.width!;
        const height = metadata.height!;
        const scale = width / before.width;
        if (metadata.format !== 'png' || !Number.isFinite(scale) || scale <= 0 || Math.abs(height - before.height * scale) > 1) throw new EngineError('ENGINE_FAILURE', 'Annotation provider must return an uncropped viewport PNG', { retryable: false });
        const font = 18;
        const columns = Math.max(1, Math.floor((width - 48) / font));
        const lines: string[] = [];
        input.annotations.forEach((entry, index) => {
          const chars = Array.from(`${index + 1}. ${entry.text}`);
          for (let at = 0; at < chars.length; at += columns) lines.push(chars.slice(at, at + columns).join(''));
        });
        const footer = 48 + lines.length * 26;
        if (width < 120 || width * (height + footer) > 25_000_000) throw new EngineError('ENGINE_FAILURE', 'Annotated image exceeds the dimension budget', { retryable: false });
        const boxes = before.rects.map((rect, index) => {
          const x = rect.x * scale, y = rect.y * scale;
          const badgeY = y >= 24 ? y - 24 : y;
          return `<rect x="${x}" y="${y}" width="${rect.width * scale}" height="${rect.height * scale}" fill="none" stroke="#d71920" stroke-width="3"/><rect x="${x}" y="${badgeY}" width="20" height="22" fill="#d71920"/><text x="${x + 4}" y="${badgeY + 17}" fill="white" font-size="16">${index + 1}</text>`;
        }).join('');
        const labels = lines.map((line, index) => `<text x="24" y="${height + 44 + index * 26}" fill="#171717" font-size="${font}">${xml(line)}</text>`).join('');
        const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height + footer}" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif">${boxes}<rect y="${height}" width="${width}" height="${footer}" fill="white"/>${labels}</svg>`);
        const annotated = await sharp(original).extend({ bottom: footer, background: 'white' }).composite([{ input: overlay, top: 0, left: 0 }]).png().toBuffer();
        check();
        const id = randomUUID();
        const originalRef = await context.attachScreenshot({ data: original, mediaType: 'image/png', width, height, scale, maskedRegionCount: 0 }, `evidence-${id}-original`);
        check();
        const annotatedRef = await context.attachScreenshot({ data: annotated, mediaType: 'image/png', width, height: height + footer, scale, maskedRegionCount: 0 }, `evidence-${id}-annotated`);
        return JSON.stringify({ original: originalRef, annotated: annotatedRef, annotations: input.annotations.length });
      })(), signal, 'Screenshot annotation');
      return result;
    },
  }, { mutates: false }) };
}
