const input = document.getElementById('pdfInput');
const button = document.getElementById('inspectButton');
const log = document.getElementById('log');

button.addEventListener('click', async () => {
  const file = input.files[0];

  if (!file) {
    log.textContent = 'Select a PDF first.';
    return;
  }

  log.textContent = [
    `File: ${file.name}`,
    `Size: ${file.size} bytes`,
    '',
    'Browser edition scaffold is working.',
    'PDF parsing and semantic extraction modules will be added incrementally.'
  ].join('\n');
});
