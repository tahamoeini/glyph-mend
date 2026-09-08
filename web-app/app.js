const state = { pdf: null, markdown: '', db: null };
const $ = (id) => document.getElementById(id);

async function openWorkspace() {
  state.db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('pdf-sanitizer-browser', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('documents');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveCheckpoint(key, value) {
  if (!state.db) return;
  const tx = state.db.transaction('documents', 'readwrite');
  tx.objectStore('documents').put(value, key);
}

function sanitizeMarkdown(text) {
  return text
    .replace(/<br\s*\/?>(\s*)/gi, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function loadPdf(file) {
  const buffer = await file.arrayBuffer();
  state.pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  $('log').textContent = `Loaded ${state.pdf.numPages} pages`;
}

async function extractPdf() {
  if (!state.pdf) return;

  state.markdown = '';
  for (let i = 1; i <= state.pdf.numPages; i++) {
    const page = await state.pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map(item => item.str).join(' ');
    const markdown = `<!-- page: ${i} -->\n\n${sanitizeMarkdown(text)}\n`;

    state.markdown += markdown + '\n';
    await saveCheckpoint(`page-${i}`, markdown);

    $('progress').value = (i / state.pdf.numPages) * 100;
    $('log').textContent = `Processed ${i}/${state.pdf.numPages}`;
  }

  $('output').value = state.markdown;
}

function downloadMarkdown() {
  const blob = new Blob([state.markdown], { type: 'text/markdown' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'output.md';
  link.click();
}

window.addEventListener('load', async () => {
  await openWorkspace();
  $('pdfInput').addEventListener('change', e => loadPdf(e.target.files[0]));
  $('extractButton').onclick = extractPdf;
  $('downloadButton').onclick = downloadMarkdown;
});
