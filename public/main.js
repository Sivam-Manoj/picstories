const form = document.getElementById('bookForm');
const statusCard = document.getElementById('statusCard');
const statusEl = document.getElementById('status');
const resultCard = document.getElementById('resultCard');
const resultInfo = document.getElementById('resultInfo');
const downloadLink = document.getElementById('downloadLink');
const downloadBtn = document.getElementById('downloadBtn');
const recentList = document.getElementById('recentList');
const startReviewBtn = document.getElementById('startReviewBtn');
const generateBtn = document.getElementById('generateBtn');
const enableEnhancer = document.getElementById('enableEnhancer');
const enhanceThemeBtn = document.getElementById('enhanceThemeBtn');
const loader = document.getElementById('loader');

// Review UI elements
const reviewCard = document.getElementById('reviewCard');
const reviewMeta = document.getElementById('reviewMeta');
const reviewPages = document.getElementById('reviewPages');
const reviewPrompt = document.getElementById('reviewPrompt');
const reviewImage = document.getElementById('reviewImage');
const reviewSavePromptBtn = document.getElementById('reviewSavePromptBtn');
const reviewGenerateBtn = document.getElementById('reviewGenerateBtn');
const reviewConfirmBtn = document.getElementById('reviewConfirmBtn');
const replaceFile = document.getElementById('replaceFile');
const replaceUploadBtn = document.getElementById('replaceUploadBtn');
const reviewPrevBtn = document.getElementById('reviewPrevBtn');
const reviewNextBtn = document.getElementById('reviewNextBtn');
const reviewFinalizeBtn = document.getElementById('reviewFinalizeBtn');

// Review state
let reviewSessionId = null;
let reviewState = null;
let currentIndex = 0; // 0 = cover, 1..N interior

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('title').value.trim();
  let prompt = document.getElementById('prompt').value.trim();
  const pageCount = Number(document.getElementById('pageCount').value);

  // Advanced planning options
  const options = {
    storyMode: document.getElementById('storyMode')?.checked,
    allowCaptions: document.getElementById('allowCaptions')?.checked,
    ageRange: document.getElementById('ageRange')?.value?.trim(),
    difficulty: document.getElementById('difficulty')?.value || undefined,
    styleHints: document.getElementById('styleHints')?.value?.trim(),
    focusCharacters: document.getElementById('focusCharacters')?.value?.trim(),
    avoidList: document.getElementById('avoidList')?.value?.trim(),
  };
  // Remove empty string fields
  Object.keys(options).forEach((k) => {
    if (options[k] === '' || options[k] === undefined) delete options[k];
  });


  resultCard.hidden = true;

  try {
    // Auto-enhance theme prompt if enabled
    if (enableEnhancer?.checked) {
      await withBtnSpinner(generateBtn, async () => {
        const enhanced = await enhanceApi(prompt, 'theme');
        if (enhanced) {
          prompt = enhanced;
          document.getElementById('prompt').value = enhanced;
        }
      });
    }
    // Now show global status for generation
    statusCard.hidden = false;
    statusEl.textContent = 'Creating plan...';
    const res = await fetch('/api/coloring-book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, prompt, pageCount, options })
    });

    if (!res.ok) {
      const msg = await safeText(res);
      throw new Error(`Failed to create book: ${res.status} ${msg}`);
    }

    const data = await res.json();
    const id = data.id;

    statusEl.textContent = 'Ready! You can download your PDF.';
    resultInfo.textContent = `Created book "${title}" with ${pageCount} interior pages (+ cover).`;

    const pdfUrl = `/api/coloring-book/${id}/download`;
    downloadLink.href = pdfUrl;
    downloadLink.setAttribute('download', `${sanitizeFileName(title)}.pdf`);

    resultCard.hidden = false;

    downloadBtn.onclick = async () => {
      try {
        const resp = await fetch(pdfUrl);
        if (!resp.ok) throw new Error('Failed to fetch PDF');
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${sanitizeFileName(title)}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        alert(err.message || 'Download failed');
      }
    };

    // Refresh recent list
    await loadRecentBooks();
  } catch (err) {
    console.error(err);
    alert(err.message || 'Something went wrong');
  } finally {
    statusCard.hidden = true;
  }
});

// Register Enhance Theme button on page load (not inside submit handler)
enhanceThemeBtn?.addEventListener('click', async () => {
  const textarea = document.getElementById('prompt');
  const text = (textarea.value || '').trim();
  if (!text) return alert('Enter a theme prompt to enhance');
  await withBtnSpinner(enhanceThemeBtn, async () => {
    const enhanced = await enhanceApi(text, 'theme');
    if (enhanced) textarea.value = enhanced;
  });
});

