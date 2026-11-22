import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { WorkspaceService } = require('./src/workspace/workspace-service.js');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'flowmark-workspace-'));
let service;

try {
  const projectPath = path.join(tempRoot, 'project');
  const externalFile = path.join('notes', 'external.md');
  fs.mkdirSync(path.join(projectPath, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(projectPath, 'notes', 'one.md'), '# One');
  fs.writeFileSync(path.join(projectPath, 'ignored.txt'), 'not markdown');
  fs.writeFileSync(path.join(projectPath, 'notes', 'ignored.txt'), 'not markdown');
  let watchedChange;
  let resolveChange;
  const changeReceived = new Promise(resolve => { resolveChange = resolve; });
  service = new WorkspaceService(change => {
    if (change.relativePaths?.includes(externalFile)) {
      watchedChange = change;
      resolveChange();
    }
  });

  const opened = service.setRoot(projectPath);
  assert.equal(opened.rootPath, fs.realpathSync(projectPath));
  assert.deepEqual(opened.tree.map(item => item.name), ['notes']);
  assert.equal(opened.tree[0].children[0].relativePath, path.join('notes', 'one.md'));

  const created = service.create(path.join('notes', 'new'), 'file');
  assert.equal(path.basename(created.path), 'new.md');
  assert.equal(fs.readFileSync(created.path, 'utf8'), '');
  assert.equal(service.openFile(path.join('notes', 'one.md')).content, '# One');

  fs.writeFileSync(path.join(projectPath, 'notes', 'external.md'), '# External');
  let watcherTimeout;
  await Promise.race([
    changeReceived,
    new Promise((_, reject) => {
      watcherTimeout = setTimeout(() => reject(new Error('Workspace watcher did not report changes')), 3000);
    }),
  ]).finally(() => clearTimeout(watcherTimeout));
  assert.ok(watchedChange.relativePaths.includes(path.join('notes', 'external.md')));

  const renamed = service.rename(path.join('notes', 'new.md'), 'renamed');
  assert.equal(path.basename(renamed.newPath), 'renamed.md');
  assert.equal(fs.existsSync(renamed.oldPath), false);
  assert.throws(() => service.rename(path.join('notes', 'renamed.md'), 'renamed.txt'), /\.md extension/);

  assert.throws(() => service.delete('..'), /outside the open folder/);
  assert.throws(() => service.create('..\\escape.md', 'file'), /outside the open folder/);
  assert.throws(() => service.create(path.join(tempRoot, 'escape.md'), 'file'), /relative/);
  assert.throws(() => service.create('unsupported.txt', 'file'), /\.md extension/);

  service.delete(path.join('notes', 'renamed.md'));
  assert.equal(fs.existsSync(renamed.newPath), false);
  service.close();
  assert.equal(service.rootPath, null);
  assert.equal(service.watcher, null);
  assert.equal(service.getTree().length, 0);
  console.log('Workspace service tests passed');
} finally {
  service?.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
