import assert from 'assert';

console.log('🧪 Testing Click Coordinate Normalization & Line Boundary Snapping:');

// Mock line DOM rect and targetLine mock
function createMockLine(lineNum, top, height) {
  return {
    className: 'cm-line',
    closest(sel) { return sel === '.cm-line' ? this : null; },
    getBoundingClientRect() {
      return {
        top,
        bottom: top + height,
        height,
        left: 50,
        right: 770,
        width: 720
      };
    }
  };
}

function normalizeClickCoords(view, coords) {
  if (!coords || typeof coords.x !== 'number' || typeof coords.y !== 'number' || !view?.dom) {
    return coords;
  }
  try {
    const doc = view.dom.ownerDocument || document;
    const contentDOM = view.contentDOM;
    if (!contentDOM) return coords;

    const contentRect = contentDOM.getBoundingClientRect();
    const sampleX = Math.max(contentRect.left + 8, Math.min(coords.x, contentRect.right - 8));
    const target = doc.elementFromPoint(coords.x, coords.y) || doc.elementFromPoint(sampleX, coords.y);
    const lineEl = target?.closest?.('.cm-line');
    if (!lineEl) return coords;

    const rect = lineEl.getBoundingClientRect();
    if (coords.y >= rect.top && coords.y <= rect.bottom) {
      const linePos = view.posAtDOM(lineEl);
      const targetLine = view.state.doc.lineAt(linePos);

      const docTop = contentRect.top + (view.viewState ? view.viewState.paddingTop : 0);
      const yOffset = coords.y - docTop;
      const block = view.elementAtHeight(yOffset);

      if (block && block.from > targetLine.to) {
        // CodeMirror overshot into a subsequent line block
        const safeOffset = rect.height <= 36 ? (rect.height / 2) : Math.max(rect.height / 2, rect.height - 6);
        const safeY = Math.max(rect.top + 2, Math.min(coords.y, rect.top + safeOffset));
        return { x: coords.x, y: safeY };
      }
    }
  } catch {
    // Fall back to raw coordinates on any measurement error
  }
  return coords;
}

// 1. Test standard click inside line without overshoot:
{
  const lineEl = createMockLine(1, 100, 30);
  const mockDoc = {
    elementFromPoint(x, y) {
      if (y >= 100 && y <= 130) return lineEl;
      return null;
    }
  };
  const mockView = {
    dom: { ownerDocument: mockDoc },
    contentDOM: {
      getBoundingClientRect: () => ({ top: 100, bottom: 500, left: 50, right: 770 })
    },
    viewState: { paddingTop: 0 },
    posAtDOM: () => 0,
    state: {
      doc: {
        lineAt: () => ({ number: 1, from: 0, to: 20 })
      }
    },
    elementAtHeight: (yOffset) => {
      // Correctly resolved to line 1 block
      return { from: 0, to: 20, top: 0, bottom: 30 };
    }
  };

  const coords = { x: 120, y: 110 };
  const res = normalizeClickCoords(mockView, coords);
  assert.strictEqual(res.y, 110, 'Normal click within line should remain unchanged');
  console.log('  ✅ Standard click within line boundaries remains untouched');
}

// 2. Test click near the bottom margin where CodeMirror overshoots to next line:
{
  const lineEl = createMockLine(1, 100, 30);
  const mockDoc = {
    elementFromPoint(x, y) {
      if (y >= 100 && y <= 130) return lineEl;
      return null;
    }
  };
  const mockView = {
    dom: { ownerDocument: mockDoc },
    contentDOM: {
      getBoundingClientRect: () => ({ top: 100, bottom: 500, left: 50, right: 770 })
    },
    viewState: { paddingTop: 0 },
    posAtDOM: () => 0,
    state: {
      doc: {
        lineAt: () => ({ number: 1, from: 0, to: 20 })
      }
    },
    elementAtHeight: (yOffset) => {
      // Simulating CodeMirror height oracle overshooting to line 2 (starts at pos 21)
      if (yOffset >= 28) {
        return { from: 21, to: 45, top: 28, bottom: 58 };
      }
      return { from: 0, to: 20, top: 0, bottom: 28 };
    }
  };

  const coords = { x: 120, y: 129.5 }; // Near bottom (29.5px into 30px line)
  const res = normalizeClickCoords(mockView, coords);
  assert.ok(res.y < 128, 'Should clamp Y inside line 1 boundaries');
  assert.strictEqual(res.y, 115, 'Clamped Y to vertical center for single-line box');
  console.log('  ✅ Near-bottom click overshooting to line below is clamped safely inside clicked line');
}

// 3. Test click in side padding (horizontal margin):
{
  const lineEl = createMockLine(2, 130, 30);
  const mockDoc = {
    elementFromPoint(x, y) {
      // Outside .cm-content on the right (x = 800)
      if (x > 770) return null;
      if (y >= 130 && y <= 160) return lineEl;
      return null;
    }
  };
  const mockView = {
    dom: { ownerDocument: mockDoc },
    contentDOM: {
      getBoundingClientRect: () => ({ top: 100, bottom: 500, left: 50, right: 770 })
    },
    viewState: { paddingTop: 0 },
    posAtDOM: () => 21,
    state: {
      doc: {
        lineAt: () => ({ number: 2, from: 21, to: 45 })
      }
    },
    elementAtHeight: (yOffset) => {
      if (yOffset >= 58) {
        return { from: 46, to: 80, top: 58, bottom: 88 };
      }
      return { from: 21, to: 45, top: 30, bottom: 58 };
    }
  };

  const coords = { x: 800, y: 159 }; // In right padding, bottom of line 2
  const res = normalizeClickCoords(mockView, coords);
  assert.ok(res.y < 158, 'Should find line element via sampled X and clamp Y');
  console.log('  ✅ Click in horizontal editor margin resolves line and clamps Y correctly');
}

console.log('\nAll click normalization tests passed!');
