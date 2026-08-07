// YTResearchAI Web App — vanilla JS SPA
// Connects to the Express API server via fetch + SSE.

const API = (() => {
  const base = window.__API_URL__ || `${location.protocol}//${location.hostname}:3000`;

  return {
    async submitJob({url, options, apiKey}) {
      const r = await fetch(`${base}/api/jobs`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'X-API-Key': apiKey || ''},
        body: JSON.stringify({url, options}),
      });
      return r.json();
    },

    async getJob(id) {
      const r = await fetch(`${base}/api/jobs/${id}`);
      return r.json();
    },

    streamJob(id, onProgress, onComplete, onError) {
      const es = new EventSource(`${base}/api/jobs/${id}/stream`);
      es.addEventListener('progress', (e) => {
        try { onProgress(JSON.parse(e.data)); } catch {}
      });
      es.addEventListener('complete', (e) => {
        try { onComplete(JSON.parse(e.data)); } catch {}
        es.close();
      });
      es.addEventListener('error', (e) => {
        try { const d = JSON.parse(e.data); onError(d); } catch { onError({message: 'Connection lost'}); }
        es.close();
      });
      es.onerror = () => { onError({message: 'SSE connection failed'}); es.close(); };
      return es;
    },

    async getReport(id) {
      const r = await fetch(`${base}/api/jobs/${id}/report`);
      return r.json();
    },

    async validateKey(apiKey) {
      const r = await fetch(`${base}/api/validate-key`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({apiKey}),
      });
      return r.json();
    },

    async getRecentJobs() {
      try {
        const r = await fetch(`${base}/api/jobs`);
        const data = await r.json();
        return Array.isArray(data) ? data : [];
      } catch { return []; }
    },
  };
})();

// ---- State ----------------------------------------------------------------

const state = {
  apiKey: localStorage.getItem('ytresearch_api_key') || '',
  currentJobId: null,
  eventSource: null,
};

// ---- DOM helpers ----------------------------------------------------------

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const show = (el) => { if (!el) return; el.hidden = false; el.classList.remove('is-hidden'); };
const hide = (el) => { if (!el) return; el.hidden = true; el.classList.add('is-hidden'); };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]
));

const SUBMIT_IDLE = `<span class="btn-sheen" aria-hidden="true"></span><span class="btn-label">Generate</span>
  <svg class="btn-arrow" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SUBMIT_BUSY = `<span class="spinner"></span><span class="btn-label">Working…</span>`;

const setSubmitState = (busy) => {
  const btn = $('#submit-btn');
  if (!btn) return;
  btn.disabled = busy;
  btn.innerHTML = busy ? SUBMIT_BUSY : SUBMIT_IDLE;
  $('#form-section')?.classList.toggle('is-busy', busy);
};

let toastTimer;
const toast = (msg) => {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
};

const setFormMsg = (msg) => {
  const el = $('#form-status');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('show', Boolean(msg));
};

// ---- Markdown rendering (lightweight) --------------------------------------

const DANGEROUS_SCHEMES = /^(javascript|data|vbscript):/i;
const safeUrl = (href) => {
  try {
    const u = new URL(href, location?.origin || 'https://localhost');
    return DANGEROUS_SCHEMES.test(u.protocol) ? '#' : href;
  } catch { return '#'; }
};

const renderMarkdown = (md) => {
  // Escape any raw HTML in the input that isn't part of our markdown processing
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Headings (un-escape our own generated tags)
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold + italic (must handle the escaped markers)
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Links — filter dangerous schemes
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, href) => `<a href="${safeUrl(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`)
    // Images — filter dangerous schemes
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => `<img src="${safeUrl(src)}" alt="${alt}" loading="lazy">`)
    // Horizontal rules
    .replace(/^---$/gm, '<hr>')
    // Blockquotes
    .replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
    // Unordered lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // Ordered lists
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Wrap consecutive <li> in <ul> or <ol>
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

  // Paragraphs: wrap lines that aren't already HTML tags
  const lines = html.split('\n');
  const out = [];
  let inCodeBlock = false, codeBlock = '', codeLang = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        out.push(`<pre><code class="language-${codeLang}">${codeBlock.trim()}</code></pre>`);
        codeBlock = ''; codeLang = '';
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }
    if (inCodeBlock) { codeBlock += line + '\n'; continue; }

    // Skip lines that are already HTML tags or empty
    if (/^<\/?[a-z]/.test(line.trim()) || line.trim() === '') {
      out.push(line);
    } else {
      out.push(`<p>${line}</p>`);
    }
  }
  if (inCodeBlock) out.push(`<pre><code>${codeBlock.trim()}</code></pre>`);

  return out.join('\n');
};

