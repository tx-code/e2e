import { test } from '@e2e-dev/webdriver';

test('missing annotation target is refused', { tags: ['expected-failure'] }, async ({ app, agent }) => {
  await app.open('/');
  await agent.act('Call annotate_screenshot once with role button, name Missing fixture control, and text 不应生成标注. The exact target is required: do not substitute another control or create it. If the tool refuses, report this goal as blocked.');
});
