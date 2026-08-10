import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

test('ipcHandlers wires the selected model and generic MCP agent into BusinessSystemContextService', () => {
    const ipcSource = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
    const contextSource = fs.readFileSync(
        path.join(root, 'electron/services/context/WhatToSayContextPreparation.ts'),
        'utf8',
    );

    assert.match(
        ipcSource,
        /prepareWhatToSayContext/,
        'ipcHandlers.ts should call the context preparation module used by generate-what-to-say',
    );

    assert.match(
        contextSource,
        /from\s+['"]\.\.\/business-system\/McpAgentLoop['"]/,
        'WhatToSayContextPreparation.ts should import the generic MCP agent loop',
    );

    assert.match(
        contextSource,
        /new\s+BusinessSystemContextService\(\s*\{[\s\S]*?agentLoop/,
        'WhatToSayContextPreparation.ts must pass the generic agent loop into BusinessSystemContextService',
    );

    assert.match(ipcSource, /llmHelper:\s*appState\.processingHelper\.getLLMHelper\(\)/);
    assert.doesNotMatch(contextSource, /WindchillBusinessContextAdapter|plmAdapter/);
});
