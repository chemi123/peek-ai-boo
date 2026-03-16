/**
 * peek-ai-boo - Content Script
 *
 * Flow:
 *  1. User selects text → "Ask" button appears
 *  2. User clicks "Ask" → question input panel appears
 *  3. Submit → API call via background.js → response shown in tooltip
 *  4. Selected text is wrapped in a highlight span
 *  5. Clicking highlight → shows stored response tooltip
 */

'use strict';

const HIGHLIGHT_CLASS = 'peekaibu-highlight';
const ATTR_QA_ID = 'data-peekaibu-id';

// ── State ─────────────────────────────────────────────────────────────────────
let askButton = null;
let panel = null;
let currentRange = null;
let activeTooltip = null;

// ── Initialise ────────────────────────────────────────────────────────────────
function init() {
  createAskButton();
  createPanel();
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('click', onDocumentClick);
}

// ── "Ask" floating button ─────────────────────────────────────────────────────
function createAskButton() {
  askButton = document.createElement('button');
  askButton.className = 'peekaibu-ask-btn';
  askButton.textContent = '💬 Ask';
  askButton.setAttribute('aria-label', 'Ask AI about selected text');
  askButton.addEventListener('click', onAskClick);
  askButton.addEventListener('mousedown', e => e.preventDefault()); // keep selection
  document.body.appendChild(askButton);
}

function showAskButton(rect) {
  askButton.style.top = `${rect.top + window.scrollY - 40}px`;
  askButton.style.left = `${rect.left + window.scrollX}px`;
  askButton.classList.add('visible');
}

function hideAskButton() {
  askButton.classList.remove('visible');
}

// ── Question panel ─────────────────────────────────────────────────────────────
function createPanel() {
  panel = document.createElement('div');
  panel.className = 'peekaibu-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Ask AI');
  panel.innerHTML = `
    <div class="peekaibu-panel-header">
      <span class="peekaibu-panel-label">💬 選択箇所について質問</span>
      <button class="peekaibu-panel-close" aria-label="閉じる">✕</button>
    </div>
    <div class="peekaibu-selected-preview"></div>
    <textarea class="peekaibu-question" placeholder="質問を入力..." rows="2"></textarea>
    <div class="peekaibu-panel-footer">
      <button class="peekaibu-submit">送信</button>
      <span class="peekaibu-hint">Ctrl+Enter で送信</span>
    </div>
    <div class="peekaibu-answer hidden"></div>
    <div class="peekaibu-loading hidden">
      <span class="peekaibu-spinner"></span> 回答を生成中...
    </div>
  `;

  panel.querySelector('.peekaibu-panel-close').addEventListener('click', closePanel);
  panel.querySelector('.peekaibu-submit').addEventListener('click', submitQuestion);
  panel.querySelector('.peekaibu-question').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) submitQuestion();
  });
  panel.addEventListener('mousedown', e => e.stopPropagation());

  document.body.appendChild(panel);
}

function openPanel(rect, selectedText) {
  panel.querySelector('.peekaibu-selected-preview').textContent =
    selectedText.length > 120 ? selectedText.slice(0, 120) + '…' : selectedText;
  panel.querySelector('.peekaibu-question').value = '';
  panel.querySelector('.peekaibu-answer').classList.add('hidden');
  panel.querySelector('.peekaibu-answer').textContent = '';
  panel.querySelector('.peekaibu-loading').classList.add('hidden');

  // Position panel below/above selection
  const panelWidth = 340;
  let left = rect.left + window.scrollX;
  let top = rect.bottom + window.scrollY + 8;

  // Keep within viewport horizontally
  if (left + panelWidth > window.innerWidth - 16) {
    left = window.innerWidth - panelWidth - 16;
  }
  if (left < 8) left = 8;

  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.classList.add('visible');
  panel.querySelector('.peekaibu-question').focus();
}

function closePanel() {
  panel.classList.remove('visible');
  currentRange = null;
}

// ── Submit logic ──────────────────────────────────────────────────────────────
async function submitQuestion() {
  const questionEl = panel.querySelector('.peekaibu-question');
  const answerEl = panel.querySelector('.peekaibu-answer');
  const loadingEl = panel.querySelector('.peekaibu-loading');
  const submitBtn = panel.querySelector('.peekaibu-submit');

  const question = questionEl.value.trim();
  if (!question || !currentRange) return;

  const selectedText = currentRange.toString();

  // Show loading
  loadingEl.classList.remove('hidden');
  answerEl.classList.add('hidden');
  submitBtn.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'ASK_AI',
      selectedText,
      question,
    });

    if (response.error) throw new Error(response.error);

    const qaId = crypto.randomUUID();

    // Save to storage
    const stored = await chrome.storage.local.get('qaMap') || {};
    const qaMap = stored.qaMap || {};
    qaMap[qaId] = {
      selectedText,
      question,
      answer: response.answer,
      createdAt: Date.now(),
    };
    await chrome.storage.local.set({ qaMap });

    // Highlight the selected text
    highlightRange(currentRange, qaId);

    // Show answer in panel
    loadingEl.classList.add('hidden');
    answerEl.textContent = response.answer;
    answerEl.classList.remove('hidden');
    submitBtn.disabled = false;

  } catch (err) {
    loadingEl.classList.add('hidden');
    answerEl.textContent = `エラー: ${err.message}`;
    answerEl.classList.remove('hidden');
    answerEl.classList.add('error');
    submitBtn.disabled = false;
  }
}

