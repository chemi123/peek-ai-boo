'use strict';

const MODELS = {
  gemini: [
    { value: 'gemini-2.5-pro',   label: 'Gemini 2.5 Pro (無料枠あり・高精度)' },
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (無料枠あり・速い)' },
    { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash (無料枠あり・軽量)' },
  ],
  claude: [
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (速い・安い)' },
    { value: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6 (推奨)' },
    { value: 'claude-opus-4-6',           label: 'Claude Opus 4.6 (高精度)' },
  ],
  openai: [
    { value: 'gpt-4o-mini',  label: 'GPT-4o mini (速い・安い)' },
    { value: 'gpt-4o',       label: 'GPT-4o (推奨)' },
    { value: 'o1-mini',      label: 'o1 mini' },
  ],
};

const KEY_HINTS = {
  gemini: 'Google AI Studio (aistudio.google.com) → Get API key で無料発行できます',
  claude: 'Anthropic Console → API Keys で発行できます',
  openai: 'OpenAI Platform → API Keys で発行できます',
};

// ── DOM refs ──────────────────────────────────────────────────────────────────
const providerEl  = document.getElementById('provider');
const modelEl     = document.getElementById('model');
const apiKeyEl    = document.getElementById('api-key');
const toggleKeyEl = document.getElementById('toggle-key');
const keyHintEl   = document.getElementById('key-hint');
const saveBtn     = document.getElementById('save-btn');
const statusEl    = document.getElementById('status');
const historyList = document.getElementById('history-list');
const clearAllBtn = document.getElementById('clear-all');

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  const stored = await chrome.storage.local.get(['settings', 'qaMap']);
  const settings = stored.settings || {};

  providerEl.value = settings.provider || 'gemini';
  updateModelOptions(providerEl.value, settings.model);
  apiKeyEl.value = settings.apiKey || '';
  updateKeyHint(providerEl.value);

  renderHistory(stored.qaMap || {});
}

// ── Provider change → update model list ───────────────────────────────────────
providerEl.addEventListener('change', () => {
  updateModelOptions(providerEl.value, null);
  updateKeyHint(providerEl.value);
});

function updateModelOptions(provider, currentModel) {
  modelEl.innerHTML = '';
  MODELS[provider].forEach(({ value, label }) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    if (currentModel === value) opt.selected = true;
    modelEl.appendChild(opt);
  });
}

function updateKeyHint(provider) {
  keyHintEl.textContent = KEY_HINTS[provider] || '';
}

// ── Toggle API key visibility ─────────────────────────────────────────────────
toggleKeyEl.addEventListener('click', () => {
  apiKeyEl.type = apiKeyEl.type === 'password' ? 'text' : 'password';
});

// ── Save settings ─────────────────────────────────────────────────────────────
document.getElementById('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const settings = {
    provider: providerEl.value,
    model:    modelEl.value,
    apiKey:   apiKeyEl.value.trim(),
  };

  if (!settings.apiKey) {
    showStatus('APIキーを入力してください', true);
    return;
  }

  await chrome.storage.local.set({ settings });
  showStatus('保存しました ✓');
});

function showStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.className = isError ? 'status error' : 'status';
  setTimeout(() => { statusEl.textContent = ''; }, 2500);
}

// ── History ───────────────────────────────────────────────────────────────────
function renderHistory(qaMap) {
  const entries = Object.entries(qaMap).sort((a, b) => b[1].createdAt - a[1].createdAt);

  if (entries.length === 0) {
    historyList.innerHTML = '<li class="history-empty">まだ質問がありません</li>';
    return;
  }

  historyList.innerHTML = '';
  entries.forEach(([id, qa]) => {
    const li = document.createElement('li');
    li.className = 'history-item';
    li.innerHTML = `
      <span class="history-item-q">${escapeHtml(qa.question)}</span>
      <span class="history-item-sel">「${escapeHtml(qa.selectedText.slice(0, 50))}${qa.selectedText.length > 50 ? '…' : ''}」</span>
      <span class="history-item-date">${new Date(qa.createdAt).toLocaleString('ja-JP')}</span>
      <button class="history-item-delete" data-id="${id}">削除</button>
    `;
    historyList.appendChild(li);
  });

  // Delete individual item
  historyList.querySelectorAll('.history-item-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const stored = await chrome.storage.local.get('qaMap');
      const qaMap = stored.qaMap || {};
      const { [id]: _removed, ...rest } = qaMap;
      await chrome.storage.local.set({ qaMap: rest });
      btn.closest('li').remove();
      if (historyList.children.length === 0) {
        historyList.innerHTML = '<li class="history-empty">まだ質問がありません</li>';
      }
    });
  });
}

clearAllBtn.addEventListener('click', async () => {
  if (!confirm('保存されたすべての Q&A を削除しますか？')) return;
  await chrome.storage.local.set({ qaMap: {} });
  historyList.innerHTML = '<li class="history-empty">まだ質問がありません</li>';
});

// ── Utility ───────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

init();
