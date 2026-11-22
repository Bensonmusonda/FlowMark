/**
 * Automated tests for Phase 3: Tabs + Session Model
 */

import { Document, TabManager } from './src/model/document.js';
import SessionManager from './src/session/sessionManager.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.error(`  ❌ ${message}`);
  }
}

// ── Document tests ────────────────────────────────────────────────────────────

console.log('\n📄 Document Model Tests:');

{
  const doc = new Document({ name: 'test.md', dirty: false });
  assert(doc.name === 'test.md', 'Sets custom name');
  assert(!doc.dirty, 'Initial dirty state is false');
  doc.markDirty(true);
  assert(doc.dirty === true, 'markDirty(true) marks dirty');
  doc.markDirty(false);
  assert(doc.dirty === false, 'markDirty(false) marks clean');
}

{
  const doc = new Document({ path: 'C:\\docs\\notes.md' });
  assert(doc.name === 'notes.md', 'Extracts filename from Windows path');
  assert(doc.path === 'C:\\docs\\notes.md', 'Preserves full path');
  doc.setPath('D:/other/project.md');
  assert(doc.name === 'project.md', 'setPath updates name for posix path');
}

{
  const mockState = { doc: { toString: () => 'Hello World' } };
  const doc = new Document({ editorState: mockState });
  assert(doc.getText() === 'Hello World', 'getText() extracts string from editorState');
  assert(doc.getState() === mockState, 'getState() returns editorState');
}

{
  const doc = new Document({ path: 'C:/file.md' });
  let savedPath = null;
  let savedContent = null;
  const mockFileAPI = {
    save: async ({ filePath, content }) => {
      savedPath = filePath;
      savedContent = content;
      return { filePath };
    },
  };
  doc.markDirty(true);
  await doc.save(mockFileAPI);
  assert(savedPath === 'C:/file.md', 'save() uses document path');
  assert(!doc.dirty, 'save() clears dirty flag on success');
}

{
  const doc = new Document({ name: 'Untitled.md' });
  let saveAsCalled = false;
  const mockFileAPI = {
    saveAs: async ({ defaultPath, content }) => {
      saveAsCalled = true;
      return { canceled: false, filePath: 'C:/saved/new.md' };
    },
  };
  doc.markDirty(true);
  await doc.save(mockFileAPI);
  assert(saveAsCalled, 'save() without path delegates to saveAs');
  assert(doc.path === 'C:/saved/new.md', 'saveAs updates doc path');
  assert(doc.name === 'new.md', 'saveAs updates doc name');
  assert(!doc.dirty, 'saveAs clears dirty flag');
}

// ── TabManager tests ──────────────────────────────────────────────────────────

console.log('\n📑 TabManager Tests:');

{
  const tm = new TabManager();
  assert(tm.count === 0, 'TabManager starts empty');
  assert(tm.activeDocument === null, 'Active document starts null');

  const doc1 = new Document({ id: '1', name: 'Tab 1' });
  const doc2 = new Document({ id: '2', name: 'Tab 2' });

  tm.add(doc1, true);
  assert(tm.count === 1, 'add increases count');
  assert(tm.activeId === '1', 'add with activate=true sets activeId');
  assert(tm.activeDocument === doc1, 'activeDocument returns active doc');

  tm.add(doc2, false);
  assert(tm.count === 2, 'add second tab increases count to 2');
  assert(tm.activeId === '1', 'add with activate=false preserves activeId');

  tm.setActive('2');
  assert(tm.activeId === '2', 'setActive changes active tab');
  assert(tm.activeDocument === doc2, 'activeDocument returns newly active doc');
}

{
  // Test path de-duplication
  const tm = new TabManager();
  const docA = new Document({ path: 'C:/docs/a.md' });
  const docB = new Document({ path: 'C:/docs/a.md' });

  tm.add(docA, true);
  const returned = tm.add(docB, true);
  assert(tm.count === 1, 'Adding document with duplicate path does not duplicate tab');
  assert(returned === docA, 'Returns existing document on duplicate path');
}

