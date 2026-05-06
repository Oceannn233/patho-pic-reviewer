/**
 * Medical Pathology Image Review App
 * Round-based image recognition study tool with error tracking
 */

// ==================== Data Loading ====================

// Question bank will be loaded from JSON
let QUESTION_BANK = [];

// ==================== App State ====================

const APP_STATE = {
  // Current round
  currentRound: {
    id: null,
    startedAt: null,
    questionPool: [],       // Questions remaining in this round (with weights)
    completedQuestions: [], // Questions answered correctly this round
    errorQuestions: [],     // Questions answered wrong this round (with counts)
    history: [],            // Full history: {questionId, answer, correct, timestamp}
    totalAttempts: 0,
    correctAttempts: 0,
    currentQuestion: null,
    hintLevel: 0,           // 0=no hint shown, 1,2,3
    isComplete: false,
  },

  // Persistent across rounds
  errorBook: {},            // {questionId: {count, rounds: [...]}}
  allRounds: [],            // Saved completed rounds

  // UI state
  isAnswerRevealed: false,
  isRoundSetup: false,      // Whether a round is active
};

// ==================== Initialization ====================

async function initApp() {
  try {
    // Load lightweight question bank (fast, no base64)
    let response = await fetch('data/question_bank_light.json');
    if (!response.ok) {
      // Fallback to full version if light not found
      response = await fetch('data/question_bank.json');
    }
    QUESTION_BANK = await response.json();

    // Clean up answers (remove special characters like \\x0b, \\r, etc.)
    QUESTION_BANK = QUESTION_BANK.map(q => ({
      ...q,
      answer: (q.answer || '').replace(/[\x0b\x0c\r]+/g, ' ').replace(/\s+/g, ' ').trim(),
      all_text: (q.all_text || '').replace(/[\x0b\x0c\r]+/g, ' ').replace(/\s+/g, ' ').trim(),
      texts: (q.texts || []).map(t => t.replace(/[\x0b\x0c\r]+/g, ' ').replace(/\s+/g, ' ').trim()),
    }));

    // Build aliases lookup from knowledge base
    buildAliasesLookup();

    // Load saved state from localStorage
    loadState();

    // Render initial screen
    renderSetupScreen();

    console.log(`App initialized: ${QUESTION_BANK.length} questions loaded`);
  } catch (err) {
    console.error('Failed to initialize app:', err);
    document.getElementById('app').innerHTML = `
      <div class="setup-screen">
        <div class="setup-card">
          <h1>加载失败</h1>
          <p class="subtitle">无法加载题库数据，请检查 data/question_bank.json 文件是否存在。</p>
          <p style="color:var(--danger);font-size:0.85rem;">${err.message}</p>
        </div>
      </div>`;
  }
}

