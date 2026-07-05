export const STANDARD_CLOUD_MODELS: Record<string, {
    hasKeyCheck: (creds: any) => boolean;
    ids: string[];
    names: string[];
    descs: string[];
    pmKey: 'geminiPreferredModel' | 'openaiPreferredModel' | 'claudePreferredModel' | 'groqPreferredModel' | 'doubaoPreferredModel';
}> = {
    gemini: {
        hasKeyCheck: (creds) => !!creds?.hasGeminiKey,
        ids: ['gemini-3.1-flash-lite-preview', 'gemini-3.1-pro-preview'],
        names: ['Gemini 3.1 Flash', 'Gemini 3.1 Pro'],
        descs: ['Fastest • Multimodal', 'Reasoning • High Quality'],
        pmKey: 'geminiPreferredModel'
    },
    openai: {
        hasKeyCheck: (creds) => !!creds?.hasOpenaiKey,
        ids: ['gpt-5.4'],
        names: ['GPT 5.4'],
        descs: ['OpenAI'],
        pmKey: 'openaiPreferredModel'
    },
    claude: {
        hasKeyCheck: (creds) => !!creds?.hasClaudeKey,
        ids: ['claude-sonnet-4-6'],
        names: ['Sonnet 4.6'],
        descs: ['Anthropic'],
        pmKey: 'claudePreferredModel'
    },
    groq: {
        hasKeyCheck: (creds) => !!creds?.hasGroqKey,
        ids: ['llama-3.3-70b-versatile'],
        names: ['Llama 3.3 70B'],
        descs: ['Groq'],
        pmKey: 'groqPreferredModel'
    },
    doubao: {
        hasKeyCheck: (creds) => !!creds?.hasDoubaoKey,
        ids: ['doubao-seed-2-0-lite-260215'],
        names: ['Doubao Seed 2.0 Lite'],
        descs: ['Volcengine'],
        pmKey: 'doubaoPreferredModel'
    },
};

export const DEFAULT_CHAT_MODEL_ID = 'doubao-seed-2-0-lite-260215';

export const CODEX_CLI_MODEL = {
    id: 'codex-cli',
    name: 'Codex CLI',
    desc: 'Local CLI transport',
};

export const CODEX_CLI_MODEL_PRESETS = [
    { id: 'gpt-5.5', name: 'ChatGPT 5.5' },
    { id: 'gpt-5.3-codex', name: 'Codex 5.3' },
    { id: 'gpt-5.3-codex-spark', name: 'Codex Spark 5.3' },
    { id: 'gpt-5.4', name: 'ChatGPT 5.4' },
];

export const codexCliSelectorId = (modelId: string): string => `codex-cli:${modelId}`;

export const getCodexCliModelDisplayName = (id: string): string | null => {
    if (id === CODEX_CLI_MODEL.id) return CODEX_CLI_MODEL.name;
    if (!id.startsWith('codex-cli:')) return null;

    const modelId = id.slice('codex-cli:'.length);
    const preset = CODEX_CLI_MODEL_PRESETS.find(model => model.id === modelId);
    return preset?.name || prettifyModelId(modelId);
};

export const MODEL_DISPLAY_NAMES: Record<string, string> = {
    natively: 'QCLOUD API',
    'gemini-3.1-flash-lite-preview': 'Gemini 3.1 Flash',
    'gemini-3.1-pro-preview': 'Gemini 3.1 Pro',
    'llama-3.3-70b-versatile': 'Groq Llama 3.3',
    'gpt-5.4': 'GPT 5.4',
    'claude-sonnet-4-6': 'Sonnet 4.6',
    'doubao-seed-2-0-lite-260215': 'Doubao Seed 2.0 Lite',
};

export const getModelDisplayName = (id: string): string => {
    const codexCliName = getCodexCliModelDisplayName(id);
    if (codexCliName) return codexCliName;
    if (id.startsWith('ollama-')) return id.replace('ollama-', '');
    return MODEL_DISPLAY_NAMES[id] || id;
};

export const prettifyModelId = (id: string): string => {
    if (!id) return '';
    return id.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};
