import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import postcss from 'postcss';

const css = postcss.parse(readFileSync('src/styles/style.css', 'utf8'));
const html = new JSDOM(readFileSync('index.html', 'utf8')).window.document;
const app = readFileSync('src/app.js', 'utf8');
const shell = css.nodes.find(node => node.type === 'atrule' && node.params === 'stitch-shell');

describe('Stitch layout regression contract', () => {
  it('keeps processing status and pause/cancel on the document surface', () => {
    for (const id of ['progressStage', 'progressText', 'statusText', 'progressPage', 'progress', 'progressAnnouncement', 'pauseButton', 'cancelButton']) {
      expect(html.querySelectorAll(`#${id}`)).toHaveLength(1);
      expect(html.querySelector(`.editor .document-progress #${id}`)).not.toBeNull();
    }
    expect(html.querySelector('#settingsSidebar #extractButton')).not.toBeNull();
  });
  it('leaves a usable document track at the desktop boundary', () => {
    const workspace = shell.nodes.find(node => node.type === 'rule' && node.selector === '.workspace');
    expect(workspace.nodes.find(node => node.prop === 'grid-template-columns').value)
      .toBe('clamp(160px, 15vw, 240px) 280px minmax(0, 1fr) 290px');
    // Sizing-budget assertion, not a substitute for browser layout measurement.
    expect(1200 - 180 - 280 - 290).toBeGreaterThanOrEqual(450);
  });
  it('keeps all styling layered and uses one canonical shell without important overrides', () => {
    expect(css.nodes.filter(node => node.type !== 'comment').every(node => node.type === 'atrule' && node.name === 'layer')).toBe(true);
    expect(shell).toBeTruthy();
    shell.walkDecls(declaration => expect(declaration.important).toBeFalsy());
    expect(css.toString()).not.toContain('@layer stitch-exact-layout');
    expect(css.toString()).not.toContain('@layer stitch-reference-fidelity');
  });
  it('assigns four desktop regions and preserves both panel close controls', () => {
    const workspace = shell.nodes.find(node => node.type === 'rule' && node.selector === '.workspace');
    expect(workspace.nodes.find(node => node.prop === 'grid-template-areas').value).toBe('"rail sidebar editor inspector"');
    expect(html.querySelector('#settingsSidebar #closeSettingsButton')).not.toBeNull();
    expect(html.querySelector('#resultsInspector #closeInspectorButton')).not.toBeNull();
    expect(html.querySelector('.editor #compactActionDock')).not.toBeNull();
    expect(html.querySelector('#dropZone > .drop-affordance').textContent).toBe('Choose PDF');
  });
  for (const [width, mode, closes] of [[360,'compact',0],[699,'compact',0],[700,'medium',0],[1024,'medium',0],[1199,'medium',0],[1200,'wide',2],[1440,'extra-wide',2]]) {
    it(`uses accessible sheet behavior at ${width}px`, () => {
      const body = app.slice(app.indexOf('function syncWorkspaceLayoutState()'), app.indexOf('\nfunction bind()'));
      const document = new JSDOM('<main></main>').window.document;
      Object.defineProperty(document.querySelector('main'), 'clientWidth', {value: width});
      let closed = 0;
      const run = new Function('document','window','closeSettingsSheet','closeInspectorSheet','setSidebarExpanded','setInspectorExpanded','syncSheetAccessibility', `${body}; syncWorkspaceLayoutState();`);
      run(document, {innerWidth: width}, () => closed++, () => closed++, () => {}, () => {}, () => {});
      expect(document.documentElement.dataset.layoutMode).toBe(mode);
      expect(closed).toBe(closes);
    });
  }
});