{
  // Test tab removal and active tab shift
  const tm = new TabManager();
  const doc1 = new Document({ id: '1', name: '1' });
  const doc2 = new Document({ id: '2', name: '2' });
  const doc3 = new Document({ id: '3', name: '3' });

  tm.add(doc1);
  tm.add(doc2);
  tm.add(doc3);
  tm.setActive('2');

  const removed = tm.remove('2');
  assert(removed === doc2, 'remove() returns removed doc');
  assert(tm.count === 2, 'remove() decrements tab count');
  assert(tm.activeId === '3', 'Removing active middle tab activates adjacent tab');

  tm.remove('3');
  assert(tm.activeId === '1', 'Removing last active tab activates remaining tab');

  tm.remove('1');
  assert(tm.count === 0, 'All tabs removed');
  assert(tm.activeId === null, 'activeId is null when empty');
}

{
  // Test tab cycling (next / prev)
  const tm = new TabManager();
  const d1 = new Document({ id: '1' });
  const d2 = new Document({ id: '2' });
  const d3 = new Document({ id: '3' });
  tm.add(d1);
  tm.add(d2);
  tm.add(d3);

  tm.setActive('1');
  tm.next();
  assert(tm.activeId === '2', 'next() moves from tab 1 to tab 2');
  tm.next();
  assert(tm.activeId === '3', 'next() moves from tab 2 to tab 3');
  tm.next();
  assert(tm.activeId === '1', 'next() wraps around to tab 1');

  tm.prev();
  assert(tm.activeId === '3', 'prev() wraps backward to tab 3');
  tm.prev();
  assert(tm.activeId === '2', 'prev() moves backward to tab 2');
}

{
  // Test tab reorder
  const tm = new TabManager();
  const d1 = new Document({ id: '1' });
  const d2 = new Document({ id: '2' });
  const d3 = new Document({ id: '3' });
  tm.add(d1);
  tm.add(d2);
  tm.add(d3);

  tm.reorder(0, 2);
  assert(tm.documents[0].id === '2', 'reorder shifted tab 2 to index 0');
  assert(tm.documents[1].id === '3', 'reorder shifted tab 3 to index 1');
  assert(tm.documents[2].id === '1', 'reorder moved tab 1 to index 2');
}

{
  // Test change notifications
  const tm = new TabManager();
  let calls = 0;
  const unsub = tm.onChange(() => { calls++; });

  tm.add(new Document({ id: 'a' }));
  tm.add(new Document({ id: 'b' }), false);
  tm.setActive('b');
  assert(calls === 3, `onChange fired for tab mutations (expected 3, got ${calls})`);

  unsub();
  tm.remove('a');
  assert(calls === 3, 'unsub stops onChange notifications');
}

// ── SessionManager tests ──────────────────────────────────────────────────────

console.log('\n💾 SessionManager Tests:');

{
  const tm = new TabManager();
  const doc1 = new Document({ path: 'C:/notes/a.md', name: 'a.md', dirty: false });
  const doc2 = new Document({ name: 'Untitled 1', dirty: true });
  doc2.editorState = { doc: { toString: () => 'Draft notes' } };

  tm.add(doc1);
  tm.add(doc2);
  tm.setActive(doc2.id);

  let savedSession = null;
  global.window = {
    fileAPI: {
      saveSession: async (data) => { savedSession = data; },
      loadSession: async () => savedSession,
    },
  };

  const sm = new SessionManager({
    tabManager: tm,
    createEditorState: (content) => ({ doc: { toString: () => content } }),
    getWorkspacePath: () => 'C:/docs',
  });

  await sm.saveNow();

  assert(savedSession !== null, 'SessionManager.saveNow() calls fileAPI.saveSession');
  assert(savedSession.tabs.length === 2, 'Saves both tabs');
  assert(savedSession.activeIndex === 1, 'Saves activeIndex correctly');
  assert(savedSession.workspacePath === 'C:/docs', 'Persists the open workspace path');
  assert(savedSession.tabs[1].content === 'Draft notes', 'Preserves unsaved content for dirty untitled tab');

  // Test restoration
  const tm2 = new TabManager();
  global.window.fileAPI.openPath = async (p) => ({ canceled: false, content: 'File content' });

  const sm2 = new SessionManager({
    tabManager: tm2,
    createEditorState: (content) => ({ doc: { toString: () => content } }),
    restoreWorkspace: async (workspacePath) => {
      assert(workspacePath === 'C:/docs', 'Restores the saved workspace path');
    },
  });

  const restored = await sm2.restore();
  assert(restored === true, 'restore() returns true on success');
  assert(tm2.count === 2, 'Restores 2 tabs');
  assert(tm2.activeDocument.name === 'Untitled 1', 'Restores active tab selection');
  assert(tm2.activeDocument.getText() === 'Draft notes', 'Restores unsaved content');
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests, ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