// ---- Ambient UI (reveal, counters, spotlight, nav) --------------------------

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const initAmbientUI = () => {
  // Scroll-triggered reveals
  const reveals = $$('.reveal');
  if (reduceMotion || !('IntersectionObserver' in window)) {
    reveals.forEach((el) => el.classList.add('in'));
  } else {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        io.unobserve(e.target);
      });
    }, {threshold: .12, rootMargin: '0px 0px -60px 0px'});
    reveals.forEach((el) => io.observe(el));
  }

  // Count-up stats
  const counters = $$('.stat em[data-count]');
  const runCount = (el) => {
    const target = Number(el.dataset.count || 0);
    const prefix = el.dataset.prefix || '';
    const suffix = el.dataset.suffix || '';
    const fmt = (n) => `${prefix}${Math.round(n).toLocaleString('en-US')}${suffix}`;
    if (reduceMotion || !target) { el.textContent = fmt(target); return; }
    const dur = 1400, t0 = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      el.textContent = fmt(target * (1 - Math.pow(1 - p, 4)));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  if ('IntersectionObserver' in window) {
    const co = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { runCount(e.target); co.unobserve(e.target); } });
    }, {threshold: .5});
    counters.forEach((el) => co.observe(el));
  } else {
    counters.forEach(runCount);
  }

  // Cursor spotlight on feature cards
  if (!reduceMotion && window.matchMedia('(hover: hover)').matches) {
    $$('.f-card').forEach((card) => {
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${e.clientX - r.left}px`);
        card.style.setProperty('--my', `${e.clientY - r.top}px`);
      });
    });
  }

  // Nav condenses on scroll
  const nav = $('#nav');
  const onScroll = () => nav?.classList.toggle('scrolled', window.scrollY > 16);
  window.addEventListener('scroll', onScroll, {passive: true});
  onScroll();

  // CTA jumps back to the console
  $('#cta-btn')?.addEventListener('click', () => {
    $('#form-section')?.scrollIntoView({behavior: reduceMotion ? 'auto' : 'smooth', block: 'center'});
    setTimeout(() => $('#url-input')?.focus(), reduceMotion ? 0 : 500);
  });

  // ⌘K / Ctrl+K focuses the URL field
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      $('#url-input')?.focus();
      $('#url-input')?.select();
    }
  });
};

// Segmented citation-style control, mirrored into the hidden <select>
const initSegmented = () => {
  const seg = $('#style-seg');
  const select = $('#opt-style');
  if (!seg || !select) return;
  const glider = seg.querySelector('.seg-glider');
  const buttons = Array.from(seg.querySelectorAll('.seg-btn'));

  const moveGlider = () => {
    const active = seg.querySelector('.seg-btn.is-active');
    if (!active || !glider) return;
    glider.style.setProperty('--seg-w', `${active.offsetWidth}px`);
    glider.style.setProperty('--seg-x', `${active.offsetLeft - 3}px`);
  };

  buttons.forEach((btn) => btn.addEventListener('click', () => {
    buttons.forEach((b) => b.classList.toggle('is-active', b === btn));
    select.value = btn.dataset.value;
    moveGlider();
  }));

  // Options panel starts collapsed, so measure once it has a layout box
  new ResizeObserver(moveGlider).observe(seg);
  moveGlider();
};

// ---- App logic ------------------------------------------------------------

const init = async () => {
  const apiInput = $('#api-key-input');
  const urlInput = $('#url-input');
  const submitBtn = $('#submit-btn');
  const optionsToggle = $('#options-toggle');
  const optionsRow = $('#options-row');
  const keyHint = $('#key-hint');

  // Restore saved API key
  if (state.apiKey) {
    apiInput.value = state.apiKey;
    keyHint.textContent = '🔑 Saved key';
  }

  // Validate key on input
  let keyTimeout;
  apiInput.addEventListener('input', () => {
    clearTimeout(keyTimeout);
    keyTimeout = setTimeout(async () => {
      const key = apiInput.value.trim();
      if (!key || key.length < 10) { keyHint.textContent = ''; return; }
      if (key === state.apiKey) { keyHint.textContent = '🔑 Saved key'; return; }
      keyHint.textContent = '⏳ Validating…';
      const v = await API.validateKey(key);
      if (v.valid) {
        state.apiKey = key;
        localStorage.setItem('ytresearch_api_key', key);
        keyHint.textContent = `✅ Valid (${v.provider})`;
      } else {
        keyHint.textContent = '❌ Invalid key';
      }
    }, 800);
  });

  // Options toggle
  optionsToggle.addEventListener('click', () => {
    const open = optionsRow.classList.toggle('open');
    optionsToggle.setAttribute('aria-expanded', String(open));
    optionsToggle.querySelector('.opt-toggle-label').textContent = open ? 'Hide options' : 'Options';
  });

  // Submit
  const doSubmit = async () => {
    const url = urlInput.value.trim();
    if (!url) { urlInput.focus(); toast('Paste a video URL first'); return; }

    const options = {
      research: $('#opt-research').checked,
      verify: $('#opt-verify').checked,
      vision: $('#opt-vision').checked,
      audioOnly: $('#opt-audio').checked,
      'citation-style': $('#opt-style').value,
      'reasoning-effort': 'medium',
      verbosity: 'medium',
    };

    setSubmitState(true);
    hide($('#report-section'));
    hide($('#error-section'));
    show($('#progress-section'));
    setProgress({stage: 'Submitting…', progress: 0, message: 'Sending job to server…'});

    try {
      const key = state.apiKey || undefined;
      const r = await API.submitJob({url, options, apiKey: key});

      if (r.error) {
        if (r.freeTier) {
          const ft = r.freeTier;
          setFormMsg(`Free tier: ${ft.remaining}/${ft.limit} reports remaining today (resets at midnight UTC). Add your API key above for unlimited runs.`);
        } else {
          showError(r.error);
        }
        setSubmitState(false);
        hide($('#progress-section'));
        return;
      }

      state.currentJobId = r.jobId;
      setFormMsg('');
      streamProgress(r.jobId);
    } catch (err) {
      showError(err.message || 'Failed to submit job');
      setSubmitState(false);
      hide($('#progress-section'));
    }
  };

  submitBtn.addEventListener('click', doSubmit);
  urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSubmit(); });

  // Load recent jobs
  loadRecentJobs();

  // New report button
  $('#new-report-btn').addEventListener('click', resetForm);
  $('#retry-btn').addEventListener('click', resetForm);
};

const setProgress = ({stage, progress, message}) => {
  const pct = Math.max(0, Math.min(100, Number(progress) || 0));
  $('#progress-stage').textContent = stage || 'Processing…';
  $('#progress-pct').textContent = `${Math.round(pct)}%`;
  $('#progress-bar').style.width = `${pct}%`;
  if (message !== undefined) $('#progress-msg').textContent = message || '';

  // Light up the stage markers
  const steps = $$('#prog-steps li');
  const nextIdx = steps.findIndex((li) => pct < Number(li.dataset.at));
  steps.forEach((li, i) => {
    li.classList.toggle('done', pct >= Number(li.dataset.at));
    li.classList.toggle('active', i === nextIdx);
  });
};

const streamProgress = (jobId) => {
  if (state.eventSource) state.eventSource.close();

  state.eventSource = API.streamJob(jobId,
    (data) => {
      setProgress({
        stage: data.stage || data.message || 'Processing…',
        progress: data.progress || 0,
        message: data.message,
      });
    },
    (data) => {
      setProgress({stage: 'Complete', progress: 100, message: 'Report ready.'});
      setTimeout(() => hide($('#progress-section')), 450);
      setSubmitState(false);
      showReport(data.result);
    },
    (data) => {
      showError(data.message || 'Job failed');
      setSubmitState(false);
      hide($('#progress-section'));
    },
  );
};

const showReport = (result) => {
  show($('#report-section'));
  const refCount = result.references?.length || 0;
  const domain = result.methodology?.domain || 'General';
  $('#report-meta').innerHTML = `
    <span class="meta-title">${esc(result.title || 'Research Report')}</span>
    <span class="tag">${refCount} sources</span>
    <span class="tag">${esc(domain)}</span>
    <span class="tag">${esc(result.methodology?.citationStyle || 'cited')}</span>`;

  $('#report-content').innerHTML = renderMarkdown(result.reportMarkdown || '');
  $('#report-section').scrollIntoView({behavior: reduceMotion ? 'auto' : 'smooth', block: 'start'});

  // Download + share actions
  const stem = slugify(result.title || 'report');
  $('#download-md').onclick = () => downloadFile(`${stem}.md`, result.reportMarkdown || '', 'text/markdown');
  $('#download-json').onclick = () => downloadFile(`${stem}.json`, JSON.stringify(result, null, 2), 'application/json');

  const copyBtn = $('#copy-link');
  const copyLabel = copyBtn.innerHTML;
  copyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}${location.pathname}?job=${state.currentJobId}`);
      copyBtn.classList.add('done');
      copyBtn.textContent = 'Copied';
      toast('Share link copied to clipboard');
      setTimeout(() => { copyBtn.classList.remove('done'); copyBtn.innerHTML = copyLabel; }, 2000);
    } catch {
      toast('Could not copy — check clipboard permissions');
    }
  };

  loadRecentJobs();
};

