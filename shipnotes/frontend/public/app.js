const API = window.API_URL || '';

const chipsEl = document.getElementById('chips');
const form = document.getElementById('repo-form');
const input = document.getElementById('repo-input');
const genBtn = document.getElementById('generate-btn');
const statusArea = document.getElementById('status-area');
const resultArea = document.getElementById('result-area');
const historyList = document.getElementById('history-list');

const STEPS = ['queued', 'fetching', 'categorizing', 'done'];

async function loadPresets() {
  try {
    const res = await fetch(`${API}/api/presets`);
    const presets = await res.json();
    chipsEl.innerHTML = '';
    presets.forEach((p) => {
      const chip = document.createElement('div');
      chip.className = 'chip';
      chip.textContent = p.label;
      chip.onclick = () => {
        input.value = `${p.owner}/${p.name}`;
        form.requestSubmit();
      };
      chipsEl.appendChild(chip);
    });
  } catch (err) {
    console.error('Failed to load presets', err);
  }
}

async function loadHistory() {
  try {
    const res = await fetch(`${API}/api/jobs`);
    const jobs = await res.json();
    historyList.innerHTML = '';
    jobs.forEach((j) => {
      const item = document.createElement('div');
      item.className = 'history-item';
      item.innerHTML = `<span>${j.repo_owner}/${j.repo_name}</span><span>${j.status}</span>`;
      item.onclick = () => pollJob(j.id, true);
      historyList.appendChild(item);
    });
  } catch (err) {
    console.error('Failed to load history', err);
  }
}

function setStep(status) {
  statusArea.classList.remove('hidden');
  const idx = STEPS.indexOf(status === 'error' ? 'categorizing' : status);
  document.querySelectorAll('.step').forEach((el) => {
    const stepIdx = STEPS.indexOf(el.dataset.step);
    el.classList.remove('active', 'complete', 'error');
    if (status === 'error' && stepIdx === idx) {
      el.classList.add('error');
    } else if (stepIdx < idx) {
      el.classList.add('complete');
    } else if (stepIdx === idx) {
      el.classList.add('active');
    }
  });
}

function renderResult(job) {
  resultArea.classList.remove('hidden');
  document.getElementById('result-title').textContent = `${job.repo_owner}/${job.repo_name}`;
  document.getElementById('announcement').textContent = job.announcement || '';

  const changelog = typeof job.changelog === 'string' ? JSON.parse(job.changelog) : job.changelog || {};
  fillList('list-features', changelog.features);
  fillList('list-fixes', changelog.fixes);
  fillList('list-breaking', changelog.breaking);

  document.getElementById('copy-btn').onclick = () => {
    const text = formatChangelogText(job, changelog);
    navigator.clipboard.writeText(text);
  };
}

function fillList(id, items) {
  const el = document.getElementById(id);
  el.innerHTML = '';
  (items || []).forEach((text, i) => {
    const li = document.createElement('li');
    li.textContent = text;
    li.style.opacity = '0';
    li.style.transform = 'translateY(4px)';
    li.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    el.appendChild(li);
    setTimeout(() => {
      li.style.opacity = '1';
      li.style.transform = 'translateY(0)';
    }, 40 * i);
  });
  if (!items || !items.length) {
    const li = document.createElement('li');
    li.textContent = 'None';
    el.appendChild(li);
  }
}

function formatChangelogText(job, changelog) {
  const lines = [`# ${job.repo_owner}/${job.repo_name}`, '', job.announcement || '', ''];
  const section = (title, items) => {
    if (!items || !items.length) return;
    lines.push(`## ${title}`);
    items.forEach((i) => lines.push(`- ${i}`));
    lines.push('');
  };
  section('Features', changelog.features);
  section('Fixes', changelog.fixes);
  section('Breaking changes', changelog.breaking);
  return lines.join('\n');
}

let pollTimer = null;

async function pollJob(id, skipStatusReset) {
  if (pollTimer) clearInterval(pollTimer);
  if (!skipStatusReset) {
    resultArea.classList.add('hidden');
    setStep('queued');
  }

  const tick = async () => {
    try {
      const res = await fetch(`${API}/api/jobs/${id}`);
      const job = await res.json();
      setStep(job.status);
      if (job.status === 'done') {
        clearInterval(pollTimer);
        renderResult(job);
        genBtn.disabled = false;
        loadHistory();
      } else if (job.status === 'error') {
        clearInterval(pollTimer);
        genBtn.disabled = false;
      }
    } catch (err) {
      console.error('Poll failed', err);
    }
  };

  await tick();
  pollTimer = setInterval(tick, 1500);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const repo = input.value.trim();
  if (!repo) return;

  genBtn.disabled = true;
  resultArea.classList.add('hidden');

  try {
    const res = await fetch(`${API}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Something went wrong.');
      genBtn.disabled = false;
      return;
    }
    pollJob(data.id);
  } catch (err) {
    console.error(err);
    genBtn.disabled = false;
  }
});

loadPresets();
loadHistory();