const reviewEnhanceBtn = document.getElementById('reviewEnhanceBtn');
reviewEnhanceBtn?.addEventListener('click', async () => {
  if (!reviewSessionId) return;
  const kind = currentIndex === 0 ? 'cover' : 'interior';
  const text = (reviewPrompt.value || '').trim();
  if (!text) return alert('Prompt is empty');
  await withBtnSpinner(reviewEnhanceBtn, async () => {
    const enhanced = await enhanceApi(text, kind);
    if (!enhanced) return;
    reviewPrompt.value = enhanced;
    // Auto-save enhanced prompt
    const res = await fetch(`/api/coloring-book/sessions/${reviewSessionId}/pages/${currentIndex}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: enhanced })
    });
    if (!res.ok) throw new Error(await safeText(res));
    const data = await res.json();
    reviewState = data.session;
    renderReview();
  });
});

startReviewBtn?.addEventListener('click', async () => {
  let { title, prompt, pageCount, options } = getFormValues();
  if (!title || !prompt || !pageCount) return alert('Please fill Title, Theme Prompt and Page Count');

  // During enhancement, use inline spinner only
  try {
    if (enableEnhancer?.checked) {
      await withBtnSpinner(startReviewBtn, async () => {
        const enhanced = await enhanceApi(prompt, 'theme');
        if (enhanced) {
          prompt = enhanced;
          document.getElementById('prompt').value = enhanced;
        }
      });
    }
    // Show global status for planning request
    statusCard.hidden = false;
    statusEl.textContent = 'Planning review session...';
    const res = await fetch('/api/coloring-book/sessions/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, prompt, pageCount, options })
    });
    if (!res.ok) throw new Error(await safeText(res));
    const data = await res.json();
    const session = data.session;
    reviewSessionId = session.id;
    reviewState = session;
    currentIndex = 0;
    reviewCard.hidden = false;
    renderReview();
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  } catch (err) {
    alert(err.message || 'Failed to start review session');
  } finally {
    statusCard.hidden = true;
  }
});

reviewPages?.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-idx]');
  if (!a) return;
  e.preventDefault();
  currentIndex = Number(a.getAttribute('data-idx'));
  renderReview();
});

reviewSavePromptBtn?.addEventListener('click', async () => {
  if (!reviewSessionId) return;
  const prompt = (reviewPrompt.value || '').trim();
  if (!prompt) return alert('Prompt is empty');
  statusCard.hidden = false;
  statusEl.textContent = 'Saving prompt...';
  try {
    const res = await fetch(`/api/coloring-book/sessions/${reviewSessionId}/pages/${currentIndex}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    if (!res.ok) throw new Error(await safeText(res));
    const data = await res.json();
    reviewState = data.session;
    renderReview();
  } catch (err) {
    alert(err.message || 'Failed to save prompt');
  } finally {
    statusCard.hidden = true;
  }
});

reviewGenerateBtn?.addEventListener('click', async () => {
  if (!reviewSessionId) return;
  statusCard.hidden = false;
  statusEl.textContent = `Generating image for page ${currentIndex === 0 ? 'Cover' : currentIndex}...`;
  try {
    const res = await fetch(`/api/coloring-book/sessions/${reviewSessionId}/pages/${currentIndex}/generate`, { method: 'POST' });
    if (!res.ok) throw new Error(await safeText(res));
    const data = await res.json();
    reviewState = data.session;
    renderReview();
  } catch (err) {
    alert(err.message || 'Failed to generate image');
  } finally {
    statusCard.hidden = true;
  }
});

reviewConfirmBtn?.addEventListener('click', async () => {
  if (!reviewSessionId) return;
  const page = getPageFromState(reviewState, currentIndex);
  const nextVal = !page.confirmed;
  statusCard.hidden = false;
  statusEl.textContent = `${nextVal ? 'Confirming' : 'Unconfirming'} page...`;
  try {
    const res = await fetch(`/api/coloring-book/sessions/${reviewSessionId}/pages/${currentIndex}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmed: nextVal })
    });
    if (!res.ok) throw new Error(await safeText(res));
    const data = await res.json();
    reviewState = data.session;
    renderReview();
  } catch (err) {
    alert(err.message || 'Failed to confirm');
  } finally {
    statusCard.hidden = true;
  }
});

replaceUploadBtn?.addEventListener('click', async () => {
  if (!reviewSessionId) return;
  const file = replaceFile.files?.[0];
  if (!file) return alert('Choose an image file');
  const dataUrl = await fileToDataURL(file);
  statusCard.hidden = false;
  statusEl.textContent = 'Uploading replacement...';
  try {
    const res = await fetch(`/api/coloring-book/sessions/${reviewSessionId}/pages/${currentIndex}/replace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl })
    });
    if (!res.ok) throw new Error(await safeText(res));
    const data = await res.json();
    reviewState = data.session;
    renderReview();
  } catch (err) {
    alert(err.message || 'Failed to replace image');
  } finally {
    statusCard.hidden = true;
  }
});

reviewPrevBtn?.addEventListener('click', () => {
  if (currentIndex > 0) { currentIndex--; renderReview(); }
});
reviewNextBtn?.addEventListener('click', () => {
  const total = 1 + (reviewState?.pageCount || 0);
  if (currentIndex < total - 1) { currentIndex++; renderReview(); }
});