const showError = (msg) => {
  hide($('#progress-section'));
  show($('#error-section'));
  $('#error-msg').textContent = msg;
  $('#error-section').scrollIntoView({behavior: reduceMotion ? 'auto' : 'smooth', block: 'center'});
};

const resetForm = () => {
  hide($('#report-section'));
  hide($('#error-section'));
  hide($('#progress-section'));
  show($('#form-section'));
  $('#url-input').value = '';
  setSubmitState(false);
  setFormMsg('');
  $('#url-input').focus();
  if (state.eventSource) { state.eventSource.close(); state.eventSource = null; }
  // Clear share link from URL
  if (location.search.includes('job=')) {
    history.replaceState(null, '', location.pathname);
  }
  loadRecentJobs();
};

const loadRecentJobs = async () => {
  const section = $('#recent-section');
  const list = $('#recent-list');
  if (!section || !list) return;

  const jobs = await API.getRecentJobs();
  if (!jobs.length) { hide(section); return; }
  show(section);

  list.innerHTML = jobs.slice(0, 6).map((j) => {
    const status = j.status === 'complete' ? 'complete' : j.status === 'failed' ? 'failed' : 'running';
    const label = j.status === 'complete' ? `${j.result?.references?.length || 0} refs`
      : j.status === 'failed' ? 'failed'
      : (j.stage || 'queued');
    const url = (j.url || '').replace(/^https?:\/\/(www\.)?/, '').slice(0, 70);
    return `<div class="recent-item">
      <span class="status-dot status-${status}"></span>
      <span class="recent-url">${esc(url)}</span>
      <span class="recent-state">${esc(label)}</span>
    </div>`;
  }).join('');
};

