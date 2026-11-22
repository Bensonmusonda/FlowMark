export function resolveTableNavigation(spec, row, col, nav) {
  const colCount = Math.max(1, spec.header.cells.length);
  const rowCount = spec.rows.length;
  const phantom = rowCount;
  switch (nav) {
    case 'enter': {
      const next = row + 1;
      return next > phantom ? 'exit-below' : { row: next, col };
    }
    case 'down': {
      const next = row + 1;
      return next >= rowCount ? 'exit-below' : { row: next, col };
    }
    case 'up': {
      const next = row - 1;
      return next < -1 ? 'exit-above' : { row: next, col };
    }
    case 'next': {
      let r = row;
      let c = col + 1;
      if (c >= colCount) { r += 1; c = 0; }
      return r >= rowCount ? 'exit-below' : { row: r, col: c };
    }
    case 'prev': {
      let r = row;
      let c = col - 1;
      if (c < 0) { r -= 1; c = colCount - 1; }
      return r < -1 ? 'exit-above' : { row: r, col: c };
    }
    case 'right':
      return col + 1 < colCount ? { row, col: col + 1 } : null;
    case 'left':
      return col > 0 ? { row, col: col - 1 } : null;
    default:
      return null;
  }
}

export function resolveTableExit(spec, doc, direction) {
  if (direction === 'exit-above') {
    return {
      position: doc.lineAt(Math.max(0, spec.from - 1)).from,
      needsTrailingLine: false,
    };
  }
  const position = doc.lineAt(Math.min(doc.length, spec.to + 1)).from;
  const needsTrailingLine = spec.to === doc.length;
  return {
    position: needsTrailingLine ? doc.length : position,
    needsTrailingLine,
  };
}

export function appendTableExitLine(doc, changes, exit) {
  if (!exit.needsTrailingLine) return changes;
  const result = changes.map((change) => ({ ...change }));
  const endingChange = result.find((change) => change.to === doc.length);
  if (endingChange) endingChange.insert += '\n';
  else result.push({ from: doc.length, to: doc.length, insert: '\n' });
  return result;
}
