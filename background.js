/**
 * peek-ai-boo – Background Service Worker
 *
 * Handles API calls to Claude (Anthropic) or OpenAI.
 * Keeps API keys out of the content script (security best practice).
 */

'use strict';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'ASK_AI') {
    handleAskAI(message).then(sendResponse).catch(err => {
      sendResponse({ error: err.message });
    });
    return true; // keep channel open for async response
  }
});

async function handleAskAI({ selectedText, question }) {
  const settings = await getSettings();

  if (!settings.apiKey) {
    throw new Error('APIキーが設定されていません。拡張機能のアイコンをクリックして設定してください。');
  }

  const systemPrompt =
    'あなたは親切なアシスタントです。ユーザーがチャットで見ているテキストの一部について質問しています。' +
    'その質問に対して簡潔・正確に日本語で回答してください。' +
    '回答はチャット履歴に入らず、ユーザーのサイドメモとして使われます。';

  const userPrompt =
    `以下のテキストについて質問があります。\n\n` +
    `【対象テキスト】\n${selectedText}\n\n` +
    `【質問】\n${question}`;

  if (settings.provider === 'openai') {
    return callOpenAI({ settings, systemPrompt, userPrompt });
  } else if (settings.provider === 'gemini') {
    return callGemini({ settings, systemPrompt, userPrompt });
  } else {
    return callClaude({ settings, systemPrompt, userPrompt });
  }
}

// ── Claude (Anthropic) ────────────────────────────────────────────────────────
async function callClaude({ settings, systemPrompt, userPrompt }) {
  const model = settings.model || 'claude-haiku-4-5-20251001';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `Anthropic API error: ${res.status}`);
  }

  const data = await res.json();
  const answer = data.content?.[0]?.text;
  if (!answer) throw new Error('Anthropic APIから回答が得られませんでした。');
  return { answer };
}

// ── OpenAI ────────────────────────────────────────────────────────────────────
async function callOpenAI({ settings, systemPrompt, userPrompt }) {
  const model = settings.model || 'gpt-4o-mini';
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${settings.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `OpenAI API error: ${res.status}`);
  }

  const data = await res.json();
  const answer = data.choices?.[0]?.message?.content;
  if (!answer) throw new Error('OpenAI APIから回答が得られませんでした。');
  return { answer };
}

// ── Gemini (Google) ───────────────────────────────────────────────────────────
async function callGemini({ settings, systemPrompt, userPrompt }) {
  const model = settings.model || 'gemini-2.5-pro';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${settings.apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { maxOutputTokens: 1024 },
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `Gemini API error: ${res.status}`);
  }

  const data = await res.json();
  const answer = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!answer) throw new Error('Gemini APIから回答が得られませんでした。');
  return { answer };
}

// ── Settings helper ───────────────────────────────────────────────────────────
async function getSettings() {
  const result = await chrome.storage.local.get('settings');
  return result.settings || {};
}