const downloadFile = (filename, content, mime) => {
  const blob = new Blob([content], {type: mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
  toast(`Downloaded ${filename}`);
};

const slugify = (s) => (s || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

// Share link: load job from ?job=ID parameter
const loadSharedJob = async () => {
  const params = new URLSearchParams(location.search);
  const jobId = params.get('job');
  if (!jobId) return;

  show($('#progress-section'));
  setProgress({stage: 'Loading shared report…', progress: 0, message: `Job: ${jobId}`});

  try {
    const job = await API.getJob(jobId);
    if (job.error) { hide($('#progress-section')); showError('Report not found. It may have expired or the link is invalid.'); return; }

    if (job.status === 'complete' && job.result) {
      hide($('#progress-section'));
      showReport(job.result);
      // Show the source URL so the visitor can see where it came from
      $('#url-input').value = job.url || '';
      return;
    }

    if (job.status === 'failed') {
      showError(`This report failed: ${job.error || 'Unknown error'}`);
      return;
    }

    // Job still running — stream progress
    state.currentJobId = jobId;
    setSubmitState(true);
    streamProgress(jobId);
  } catch {
    showError('Could not load the shared report. The link may have expired.');
  }
};

// Boot — paint the page first, then resolve any ?job= share link
initAmbientUI();
initSegmented();
loadSharedJob().then(() => init());
