import { describe, it, expect } from 'vitest';
import { sourceLocation, userFrame } from '../../src/internal/source.ts';

describe('Windows source locations', () => {
  it('keeps drive letters and spaces when finding a project frame', () => {
    expect(userFrame('    at action (C:\\work space\\tests\\flow.ts:12:4)', 'C:\\work space')).toEqual({ file: 'C:\\work space\\tests\\flow.ts', line: 12, column: 4 });
  });

  it('decodes Windows file URLs and skips dependencies with mixed separators', () => {
    const stack = '    at lib (C:\\work space/node_modules/helper.js:2:3)\n    at action (file:///C:/work%20space/tests/flow.ts?worker=1:12:4)';
    expect(sourceLocation(stack, 'C:\\work space')).toEqual({ file: 'tests/flow.ts', line: 12, column: 4 });
  });

  it('does not admit another drive or a sibling project', () => {
    expect(sourceLocation('    at action (D:\\work\\flow.ts:12:4)', 'C:\\work')).toBeUndefined();
    expect(sourceLocation('    at action (C:\\work-other\\flow.ts:12:4)', 'C:\\work')).toBeUndefined();
  });
});
