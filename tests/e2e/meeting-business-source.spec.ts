import { test, expect } from './fixtures';
import { enterOnboardingStep } from './onboarding-actions';

test.use({ onboardingMode: 'fresh', onboardingScenario: 'ready' });

test('meeting input routes only explicit business selections to the existing answer IPC', async ({ page, electronApp }) => {
  await electronApp.evaluate(({ ipcMain }) => {
    const source = { name: '销售 CRM', kind: 'crm', url: 'https://crm.example.test/mcp', enabled: true };
    const calls: Array<{ question: string; sourceId?: string }> = [];
    const generations: Array<() => void> = [];
    Object.assign(globalThis, { meetingSourceTest: { calls, generations } });
    ipcMain.removeHandler('business-system:list-sources');
    ipcMain.handle('business-system:list-sources', () => [
      { ...source, id: 'crm-west-12345678' },
      { ...source, id: 'crm-east-23456789' },
      { ...source, id: 'crm-disabled', name: '停用 CRM', enabled: false },
      { ...source, id: 'plm', name: 'Windchill', kind: 'plm', url: 'https://plm.example.test/mcp' },
    ]);
    ipcMain.removeHandler('rag:query-live');
    ipcMain.handle('rag:query-live', (_event, { query }) => {
      calls.push({ question: query });
      return { success: true };
    });
    ipcMain.removeHandler('generate-what-to-say');
    ipcMain.handle('generate-what-to-say', (_event, question, _images, options) => {
      calls.push({ question, sourceId: options?.businessSystemSourceId });
      if (!question.startsWith('延迟')) return { statusCode: 'ok', answer: '当前阶段：方案验证' };
      return new Promise((resolve, reject) => {
        generations.push(() => {
          if (question.endsWith('失败')) reject(new Error('旧会议查询失败'));
          else resolve({ statusCode: 'ok', answer: question.endsWith('新会议') ? '新会议的查询结果' : '旧会议的查询结果' });
        });
      });
    });
  });

  await enterOnboardingStep(page, '开始会议');
  await page.getByRole('button', { name: '开始会议', exact: true }).click();
  await expect.poll(() => electronApp.windows().some(window => window.url().includes('window=overlay'))).toBe(true);
  const overlay = electronApp.windows().find(window => window.url().includes('window=overlay'))!;
  await overlay.getByTestId('first-meeting-hint').getByRole('button', { name: '知道了' }).click();
  const selector = overlay.getByLabel('选择数据源');
  const input = overlay.locator('input[type="text"]');
  await expect(selector).toHaveValue('');
  await selector.focus();
  await expect(selector.locator('option', { hasText: '停用 CRM' })).toHaveCount(0);
  await expect(selector.locator('option[value="crm-west-12345678"]')).toContainText('crm.example.test');
  await expect(selector.locator('option[value="crm-west-12345678"]')).toContainText('12345678');
  await expect(selector.locator('option[value="crm-east-23456789"]')).toContainText('23456789');
  await selector.evaluate((element) => {
    const wrapper = element.parentElement!;
    const row = wrapper.parentElement!;
    const existing = [...row.querySelectorAll('button')];
    const boxes = () => existing.map(control => control.getBoundingClientRect().toJSON());
    const visible = boxes();
    wrapper.hidden = true;
    const hidden = boxes();
    wrapper.hidden = false;
    if (JSON.stringify(visible) !== JSON.stringify(hidden)) throw new Error('Existing meeting controls moved');
  });

  await input.fill('刚才聊了什么？');
  await input.press('Enter');
  await selector.selectOption('crm-west-12345678');
  await expect(input).toBeFocused();
  await input.fill('海尔这单到哪一步了？');
  await input.press('Enter');
  await expect(overlay.getByText('当前阶段：方案验证')).toBeVisible();
  await expect(overlay.getByText(/来源：销售 CRM.*12345678/)).toBeVisible();
  await selector.selectOption('crm-east-23456789');
  await input.fill('另一条海尔商机');
  await input.press('Enter');
  await expect(overlay.getByText(/来源：销售 CRM.*23456789/)).toBeVisible();
  const calls = () => electronApp.evaluate(() => (globalThis as any).meetingSourceTest.calls);
  await expect.poll(calls).toEqual([
    { question: '刚才聊了什么？' },
    { question: '海尔这单到哪一步了？', sourceId: 'crm-west-12345678' },
    { question: '另一条海尔商机', sourceId: 'crm-east-23456789' },
  ]);

  await selector.selectOption('crm-west-12345678');
  await input.fill('延迟切换来源');
  await input.press('Enter');
  await expect.poll(async () => (await calls()).at(-1)?.sourceId).toBe('crm-west-12345678');
  await selector.selectOption('plm');
  await electronApp.evaluate(() => (globalThis as any).meetingSourceTest.generations.shift()());
  await expect(overlay.getByText(/来源：销售 CRM.*12345678/)).toHaveCount(2);
  await expect(selector).toHaveValue('plm');

  for (const outcome of ['成功', '失败']) {
    await selector.selectOption('crm-west-12345678');
    await input.fill(`延迟${outcome}`);
    await input.press('Enter');
    await expect.poll(async () => (await calls()).at(-1)?.question).toBe(`延迟${outcome}`);
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('window=overlay'))!
        .webContents.send('session-reset');
    });
    await expect(selector).toHaveValue('');
    await selector.selectOption('plm');
    await input.fill('延迟新会议');
    await input.press('Enter');
    await expect.poll(async () => (await calls()).at(-1)).toEqual({ question: '延迟新会议', sourceId: 'plm' });
    await electronApp.evaluate(() => (globalThis as any).meetingSourceTest.generations.shift()());
    await expect(overlay.getByText('正在查询…')).toBeVisible();
    await electronApp.evaluate(() => (globalThis as any).meetingSourceTest.generations.shift()());
    await expect(overlay.getByText('新会议的查询结果')).toBeVisible();
    await expect(overlay.getByText('来源：Windchill')).toBeVisible();
    await expect(overlay.getByText(/旧会议的查询结果|旧会议查询失败|业务系统查询失败/)).toHaveCount(0);
  }
});