reviewFinalizeBtn?.addEventListener('click', async () => {
  if (!reviewSessionId) return;
  statusCard.hidden = false;
  statusEl.textContent = 'Finalizing book...';
  try {
    const res = await fetch(`/api/coloring-book/sessions/${reviewSessionId}/finalize`, { method: 'POST' });
    const txt = await safeText(res);
    if (!res.ok) throw new Error(txt || 'Failed to finalize');
    const data = JSON.parse(txt);
    const id = data.id;
    const title = reviewState?.title || 'book';
    const pdfUrl = `/api/coloring-book/${id}/download`;
    resultInfo.textContent = `Created book "${title}".`;
    downloadLink.href = pdfUrl;
    downloadLink.setAttribute('download', `${sanitizeFileName(title)}.pdf`);
    resultCard.hidden = false;
    await loadRecentBooks();
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  } catch (err) {
    try { const j = JSON.parse(err.message); alert(j.error || err.message); } catch { alert(err.message || 'Failed to finalize'); }
  } finally {
    statusCard.hidden = true;
  }
});

async function loadRecentBooks() {
  if (!recentList) return;
  recentList.innerHTML = '<li class="hint">Loading...</li>';
  try {
    const res = await fetch('/api/coloring-book');
    if (!res.ok) throw new Error('Failed to load recent books');
    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) {
      recentList.innerHTML = '<li class="hint">No books yet. Generate one above!</li>';
      return;
    }
    recentList.innerHTML = '';
    for (const it of items) {
      const li = document.createElement('li');
      const dt = it.createdAt ? new Date(it.createdAt) : null;
      const when = dt ? dt.toLocaleString() : '';
      const href = `/api/coloring-book/${it.id}/download`;
      li.innerHTML = `
        <div class="row" style="gap:6px;">
          <strong>${escapeHtml(it.title)}</strong>
          <span class="hint">${it.pageCount} interior pages • ${when}</span>
          <div class="actions">
            <a class="btn" href="${href}">Download</a>
          </div>
        </div>
      `;
      recentList.appendChild(li);
    }
  } catch (err) {
    recentList.innerHTML = `<li class="hint">${escapeHtml(err.message || 'Failed to load')}</li>`;
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9_-]+/g, '_');
}

async function safeText(res) {
  try { return await res.text(); } catch { return ''; }
}

// Load recent on startup
loadRecentBooks();

// Helpers
function getFormValues() {
  const title = document.getElementById('title').value.trim();
  const prompt = document.getElementById('prompt').value.trim();
  const pageCount = Number(document.getElementById('pageCount').value);
  const options = {
    storyMode: document.getElementById('storyMode')?.checked,
    allowCaptions: document.getElementById('allowCaptions')?.checked,
    ageRange: document.getElementById('ageRange')?.value?.trim(),
    difficulty: document.getElementById('difficulty')?.value || undefined,
    styleHints: document.getElementById('styleHints')?.value?.trim(),
    focusCharacters: document.getElementById('focusCharacters')?.value?.trim(),
    avoidList: document.getElementById('avoidList')?.value?.trim(),
  };
  Object.keys(options).forEach((k) => { if (options[k] === '' || options[k] === undefined) delete options[k]; });
  return { title, prompt, pageCount, options };
}

function getPageFromState(state, idx) {
  return idx === 0 ? state.cover : state.items[idx - 1];
}

function renderReview() {
  if (!reviewState) return;
  const total = 1 + (reviewState.pageCount || 0);
  reviewMeta.textContent = `${reviewState.title} — ${total} pages (cover + ${reviewState.pageCount} interiors)`;
  // Render list
  reviewPages.innerHTML = '';
  for (let i = 0; i < total; i++) {
    const page = getPageFromState(reviewState, i);
    const li = document.createElement('li');
    const label = i === 0 ? 'Cover' : `Page ${i}`;
    const status = page.confirmed ? ' • confirmed' : (page.imageUrl ? ' • draft' : '');
    li.innerHTML = `<a href="#" data-idx="${i}">${label}${status}</a>`;
    if (i === currentIndex) li.style.fontWeight = 'bold';
    reviewPages.appendChild(li);
  }
  // Render main
  const cur = getPageFromState(reviewState, currentIndex);
  reviewPrompt.value = cur.prompt || '';
  if (cur.imageUrl) {
    reviewImage.src = cur.imageUrl;
    reviewImage.style.display = '';
  } else {
    reviewImage.removeAttribute('src');
    reviewImage.style.display = 'none';
  }
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function enhanceApi(text, kind) {
  const res = await fetch('/api/coloring-book/enhance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, kind })
  });
  if (!res.ok) throw new Error(await safeText(res));
  const data = await res.json();
  return data.enhanced;
}

// Utility: show a small spinner inside a button and disable it while running
async function withBtnSpinner(btn, fn) {
  if (!btn) return await fn();
  const spinner = document.createElement('span');
  spinner.className = 'btn-spinner';
  try {
    btn.disabled = true;
    btn.appendChild(spinner);
    return await fn();
  } finally {
    try { btn.removeChild(spinner); } catch {}
    btn.disabled = false;
  }
}