// Flexible knowledge base lookup
function getKnowledge(cleanAnswer) {
  // Direct match
  if (KNOWLEDGE_BASE[cleanAnswer]) return KNOWLEDGE_BASE[cleanAnswer];
  // Try without spaces before Chinese punctuation
  const noSpace = cleanAnswer.replace(/\s+([（(）)])/g, '$1');
  if (KNOWLEDGE_BASE[noSpace]) return KNOWLEDGE_BASE[noSpace];
  // Try with spaces before Chinese punctuation
  const withSpace = cleanAnswer.replace(/([^(（\s])([（(])/g, '$1 $2');
  if (KNOWLEDGE_BASE[withSpace]) return KNOWLEDGE_BASE[withSpace];
  return null;
}

// Build aliases map from knowledge base
let ALIASES_MAP = {};
function buildAliasesLookup() {
  for (const [answer, data] of Object.entries(KNOWLEDGE_BASE)) {
    if (data.aliases) {
      for (const alias of data.aliases) {
        const key = normalizeText(alias);
        if (!ALIASES_MAP[key]) {
          ALIASES_MAP[key] = answer;
        }
      }
    }
  }
}

// ==================== State Persistence ====================

function saveState() {
  const state = {
    errorBook: APP_STATE.errorBook,
    allRounds: APP_STATE.allRounds,
  };
  try {
    localStorage.setItem('pathology_review_state', JSON.stringify(state));
  } catch (e) {
    console.warn('Failed to save state:', e);
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem('pathology_review_state');
    if (raw) {
      const state = JSON.parse(raw);
      APP_STATE.errorBook = state.errorBook || {};
      APP_STATE.allRounds = state.allRounds || [];
    }
  } catch (e) {
    console.warn('Failed to load state:', e);
  }
}

// ==================== Text Normalization ====================

function normalizeText(text) {
  return text
    .replace(/[\s\n\r\x0b\t]+/g, '')     // Remove all whitespace
    .replace(/[（）\(\)]/g, '')           // Remove parentheses
    .replace(/[，。、；：！？]/g, '')      // Remove Chinese punctuation
    .replace(/[,.;:!?]/g, '')             // Remove English punctuation
    .replace(/[\-\–\—]/g, '')             // Remove dashes
    .toLowerCase()
    .trim();
}

function checkAnswer(userInput, correctAnswer) {
  const normalized = normalizeText(userInput);
  if (!normalized) return false;

  // Direct match
  const correctNorm = normalizeText(correctAnswer);
  if (normalized === correctNorm) return true;

  // Check aliases
  if (ALIASES_MAP[normalized] && ALIASES_MAP[normalized] === correctAnswer) {
    return true;
  }

  // Check knowledge base for this answer
  const kb = getKnowledge(correctAnswer);
  if (kb) {
    // Check aliases
    if (kb.aliases) {
      for (const alias of kb.aliases) {
        if (normalizeText(alias) === normalized) return true;
      }
    }
    // Check keywords - if input contains multiple key keywords
    if (kb.keywords && normalized.length >= 2) {
      let matchCount = 0;
      for (const kw of kb.keywords) {
        if (normalized.includes(normalizeText(kw))) {
          matchCount++;
        }
      }
      // Require at least 2 keyword matches for very short answers, proportionally
      const threshold = Math.min(Math.ceil(kb.keywords.length * 0.5), 2);
      if (matchCount >= Math.max(threshold, 2)) return true;
    }
  }

  // Flexible: check if correct answer contains the user input or vice versa
  // Only for longer inputs (>=4 chars) to avoid false positives
  if (normalized.length >= 4 && correctNorm.length >= 4) {
    if (correctNorm.includes(normalized) || normalized.includes(correctNorm)) {
      return true;
    }
  }

  return false;
}

// ==================== Round Management ====================

function startNewRound(categoryFilter = null) {
  // Build question pool
  let pool = QUESTION_BANK;
  if (categoryFilter) {
    pool = QUESTION_BANK.filter(q => q.category === categoryFilter);
  }

  if (pool.length === 0) {
    showToast('没有可用的题目', 'error');
    return;
  }

  const roundId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  APP_STATE.currentRound = {
    id: roundId,
    startedAt: Date.now(),
    questionPool: pool.map(q => ({
      ...q,
      weight: 1,
      shownCount: 0,
    })),
    completedQuestions: [],
    errorQuestions: [],
    history: [],
    totalAttempts: 0,
    correctAttempts: 0,
    currentQuestion: null,
    hintLevel: 0,
    isComplete: false,
  };

  APP_STATE.isRoundSetup = true;
  APP_STATE.isAnswerRevealed = false;

  renderRoundScreen();
  showNextQuestion();
  showToast(`新一轮复习开始！共 ${pool.length} 道题目`, 'success');
}

function getWeightedRandomQuestion() {
  const pool = APP_STATE.currentRound.questionPool;
  if (pool.length === 0) {
    // Round complete!
    completeRound();
    return null;
  }

  // Weighted random selection
  const totalWeight = pool.reduce((sum, q) => sum + q.weight, 0);
  let rand = Math.random() * totalWeight;

  for (let i = 0; i < pool.length; i++) {
    rand -= pool[i].weight;
    if (rand <= 0) {
      return { question: pool[i], index: i };
    }
  }

  return { question: pool[pool.length - 1], index: pool.length - 1 };
}

function showNextQuestion() {
  const result = getWeightedRandomQuestion();
  if (!result) return;

  APP_STATE.currentRound.currentQuestion = result.question;
  APP_STATE.currentRound.hintLevel = 0;
  APP_STATE.isAnswerRevealed = false;

  renderQuestionCard(result.question);
  updateProgressUI();
}

function submitAnswer() {
  if (APP_STATE.isAnswerRevealed) return;
  if (!APP_STATE.currentRound.currentQuestion) return;

  const inputEl = document.getElementById('answerInput');
  const userAnswer = inputEl.value.trim();

  if (!userAnswer) {
    showToast('请输入答案', 'warning');
    inputEl.focus();
    return;
  }

  const currentQ = APP_STATE.currentRound.currentQuestion;
  // Get correct answer - check the answer field and texts
  const correctAnswer = currentQ.answer || currentQ.texts[0] || '';

  const isCorrect = checkAnswer(userAnswer, correctAnswer);

  APP_STATE.currentRound.totalAttempts++;
  APP_STATE.currentRound.history.push({
    questionId: currentQ.id,
    userAnswer: userAnswer,
    correctAnswer: correctAnswer,
    isCorrect: isCorrect,
    timestamp: Date.now(),
  });

  if (isCorrect) {
    APP_STATE.isAnswerRevealed = true;
    APP_STATE.currentRound.correctAttempts++;
    APP_STATE.currentRound.completedQuestions.push(currentQ.id);

    // Remove from pool
    const pool = APP_STATE.currentRound.questionPool;
    const idx = pool.findIndex(q => q.id === currentQ.id);
    if (idx >= 0) pool.splice(idx, 1);

    handleCorrectAnswer(correctAnswer);
  } else {
    APP_STATE.isAnswerRevealed = true;

    // Increase weight for wrong answers (they'll appear more often)
    const pool = APP_STATE.currentRound.questionPool;
    const item = pool.find(q => q.id === currentQ.id);
    if (item) {
      item.weight = Math.min(item.weight + 1.5, 5);
      item.shownCount++;
    }

    // Track in error book (persistent)
    if (!APP_STATE.errorBook[currentQ.id]) {
      APP_STATE.errorBook[currentQ.id] = {
        count: 0,
        rounds: [],
      };
    }
    APP_STATE.errorBook[currentQ.id].count++;
    if (!APP_STATE.errorBook[currentQ.id].rounds.includes(APP_STATE.currentRound.id)) {
      APP_STATE.errorBook[currentQ.id].rounds.push(APP_STATE.currentRound.id);
    }

    // Track in current round errors
    APP_STATE.currentRound.errorQuestions.push({
      ...currentQ,
      correctAnswer: correctAnswer,
      userAnswer: userAnswer,
    });

    handleWrongAnswer(correctAnswer);
  }

  saveState();
  updateProgressUI();
  updateErrorBookUI();
}

function handleCorrectAnswer(correctAnswer) {
  const inputEl = document.getElementById('answerInput');
  const feedbackEl = document.getElementById('feedback');
  const actionsEl = document.getElementById('responseActions');

  // Visual feedback
  inputEl.classList.add('correct');
  feedbackEl.className = 'feedback correct-fb show';

  const kb = getKnowledge(correctAnswer);
  const explanation = kb ? kb.explanation : `${correctAnswer} —— 回答正确！`;

  feedbackEl.innerHTML = `
    <div class="feedback-header">✅ 回答正确！</div>
    <div class="feedback-body">${escapeHtml(explanation)}</div>
  `;

  // Show next button
  if (actionsEl) actionsEl.style.display = 'flex';

  document.querySelector('.main-card').classList.add('pulse');
  setTimeout(() => document.querySelector('.main-card').classList.remove('pulse'), 300);

  // Auto-advance after delay
  APP_STATE._autoAdvanceTimer = setTimeout(() => {
    advanceToNext();
  }, 4000);
}

function handleWrongAnswer(correctAnswer) {
  const inputEl = document.getElementById('answerInput');
  const feedbackEl = document.getElementById('feedback');
  const actionsEl = document.getElementById('responseActions');

  inputEl.classList.add('wrong');
  feedbackEl.className = 'feedback wrong-fb show';

  const kb = getKnowledge(correctAnswer);
  const explanation = kb ? kb.explanation : `正确答案: ${correctAnswer}`;

  feedbackEl.innerHTML = `
    <div class="feedback-header">❌ 回答错误</div>
    <div class="feedback-body">正确答案：<strong>${escapeHtml(correctAnswer)}</strong>
${escapeHtml(explanation)}</div>
  `;

  // Show next button (no auto-advance for wrong answers)
  if (actionsEl) actionsEl.style.display = 'flex';

  document.querySelector('.main-card').classList.add('shake');
  setTimeout(() => document.querySelector('.main-card').classList.remove('shake'), 500);
}

function advanceToNext() {
  if (APP_STATE._autoAdvanceTimer) {
    clearTimeout(APP_STATE._autoAdvanceTimer);
    APP_STATE._autoAdvanceTimer = null;
  }

  const inputEl = document.getElementById('answerInput');
  const feedbackEl = document.getElementById('feedback');
  const actionsEl = document.getElementById('responseActions');

  if (inputEl) {
    inputEl.classList.remove('correct', 'wrong');
    inputEl.value = '';
  }
  if (feedbackEl) feedbackEl.className = 'feedback';
  if (actionsEl) actionsEl.style.display = 'none';

  showNextQuestion();
}

function showHint() {
  const currentQ = APP_STATE.currentRound.currentQuestion;
  if (!currentQ) return;

  const correctAnswer = currentQ.answer || currentQ.texts[0] || '';
  const kb = getKnowledge(correctAnswer);

  if (!kb || !kb.hints || kb.hints.length === 0) {
    showToast('暂无提示信息', 'warning');
    return;
  }

  const hintLevel = APP_STATE.currentRound.hintLevel;
  const hintText = kb.hints[Math.min(hintLevel, kb.hints.length - 1)];
  const nextLevel = Math.min(hintLevel + 1, kb.hints.length);

  APP_STATE.currentRound.hintLevel = nextLevel;

  document.getElementById('hintText').textContent = hintText;
  document.getElementById('hintLevel').textContent =
    `提示 ${Math.min(hintLevel + 1, kb.hints.length)}/${kb.hints.length}`;
  document.getElementById('hintPopup').classList.add('show');
  document.getElementById('hintOverlay').classList.add('active');
}

function closeHint() {
  document.getElementById('hintPopup').classList.remove('show');
  document.getElementById('hintOverlay').classList.remove('active');
}

function completeRound() {
  APP_STATE.currentRound.isComplete = true;
  APP_STATE.isAnswerRevealed = true;

  // Save round to history
  const roundSummary = {
    id: APP_STATE.currentRound.id,
    startedAt: APP_STATE.currentRound.startedAt,
    completedAt: Date.now(),
    totalQuestions: QUESTION_BANK.length,
    totalAttempts: APP_STATE.currentRound.totalAttempts,
    correctAttempts: APP_STATE.currentRound.correctAttempts,
    errorCount: APP_STATE.currentRound.errorQuestions.length,
    accuracy: APP_STATE.currentRound.totalAttempts > 0
      ? Math.round((APP_STATE.currentRound.correctAttempts / APP_STATE.currentRound.totalAttempts) * 100)
      : 0,
  };

  APP_STATE.allRounds.unshift(roundSummary);
  APP_STATE.isRoundSetup = false;
  saveState();

  renderRoundComplete();
  showToast('本轮复习完成！', 'success');
}

// ==================== Rendering ====================

function renderSetupScreen() {
  const app = document.getElementById('app');

  const categories = ['血循障碍', '炎症', '肿瘤', '组损与修复'];
  const categoryCounts = categories.map(cat => ({
    name: cat,
    count: QUESTION_BANK.filter(q => q.category === cat).length,
  }));

  const savedRoundsHtml = APP_STATE.allRounds.length > 0
    ? APP_STATE.allRounds.slice(0, 5).map((r, i) => `
        <div class="saved-round-item" onclick="viewRoundDetail('${r.id}')">
          <span>📋 第${APP_STATE.allRounds.length - i}轮</span>
          <span style="color:var(--text-secondary)">
            ${new Date(r.startedAt).toLocaleDateString()}
            · 正确率 ${r.accuracy}%
            · ${r.totalAttempts}题
          </span>
        </div>`).join('')
    : '<div class="empty-state"><div class="icon">📝</div>暂无保存的复习记录</div>';

  app.innerHTML = `
    <div class="setup-screen animate-in">
      <div class="setup-card">
        <h1>🔬 病理学识图复习</h1>
        <p class="subtitle">人体概论实验课 · 图片考试题库</p>

        <div class="setup-stats">
          <div class="setup-stat">
            <div class="num">${QUESTION_BANK.length}</div>
            <div class="lbl">题库总数</div>
          </div>
          <div class="setup-stat">
            <div class="num">4</div>
            <div class="lbl">分类</div>
          </div>
          <div class="setup-stat">
            <div class="num">${Object.keys(APP_STATE.errorBook).length}</div>
            <div class="lbl">错题本</div>
          </div>
          <div class="setup-stat">
            <div class="num">${APP_STATE.allRounds.length}</div>
            <div class="lbl">已完成轮次</div>
          </div>
        </div>

        <h3 style="margin-bottom:12px;font-size:0.95rem;color:var(--text-secondary)">开始新复习</h3>
        <button class="btn btn-primary btn-lg" style="width:100%;justify-content:center;margin-bottom:8px;"
          onclick="startNewRound()">
          📚 全部题目复习（${QUESTION_BANK.length}题）
        </button>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          ${categoryCounts.map(cat => `
            <button class="btn btn-ghost btn-sm" onclick="startNewRound('${cat.name}')">
              ${cat.name} (${cat.count}题)
            </button>`).join('')}
        </div>

        <div style="margin-top:16px;">
          <button class="btn btn-outline btn-sm" style="width:100%;justify-content:center;color:var(--danger);border-color:var(--danger-light);"
            onclick="reviewErrors()">
            📖 仅复习错题（${Object.keys(APP_STATE.errorBook).length}题）
          </button>
        </div>

        <div class="saved-rounds-list">
          <h3>📋 历史复习记录</h3>
          ${savedRoundsHtml}
          ${APP_STATE.allRounds.length > 5 ? `<p style="text-align:center;color:var(--text-light);font-size:0.8rem;margin-top:8px;">还有 ${APP_STATE.allRounds.length - 5} 条记录...</p>` : ''}
          ${APP_STATE.allRounds.length > 0 ? `
            <button class="btn btn-ghost btn-sm" style="width:100%;margin-top:8px;justify-content:center;"
              onclick="clearAllData()">
              🗑 清除所有记录
            </button>` : ''}
        </div>
      </div>
    </div>
  `;

  updateHeaderStats();
}

function renderRoundScreen() {
  const app = document.getElementById('app');
  const r = APP_STATE.currentRound;
  const poolSize = r.questionPool.length;

  app.innerHTML = `
    <div class="main-container animate-in">
      <div class="main-card" id="mainCard">
        <div class="card-header">
          <span class="category-badge" id="categoryBadge">--</span>
          <span style="font-size:0.85rem;color:var(--text-secondary);">
            第 <strong id="roundNum">?</strong> 题 · 剩余 <strong id="remainingCount">${poolSize}</strong> 题
          </span>
          <button class="btn btn-ghost btn-sm" onclick="endRound()">结束本轮</button>
        </div>
        <div class="card-body" id="cardBody">
          <!-- Question card rendered here -->
        </div>
      </div>

      <div class="sidebar">
        <!-- Progress Card -->
        <div class="sidebar-card">
          <div class="sidebar-card-header">📊 本轮进度</div>
          <div class="sidebar-card-body">
            <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
              <span>正确率</span>
              <span id="accuracyText">--</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" id="progressFill" style="width:0%"></div>
            </div>
            <div style="margin-top:12px;display:flex;justify-content:space-between;font-size:0.8rem;color:var(--text-secondary);">
              <span>✅ 正确: <strong id="correctCount">0</strong></span>
              <span>❌ 错误: <strong id="errorInRoundCount">0</strong></span>
              <span>⏳ 剩余: <strong id="remainingCount2">${poolSize}</strong></span>
            </div>
          </div>
        </div>

        <!-- Error Book Card -->
        <div class="sidebar-card">
          <div class="sidebar-card-header">📕 错题本 <span style="font-weight:400;color:var(--text-light);font-size:0.75rem;">(永久)</span></div>
          <div class="sidebar-card-body" id="errorBookList">
            ${renderErrorBookList()}
          </div>
        </div>

        <!-- Quick Actions -->
        <div class="sidebar-card">
          <div class="sidebar-card-body" style="display:flex;flex-direction:column;gap:8px;">
            <button class="btn btn-ghost btn-sm" style="width:100%;" onclick="backToHome()">
              🏠 回到首页
            </button>
            <button class="btn btn-ghost btn-sm" style="width:100%;" onclick="endRound()">
              ⏹ 结束本轮
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Hint Popup -->
    <div class="hint-overlay" id="hintOverlay" onclick="closeHint()"></div>
    <div class="hint-popup" id="hintPopup">
      <button style="float:right;background:none;border:none;font-size:1.2rem;cursor:pointer;color:var(--text-secondary);" onclick="closeHint()">✕</button>
      <h3>💡 知识点提示</h3>
      <p class="hint-content" id="hintText"></p>
      <p class="hint-level" id="hintLevel"></p>
    </div>

    <!-- Image Zoom -->
    <div class="zoom-overlay" id="zoomOverlay" onclick="closeZoom()"></div>

    <!-- Toast -->
    <div class="toast-container" id="toastContainer"></div>
  `;

  updateHeaderStats();
}

function renderQuestionCard(question) {
  const cardBody = document.getElementById('cardBody');
  if (!cardBody) return;

  document.getElementById('categoryBadge').textContent = question.category || '--';

  const poolSize = APP_STATE.currentRound.questionPool.length;
  const answeredInRound = APP_STATE.currentRound.completedQuestions.length;
  document.getElementById('roundNum').textContent = answeredInRound + 1;
  document.getElementById('remainingCount').textContent = poolSize;
  document.getElementById('remainingCount2').textContent = poolSize;

  // Use base64 if available for offline use, but prefer file path
  const imgSrc = question.image_base64
    ? `data:image/jpeg;base64,${question.image_base64}`
    : `images/${question.image}`;

  cardBody.innerHTML = `
    <div class="image-container" id="imageContainer" onclick="toggleZoom()" title="点击放大/缩小">
      <img src="${imgSrc}" alt="病理图片" id="slideImage"
        onerror="this.parentElement.innerHTML='<div style=padding:40px;color:var(--text-light)>图片加载失败<br><small>'+this.src+'</small></div>'">
    </div>

    <div class="answer-area">
      <div class="answer-input-group">
        <input type="text" class="answer-input" id="answerInput"
          placeholder="输入病变/疾病类型..."
          autocomplete="off" autofocus
          onkeydown="if(event.key==='Enter')submitAnswer()">
        <button class="hint-btn" onclick="showHint()" title="查看提示">💡 提示</button>
        <button class="btn btn-primary" onclick="submitAnswer()" id="submitBtn">确认</button>
      </div>

      <div style="text-align:center;margin-top:8px;">
        <button class="btn btn-ghost btn-sm" onclick="skipQuestion()" style="font-size:0.8rem;opacity:0.7;">
          ⏭ 跳过（查看答案）
        </button>
      </div>

      <div id="responseActions" style="margin-top:12px;display:flex;gap:8px;justify-content:center;display:none;">
        <button class="btn btn-primary btn-sm" onclick="nextAfterAnswer()" id="nextBtn">下一题 →</button>
      </div>

      <div class="feedback" id="feedback"></div>
    </div>

    <div style="margin-top:12px;font-size:0.75rem;color:var(--text-light);text-align:center;">
      快捷键：Enter 确认 · Ctrl+Enter 提交 · N 下一题 · Esc 关闭弹窗
    </div>
  `;

  // Focus input
  setTimeout(() => {
    const input = document.getElementById('answerInput');
    if (input) input.focus();
  }, 100);
}

function renderRoundComplete() {
  const r = APP_STATE.currentRound;
  const total = r.totalAttempts;
  const accuracy = total > 0 ? Math.round((r.correctAttempts / total) * 100) : 0;
  const errors = r.errorQuestions;

  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="setup-screen animate-in">
      <div class="setup-card" style="max-width:600px;">
        <div class="round-complete">
          <div class="trophy">${accuracy >= 90 ? '🏆' : accuracy >= 70 ? '🎯' : '📚'}</div>
          <h2>本轮复习完成！</h2>
          <p style="color:var(--text-secondary);margin-bottom:16px;">${new Date(r.startedAt).toLocaleString()} 开始</p>

          <div class="stats-grid">
            <div class="stat-card">
              <div style="font-size:2rem;font-weight:700;color:var(--success);">${accuracy}%</div>
              <div style="font-size:0.8rem;color:var(--text-secondary);">正确率</div>
            </div>
            <div class="stat-card">
              <div style="font-size:2rem;font-weight:700;">${total}</div>
              <div style="font-size:0.8rem;color:var(--text-secondary);">总答题</div>
            </div>
            <div class="stat-card">
              <div style="font-size:2rem;font-weight:700;color:var(--danger);">${errors.length}</div>
              <div style="font-size:0.8rem;color:var(--text-secondary);">错题数</div>
            </div>
          </div>

          ${errors.length > 0 ? `
            <div style="text-align:left;margin:16px 0;">
              <h4 style="margin-bottom:8px;">本轮错题回顾：</h4>
              ${errors.slice(0, 10).map((e, i) => `
                <div style="padding:8px 12px;background:var(--danger-light);border-radius:6px;margin-bottom:4px;font-size:0.85rem;">
                  <strong>${escapeHtml(e.correctAnswer)}</strong>
                  <span style="color:var(--text-secondary);margin-left:8px;">你答了：${escapeHtml(e.userAnswer)}</span>
                </div>`).join('')}
              ${errors.length > 10 ? `<p style="font-size:0.8rem;color:var(--text-light);">还有 ${errors.length - 10} 道错题...</p>` : ''}
            </div>` : ''}

          <div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin-top:24px;">
            <button class="btn btn-primary btn-lg" onclick="startNewRound()">🔄 开始新一轮</button>
            ${errors.length > 0 ? `<button class="btn btn-danger btn-lg" onclick="reviewErrors()">📖 仅复习错题</button>` : ''}
            <button class="btn btn-ghost" onclick="backToHome()">🏠 回到首页</button>
          </div>
        </div>
      </div>
    </div>
  `;

  updateHeaderStats();
}

function reviewErrors() {
  const errorIds = Object.keys(APP_STATE.errorBook);
  if (errorIds.length === 0) {
    showToast('错题本为空！', 'warning');
    return;
  }

  const errorQuestions = errorIds
    .map(id => QUESTION_BANK.find(q => q.id === id))
    .filter(Boolean);

  if (errorQuestions.length === 0) {
    showToast('无法找到错题数据', 'error');
    return;
  }

  const roundId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  APP_STATE.currentRound = {
    id: roundId,
    startedAt: Date.now(),
    questionPool: errorQuestions.map(q => ({
      ...q,
      weight: APP_STATE.errorBook[q.id] ? APP_STATE.errorBook[q.id].count : 1,
      shownCount: 0,
    })),
    completedQuestions: [],
    errorQuestions: [],
    history: [],
    totalAttempts: 0,
    correctAttempts: 0,
    currentQuestion: null,
    hintLevel: 0,
    isComplete: false,
  };

  APP_STATE.isRoundSetup = true;
  APP_STATE.isAnswerRevealed = false;

  renderRoundScreen();
  showNextQuestion();
  showToast(`错题复习开始！共 ${errorQuestions.length} 道错题`, 'warning');
}

function viewRoundDetail(roundId) {
  const round = APP_STATE.allRounds.find(r => r.id === roundId);
  if (!round) return;

  const accuracy = round.accuracy || 0;
  const trophy = accuracy >= 90 ? '🏆' : accuracy >= 70 ? '🎯' : '📚';

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay active';
  overlay.id = 'roundDetailModal';
  overlay.innerHTML = `
    <div class="modal">
      <button class="modal-close" onclick="closeModal('roundDetailModal')">✕</button>
      <h2>${trophy} 复习轮次详情</h2>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:16px 0;">
        <div style="background:var(--bg);padding:12px;border-radius:8px;">
          <div style="font-size:1.5rem;font-weight:700;color:var(--success);">${accuracy}%</div>
          <div style="font-size:0.8rem;color:var(--text-secondary);">正确率</div>
        </div>
        <div style="background:var(--bg);padding:12px;border-radius:8px;">
          <div style="font-size:1.5rem;font-weight:700;">${round.totalAttempts}</div>
          <div style="font-size:0.8rem;color:var(--text-secondary);">总答题</div>
        </div>
        <div style="background:var(--bg);padding:12px;border-radius:8px;">
          <div style="font-size:1.5rem;font-weight:700;">${round.correctAttempts}</div>
          <div style="font-size:0.8rem;color:var(--text-secondary);">正确题数</div>
        </div>
        <div style="background:var(--bg);padding:12px;border-radius:8px;">
          <div style="font-size:1.5rem;font-weight:700;color:var(--danger);">${round.errorCount}</div>
          <div style="font-size:0.8rem;color:var(--text-secondary);">错题数</div>
        </div>
      </div>
      <p style="font-size:0.85rem;color:var(--text-secondary);">
        开始：${new Date(round.startedAt).toLocaleString()}<br>
        完成：${new Date(round.completedAt).toLocaleString()}
      </p>
      <button class="btn btn-ghost btn-sm" onclick="closeModal('roundDetailModal')">关闭</button>
    </div>
  `;
  document.body.appendChild(overlay);
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function endRound() {
  if (!APP_STATE.isRoundSetup) return;

  const r = APP_STATE.currentRound;
  const remaining = r.questionPool.length;
  const answered = r.completedQuestions.length;

  if (remaining > 0 && answered > 0) {
    if (confirm(`还有 ${remaining} 题未完成（其中可能有做错待复习的题）。确定结束本轮吗？`)) {
      completeRound();
    }
  } else {
    completeRound();
  }
}

function skipQuestion() {
  if (APP_STATE.isAnswerRevealed) return;
  if (!APP_STATE.currentRound.currentQuestion) return;

  const currentQ = APP_STATE.currentRound.currentQuestion;
  const correctAnswer = currentQ.answer || currentQ.texts[0] || '';

  APP_STATE.isAnswerRevealed = true;
  APP_STATE.currentRound.totalAttempts++;

  // Track as wrong
  APP_STATE.currentRound.history.push({
    questionId: currentQ.id,
    userAnswer: '[跳过]',
    correctAnswer: correctAnswer,
    isCorrect: false,
    timestamp: Date.now(),
  });

  // Increase weight
  const pool = APP_STATE.currentRound.questionPool;
  const item = pool.find(q => q.id === currentQ.id);
  if (item) {
    item.weight = Math.min(item.weight + 1.5, 5);
    item.shownCount++;
  }

  // Track in error book
  if (!APP_STATE.errorBook[currentQ.id]) {
    APP_STATE.errorBook[currentQ.id] = { count: 0, rounds: [] };
  }
  APP_STATE.errorBook[currentQ.id].count++;
  if (!APP_STATE.errorBook[currentQ.id].rounds.includes(APP_STATE.currentRound.id)) {
    APP_STATE.errorBook[currentQ.id].rounds.push(APP_STATE.currentRound.id);
  }
  APP_STATE.currentRound.errorQuestions.push({
    ...currentQ,
    correctAnswer: correctAnswer,
    userAnswer: '[跳过]',
  });

  saveState();

  // Show answer
  const inputEl = document.getElementById('answerInput');
  const feedbackEl = document.getElementById('feedback');
  const actionsEl = document.getElementById('responseActions');

  if (inputEl) {
    inputEl.value = correctAnswer;
    inputEl.classList.add('wrong');
  }
  if (actionsEl) actionsEl.style.display = 'flex';

  const kb = getKnowledge(correctAnswer);
  const explanation = kb ? kb.explanation : '';

  feedbackEl.className = 'feedback wrong-fb show';
  feedbackEl.innerHTML = `
    <div class="feedback-header">⏭ 已跳过</div>
    <div class="feedback-body">正确答案：<strong>${escapeHtml(correctAnswer)}</strong>
${escapeHtml(explanation)}</div>
  `;

  updateProgressUI();
  updateErrorBookUI();
}

function nextAfterAnswer() {
  advanceToNext();
}

function backToHome() {
  APP_STATE.isRoundSetup = false;
  APP_STATE.isAnswerRevealed = false;
  renderSetupScreen();
  updateHeaderStats();
}

function clearAllData() {
  if (confirm('确定要清除所有复习记录和错题本吗？此操作不可撤销！')) {
    APP_STATE.errorBook = {};
    APP_STATE.allRounds = [];
    saveState();
    renderSetupScreen();
    updateHeaderStats();
    showToast('所有记录已清除', 'success');
  }
}

// ==================== UI Helpers ====================

function updateProgressUI() {
  const r = APP_STATE.currentRound;
  const total = r.completedQuestions.length + r.questionPool.length;
  const progress = total > 0 ? (r.completedQuestions.length / total) * 100 : 0;

  const fillEl = document.getElementById('progressFill');
  const correctEl = document.getElementById('correctCount');
  const errorEl = document.getElementById('errorInRoundCount');
  const accuracyEl = document.getElementById('accuracyText');
  const remainingEl = document.getElementById('remainingCount');
  const remainingEl2 = document.getElementById('remainingCount2');

  if (fillEl) fillEl.style.width = `${progress}%`;
  if (correctEl) correctEl.textContent = r.completedQuestions.length;
  if (errorEl) errorEl.textContent = r.errorQuestions.length;
  if (remainingEl) remainingEl.textContent = r.questionPool.length;
  if (remainingEl2) remainingEl2.textContent = r.questionPool.length;
  if (accuracyEl) {
    const acc = r.totalAttempts > 0
      ? Math.round((r.correctAttempts / r.totalAttempts) * 100) : 0;
    accuracyEl.textContent = `${acc}%`;
  }
}

function updateErrorBookUI() {
  const el = document.getElementById('errorBookList');
  if (el) {
    el.innerHTML = renderErrorBookList();
  }
}

function renderErrorBookList() {
  const entries = Object.entries(APP_STATE.errorBook)
    .sort((a, b) => b[1].count - a[1].count);

  if (entries.length === 0) {
    return '<div class="empty-state"><div class="icon">✨</div>错题本为空<br><small>继续加油！</small></div>';
  }

  return entries.slice(0, 30).map(([qId, data]) => {
    const question = QUESTION_BANK.find(q => q.id === qId);
    const answer = question ? (question.answer || question.texts[0]) : qId;
    return `
      <div class="error-item">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(answer)}</span>
        <span class="error-count">${data.count}次</span>
      </div>`;
  }).join('')
  + (entries.length > 30 ? `<div style="text-align:center;color:var(--text-light);font-size:0.8rem;">还有 ${entries.length - 30} 条...</div>` : '');
}

function updateHeaderStats() {
  const totalQuestions = QUESTION_BANK.length;
  const errorCount = Object.keys(APP_STATE.errorBook).length;
  const roundCount = APP_STATE.allRounds.length;
  const avgAccuracy = roundCount > 0
    ? Math.round(APP_STATE.allRounds.reduce((s, r) => s + (r.accuracy || 0), 0) / roundCount)
    : 0;

  document.getElementById('headerTotalQ').textContent = totalQuestions;
  document.getElementById('headerErrors').textContent = errorCount;
  document.getElementById('headerRounds').textContent = roundCount;
  document.getElementById('headerAccuracy').textContent = roundCount > 0 ? `${avgAccuracy}%` : '--';
}

// ==================== Image Zoom ====================

function toggleZoom() {
  const container = document.getElementById('imageContainer');
  const overlay = document.getElementById('zoomOverlay');

  if (!container || !overlay) return;

  if (container.classList.contains('zoomed')) {
    closeZoom();
  } else {
    container.classList.add('zoomed');
    overlay.classList.add('active');
  }
}

function closeZoom() {
  const container = document.getElementById('imageContainer');
  const overlay = document.getElementById('zoomOverlay');
  if (container) container.classList.remove('zoomed');
  if (overlay) overlay.classList.remove('active');
}

// ==================== Toast ====================

function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// ==================== Utilities ====================

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeHint();
    closeZoom();

    // Close any open modals
    const modals = document.querySelectorAll('.modal-overlay');
    modals.forEach(m => m.remove());
  }

  // Ctrl+Enter to submit answer
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    if (APP_STATE.isRoundSetup && !APP_STATE.isAnswerRevealed) {
      submitAnswer();
    }
  }

  // 'n' key for next question after answering
  if (e.key === 'n' && APP_STATE.isAnswerRevealed && APP_STATE.isRoundSetup) {
    e.preventDefault();
    nextAfterAnswer();
  }
});

// ==================== Start ====================

document.addEventListener('DOMContentLoaded', initApp);