test('typed and voice requests share the real MCP path and source credentials', async ({ page, electronApp }) => {
  const saved = await page.evaluate(() => Promise.all([
    window.electronAPI.saveBusinessSystemKnowledgeSource({
      id: 'sales-crm', name: '销售 CRM', kind: 'crm', url: 'https://crm.example.test/mcp',
      authType: 'api_key', credentials: { apiKey: 'fixture-crm-key' }, enabled: true,
    }),
    window.electronAPI.saveBusinessSystemKnowledgeSource({
      id: 'windchill', name: 'Windchill', kind: 'plm', url: 'https://plm.example.test/mcp',
      authType: 'api_key', credentials: { apiKey: 'fixture-plm-key' }, enabled: true,
    }),
  ]));
  expect(saved.every(result => result.success)).toBe(true);
  await electronApp.evaluate(({ app }) => {
    const require = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/meeting-mcp-test.cjs');
    const helper = require(app.getAppPath() + '/dist-electron/electron/main.js').AppState
      .getInstance().processingHelper.getLLMHelper();
    helper.getSelectedToolCallingBinding = () => ({
      kind: 'openai_compatible', provider: 'natively', model: 'mcp-test',
      client: { chat: { completions: {
        create: async (request: any) => {
          const toolResult = request.messages.find((message: any) => message.role === 'tool');
          const message = toolResult ? { content: toolResult.content } : { tool_calls: [{
            id: 'lookup', type: 'function',
            function: { name: 'lookup', arguments: JSON.stringify({ question: request.messages.at(-1).content }) },
          }] };
          return { choices: [{ message }] };
        },
      } } },
    });

    const calls: Array<{ url: string; authorization: string | null; question: string }> = [];
    Object.assign(globalThis, { meetingMcpCalls: calls });
    const blockedFetch = globalThis.fetch;
    globalThis.fetch = async (resource, init) => {
      const request = new Request(resource, init);
      if (!['https://crm.example.test/mcp', 'https://plm.example.test/mcp'].includes(request.url)) {
        return blockedFetch(resource, init);
      }
      if (request.method !== 'POST') return new Response(null, { status: 405 });
      const message = await request.json();
      if (message.id === undefined) return new Response(null, { status: 202 });
      let result;
      if (message.method === 'initialize') {
        result = { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } };
      } else if (message.method === 'tools/list') {
        result = { tools: [{ name: 'lookup', inputSchema: { type: 'object', properties: { question: { type: 'string' } } } }] };
      } else if (message.method === 'tools/call') {
        calls.push({ url: request.url, authorization: request.headers.get('authorization'), question: message.params.arguments.question });
        result = { content: [{ type: 'text', text: request.url.includes('crm.') ? '商机待评审' : '变更待审批' }] };
      } else {
        return Response.json({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Unexpected method' } });
      }
      return Response.json({ jsonrpc: '2.0', id: message.id, result });
    };
  });

  await enterOnboardingStep(page, '开始会议');
  await page.getByRole('button', { name: '开始会议', exact: true }).click();
  await expect.poll(() => electronApp.windows().some(window => window.url().includes('window=overlay'))).toBe(true);
  const overlay = electronApp.windows().find(window => window.url().includes('window=overlay'))!;
  await overlay.getByTestId('first-meeting-hint').getByRole('button', { name: '知道了' }).click();
  const selector = overlay.getByLabel('选择数据源');
  const input = overlay.locator('input[type="text"]');

  await selector.selectOption('sales-crm');
  await input.fill('海尔这单到哪一步了？');
  await input.press('Enter');
  await expect(overlay.getByText(/商机待评审/)).toBeVisible();

  await selector.selectOption('windchill');
  await input.fill('ECO-123 到哪一步了？');
  await input.press('Enter');
  await expect(overlay.getByText(/变更待审批/)).toBeVisible();

  const voiceAnswer = await overlay.evaluate(() => window.electronAPI.generateWhatToSay(
    undefined, undefined, {
      source: 'dynamic_action',
      modeEvent: { actionType: 'business_system_query', latestTurn: '查一下 Windchill 里的 ECO-123 状态' } as any,
    },
  ));
  expect(voiceAnswer.statusCode).toBe('ok');
  expect(voiceAnswer.answer).toContain('变更待审批');
  const invalid = await overlay.evaluate(() => Promise.all([
    window.electronAPI.generateWhatToSay(' ', undefined, { source: 'overlay', businessSystemSourceId: 'sales-crm' }),
    window.electronAPI.generateWhatToSay('查询', undefined, { source: 'overlay', businessSystemSourceId: '' }),
    window.electronAPI.generateWhatToSay('查询', ['screenshot'], { source: 'overlay', businessSystemSourceId: 'sales-crm' }),
  ]));
  expect(invalid.map(result => result.statusCode)).toEqual(['invalid-request', 'invalid-request', 'invalid-request']);

  const unavailable = await overlay.evaluate(async () => {
    await window.electronAPI.deleteBusinessSystemKnowledgeSource('sales-crm');
    return window.electronAPI.generateWhatToSay('海尔这单到哪一步了？', undefined, {
      source: 'overlay', businessSystemSourceId: 'sales-crm',
    });
  });
  expect(unavailable.statusCode).toBe('business-system-unavailable');
  expect(unavailable.answer).toContain('请重新选择');
  expect(await electronApp.evaluate(() => (globalThis as any).meetingMcpCalls)).toEqual([
    { url: 'https://crm.example.test/mcp', authorization: 'Bearer fixture-crm-key', question: '海尔这单到哪一步了？' },
    { url: 'https://plm.example.test/mcp', authorization: 'Bearer fixture-plm-key', question: 'ECO-123 到哪一步了？' },
    { url: 'https://plm.example.test/mcp', authorization: 'Bearer fixture-plm-key', question: expect.stringContaining('查一下 Windchill 里的 ECO-123 状态') },
  ]);
});