// ── Text highlighting ─────────────────────────────────────────────────────────
function highlightRange(range, qaId) {
  try {
    const mark = document.createElement('mark');
    mark.className = HIGHLIGHT_CLASS;
    mark.setAttribute(ATTR_QA_ID, qaId);
    mark.setAttribute('title', 'クリックして回答を表示');
    mark.addEventListener('click', onHighlightClick);
    range.surroundContents(mark);
  } catch {
    // surroundContents fails on partial selections spanning multiple elements
    // Fallback: wrap each text node individually
    const fragment = range.extractContents();
    const mark = document.createElement('mark');
    mark.className = HIGHLIGHT_CLASS;
    mark.setAttribute(ATTR_QA_ID, qaId);
    mark.setAttribute('title', 'クリックして回答を表示');
    mark.addEventListener('click', onHighlightClick);
    mark.appendChild(fragment);
    range.insertNode(mark);
  }
}

// ── Response tooltip on highlight click ──────────────────────────────────────
async function onHighlightClick(e) {
  e.stopPropagation();
  const qaId = e.currentTarget.getAttribute(ATTR_QA_ID);
  if (!qaId) return;

  const stored = await chrome.storage.local.get('qaMap');
  const qa = (stored.qaMap || {})[qaId];
  if (!qa) return;

  showResponseTooltip(e.currentTarget, qa);
}

function showResponseTooltip(anchor, qa) {
  // Remove existing tooltip
  if (activeTooltip) activeTooltip.remove();

  const tooltip = document.createElement('div');
  tooltip.className = 'peekaibu-response-tooltip';
  tooltip.innerHTML = `
    <div class="peekaibu-tooltip-header">
      <span class="peekaibu-tooltip-q">Q: ${escapeHtml(qa.question)}</span>
      <button class="peekaibu-tooltip-close" aria-label="閉じる">✕</button>
    </div>
    <div class="peekaibu-tooltip-answer">${escapeHtml(qa.answer)}</div>
    <div class="peekaibu-tooltip-meta">${new Date(qa.createdAt).toLocaleString('ja-JP')}</div>
  `;

  tooltip.querySelector('.peekaibu-tooltip-close').addEventListener('click', (e) => {
    e.stopPropagation();
    tooltip.remove();
    activeTooltip = null;
  });

  document.body.appendChild(tooltip);
  activeTooltip = tooltip;

  // Position below anchor
  const rect = anchor.getBoundingClientRect();
  const tooltipWidth = 360;
  let left = rect.left + window.scrollX;
  let top = rect.bottom + window.scrollY + 6;

  if (left + tooltipWidth > window.innerWidth - 16) {
    left = window.innerWidth - tooltipWidth - 16;
  }
  if (left < 8) left = 8;

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

// ── Event handlers ────────────────────────────────────────────────────────────
function onMouseUp(e) {
  // Ignore clicks inside our own UI
  if (e.target.closest('.peekaibu-ask-btn, .peekaibu-panel, .peekaibu-response-tooltip')) return;

  setTimeout(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      hideAskButton();
      return;
    }

    currentRange = selection.getRangeAt(0).cloneRange();
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    showAskButton(rect);
  }, 10);
}

function onAskClick() {
  if (!currentRange) return;
  const selection = window.getSelection();
  const rect = currentRange.getBoundingClientRect();
  openPanel(rect, currentRange.toString());
  hideAskButton();
  if (selection) selection.removeAllRanges();
}

function onKeyDown(e) {
  if (e.key === 'Escape') {
    closePanel();
    hideAskButton();
    if (activeTooltip) {
      activeTooltip.remove();
      activeTooltip = null;
    }
  }
}

function onDocumentClick(e) {
  if (!e.target.closest('.peekaibu-panel')) {
    // Don't close if clicking ask button (handled by onAskClick)
  }
  if (!e.target.closest('.peekaibu-response-tooltip, .peekaibu-highlight')) {
    if (activeTooltip) {
      activeTooltip.remove();
      activeTooltip = null;
    }
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\n/g, '<br>');
}

// ── Re-attach listeners on existing highlights after page navigation ──────────
function reattachHighlightListeners() {
  document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach(el => {
    el.removeEventListener('click', onHighlightClick);
    el.addEventListener('click', onHighlightClick);
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────────
init();
