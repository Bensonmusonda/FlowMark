/**
 * Automated tests for Context Menu System & TabManager close methods
 */

import { Document, TabManager } from './src/model/document.js';
import { ContextMenuService } from './src/ui/contextMenu.js';

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

console.log('\n📋 TabManager Context Menu Operations:');

{
  const tm = new TabManager();
  const doc1 = new Document({ id: '1', name: 'Tab 1', dirty: false });
  const doc2 = new Document({ id: '2', name: 'Tab 2', dirty: true });
  const doc3 = new Document({ id: '3', name: 'Tab 3', dirty: false });
  const doc4 = new Document({ id: '4', name: 'Tab 4', dirty: false });

  tm.add(doc1);
  tm.add(doc2);
  tm.add(doc3);
  tm.add(doc4);

  assert(tm.count === 4, 'TabManager initially has 4 documents');

  // Test removeToRight
  const removedRight = tm.removeToRight('2');
  assert(removedRight.length === 2, 'removeToRight removed 2 tabs');
  assert(removedRight[0].id === '3' && removedRight[1].id === '4', 'removeToRight removed correct tab IDs');
  assert(tm.count === 2, 'TabManager count is now 2');
}

{
  const tm = new TabManager();
  const doc1 = new Document({ id: '1', name: 'Tab 1', dirty: false });
  const doc2 = new Document({ id: '2', name: 'Tab 2', dirty: false });
  const doc3 = new Document({ id: '3', name: 'Tab 3', dirty: false });

  tm.add(doc1);
  tm.add(doc2);
  tm.add(doc3);

  // Test removeOthers
  const removedOthers = tm.removeOthers('2');
  assert(removedOthers.length === 2, 'removeOthers removed 2 tabs');
  assert(tm.count === 1, 'Only 1 tab remains');
  assert(tm.activeId === '2', 'Active tab is the kept tab');
}

{
  const tm = new TabManager();
  const doc1 = new Document({ id: '1', name: 'Tab 1', dirty: true });
  const doc2 = new Document({ id: '2', name: 'Tab 2', dirty: false });
  const doc3 = new Document({ id: '3', name: 'Tab 3', dirty: false });

  tm.add(doc1);
  tm.add(doc2);
  tm.add(doc3);

  // Test removeSaved
  const removedSaved = tm.removeSaved();
  assert(removedSaved.length === 2, 'removeSaved removed 2 clean tabs');
  assert(tm.count === 1, 'Only dirty tab remains');
  assert(tm.documents[0].id === '1', 'Kept tab is Tab 1');
}

console.log('\n🧩 ContextMenuService Item Registration & Extensibility:');

{
  const menuService = new ContextMenuService();
  assert(menuService.pluginItems.size === 0, 'Initial plugin items map is empty');

  const unregister = menuService.registerItem('editor', {
    label: 'Custom Plugin Action',
    action: () => 'executed',
  });

  assert(menuService.pluginItems.has('editor'), 'Registered item for editor target');
  assert(menuService.pluginItems.get('editor').size === 1, 'Editor target has 1 item');

  unregister();
  assert(menuService.pluginItems.get('editor').size === 0, 'Unregistering cleans up target set');
}

console.log(`\n${passed + failed} tests, ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
