import assert from 'assert';

console.log('🧪 Testing Click Coordinate Normalization & Line Boundary Snapping:');

function createMockLine(lineNum, top, height) {
  return {
    className: 'cm-line',
    closest(sel) { return sel === '.cm-line' ? this : null; },
    contains(child) { return child && child.parentElement === this; },
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

function getPreciseLinePos(view, coords) {
  if (!coords || typeof coords.x !== 'number' || typeof coords.y !== 'number' || !view?.dom) {
    return null;
  }
  try {
    const doc = view.dom.ownerDocument || document;
    const contentDOM = view.contentDOM;
    if (!contentDOM) return null;

    const contentRect = contentDOM.getBoundingClientRect();
    const clampedX = Math.max(contentRect.left + 24, Math.min(coords.x, contentRect.right - 24));

    let hit = doc.elementFromPoint(coords.x, coords.y);
    let lineEl = hit?.closest?.('.cm-line');
    if (!lineEl) {
      hit = doc.elementFromPoint(clampedX, coords.y);
      lineEl = hit?.closest?.('.cm-line');
    }
    if (!lineEl) return null;

    const lineRect = lineEl.getBoundingClientRect();
    if (coords.y < lineRect.top || coords.y > lineRect.bottom) {
      return null;
    }

    const startPos = view.posAtDOM(lineEl, 0);
    const targetLine = view.state.doc.lineAt(startPos);

    if (doc.caretRangeFromPoint) {
      const range = doc.caretRangeFromPoint(coords.x, coords.y) || doc.caretRangeFromPoint(clampedX, coords.y);
      if (range && lineEl.contains(range.startContainer)) {
        const domPos = view.posAtDOM(range.startContainer, range.startOffset);
        if (domPos != null) {
          const clamped = Math.max(targetLine.from, Math.min(domPos, targetLine.to));
          return { pos: clamped, assoc: -1, targetLine };
        }
      }
    }

    const safeY = lineRect.top + lineRect.height / 2;
    return { fallbackCoords: { x: coords.x, y: safeY }, targetLine };
  } catch {
    return null;
  }
}

// 1. Test click on text via browser caret range:
{
  const lineEl = createMockLine(1, 100, 30);
  const textNode = { parentElement: lineEl, length: 15 };
  const mockDoc = {
    elementFromPoint(x, y) { return (y >= 100 && y <= 130) ? lineEl : null; },
    caretRangeFromPoint(x, y) {
      return { startContainer: textNode, startOffset: 7 };
    }
  };
  const mockView = {
    dom: { ownerDocument: mockDoc },
    contentDOM: {
      getBoundingClientRect: () => ({ top: 100, bottom: 500, left: 50, right: 770 })
    },
    posAtDOM: (node, offset) => {
      if (node === lineEl) return 0;
      return offset; // 7
    },
    state: {
      doc: { lineAt: () => ({ number: 1, from: 0, to: 20 }) }
    }
  };

  const res = getPreciseLinePos(mockView, { x: 120, y: 129.5 });
  assert.strictEqual(res.pos, 7, 'Resolves exact character position directly from browser layout caret');
  console.log('  ✅ Resolves character position directly from layout caret without heightmap error');
}

// 2. Test click in half-leading/margin where caretRange returns null:
{
  const lineEl = createMockLine(2, 200, 30);
  const mockDoc = {
    elementFromPoint(x, y) { return (y >= 200 && y <= 230) ? lineEl : null; },
    caretRangeFromPoint: () => null
  };
  const mockView = {
    dom: { ownerDocument: mockDoc },
    contentDOM: {
      getBoundingClientRect: () => ({ top: 100, bottom: 500, left: 50, right: 770 })
    },
    posAtDOM: () => 21,
    state: {
      doc: { lineAt: () => ({ number: 2, from: 21, to: 45 }) }
    }
  };

  const res = getPreciseLinePos(mockView, { x: 800, y: 229 }); // Bottom edge in margin
  assert.ok(res.fallbackCoords, 'Should provide fallback coords');
  assert.strictEqual(res.fallbackCoords.y, 215, 'Fallback coords Y is centered in line box');
  console.log('  ✅ Fallback coordinates correctly center Y in line box to avoid boundary clipping');
}

// 3. Test clamping when position exceeds line end:
{
  const lineEl = createMockLine(3, 300, 30);
  const textNode = { parentElement: lineEl, length: 10 };
  const mockDoc = {
    elementFromPoint: () => lineEl,
    caretRangeFromPoint: () => ({ startContainer: textNode, startOffset: 25 })
  };
  const mockView = {
    dom: { ownerDocument: mockDoc },
    contentDOM: {
      getBoundingClientRect: () => ({ top: 100, bottom: 500, left: 50, right: 770 })
    },
    posAtDOM: (node, offset) => (node === lineEl ? 50 : 75), // overshoots targetLine.to (60)
    state: {
      doc: { lineAt: () => ({ number: 3, from: 50, to: 60 }) }
    }
  };

  const res = getPreciseLinePos(mockView, { x: 300, y: 320 });
  assert.strictEqual(res.pos, 60, 'Should strictly clamp to targetLine.to');
  console.log('  ✅ Clamps to line end and prevents leaking into next line');
}

console.log('\nAll click normalization tests passed!');
