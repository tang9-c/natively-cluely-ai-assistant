function parseTimestampToSec(value) {
  const parts = String(value).split(':').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function stripMarkup(text) {
  return String(text)
    .replace(/(?:^|[\s\n/])(?:说话人\s*\d+|@[\p{L}\p{N}_-]+)\s*/gu, ' ')
    .replace(/\d{1,2}:\d{2}:\d{2}/g, ' ')
    .replace(/[\\/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractTimedReferenceSegments(rawText) {
  const source = String(rawText ?? '');
  const regex = /(?:^|[\s\n/])(?:说话人\s*\d+|@[\p{L}\p{N}_-]+)?\s*(\d{1,2}:\d{2}:\d{2})/gu;
  const matches = [...source.matchAll(regex)];
  return matches
    .map((match, index) => {
      const startSec = parseTimestampToSec(match[1]);
      const textStart = match.index + match[0].length;
      const textEnd = index + 1 < matches.length ? matches[index + 1].index : source.length;
      return { startSec, text: stripMarkup(source.slice(textStart, textEnd)) };
    })
    .filter((segment) => segment.startSec != null && segment.text);
}

export function selectBoundaryAlignedWindow(segments, request) {
  const requestedEndSec = request.requestedStartSec + request.requestedDurationSec;
  const candidates = [];

  for (let startIndex = 0; startIndex < segments.length - 1; startIndex += 1) {
    const actualStartSec = segments[startIndex].startSec;
    if (Math.abs(actualStartSec - request.requestedStartSec) > request.maxStartShiftSec) {
      continue;
    }

    for (let endIndex = startIndex + 1; endIndex < segments.length; endIndex += 1) {
      const actualEndSec = segments[endIndex].startSec;
      const actualDurationSec = actualEndSec - actualStartSec;
      const ratio = actualDurationSec / request.requestedDurationSec;
      if (ratio < request.minDurationRatio || ratio > request.maxDurationRatio) {
        continue;
      }

      const leftOverhangSec = Math.max(0, request.requestedStartSec - actualStartSec);
      const rightOverhangSec = Math.max(0, actualEndSec - requestedEndSec);
      candidates.push({
        startIndex,
        endIndex,
        actualStartSec,
        actualEndSec,
        actualDurationSec,
        leftOverhangSec,
        rightOverhangSec,
        score: Math.abs(actualStartSec - request.requestedStartSec)
          + Math.abs(actualEndSec - requestedEndSec)
          + leftOverhangSec * 3,
      });
    }
  }

  candidates.sort((left, right) => {
    if (left.score !== right.score) return left.score - right.score;
    if (left.leftOverhangSec !== right.leftOverhangSec) {
      return left.leftOverhangSec - right.leftOverhangSec;
    }
    if (left.rightOverhangSec !== right.rightOverhangSec) {
      return left.rightOverhangSec - right.rightOverhangSec;
    }
    return left.actualStartSec - right.actualStartSec;
  });
  const best = candidates[0];
  if (!best) {
    return {
      status: 'invalid_boundary_window',
      requestedStartSec: request.requestedStartSec,
      requestedDurationSec: request.requestedDurationSec,
      text: '',
      segmentCount: 0,
    };
  }

  return {
    status: 'aligned',
    requestedStartSec: request.requestedStartSec,
    requestedDurationSec: request.requestedDurationSec,
    actualStartSec: best.actualStartSec,
    actualEndSec: best.actualEndSec,
    actualDurationSec: best.actualDurationSec,
    leftOverhangSec: 0,
    rightOverhangSec: 0,
    segmentCount: best.endIndex - best.startIndex,
    text: segments.slice(best.startIndex, best.endIndex).map((segment) => segment.text).join(' '),
  };
}

export function calculateEditBreakdown(reference, hypothesis) {
  const referenceChars = [...String(reference ?? '')];
  const hypothesisChars = [...String(hypothesis ?? '')];
  const rows = referenceChars.length + 1;
  const cols = hypothesisChars.length + 1;
  const matrix = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({
    distance: 0,
    op: 'match',
  })));

  for (let row = 1; row < rows; row += 1) {
    matrix[row][0] = { distance: row, op: 'delete' };
  }
  for (let col = 1; col < cols; col += 1) {
    matrix[0][col] = { distance: col, op: 'insert' };
  }

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      if (referenceChars[row - 1] === hypothesisChars[col - 1]) {
        matrix[row][col] = { distance: matrix[row - 1][col - 1].distance, op: 'match' };
        continue;
      }

      const substitution = { distance: matrix[row - 1][col - 1].distance + 1, op: 'substitute' };
      const deletion = { distance: matrix[row - 1][col].distance + 1, op: 'delete' };
      const insertion = { distance: matrix[row][col - 1].distance + 1, op: 'insert' };
      matrix[row][col] = [substitution, deletion, insertion]
        .sort((left, right) => left.distance - right.distance)[0];
    }
  }

  let row = referenceChars.length;
  let col = hypothesisChars.length;
  const result = {
    distance: matrix[row][col].distance,
    insertions: 0,
    deletions: 0,
    substitutions: 0,
  };

  while (row > 0 || col > 0) {
    const op = matrix[row][col].op;
    if (op === 'match') {
      row -= 1;
      col -= 1;
    } else if (op === 'substitute') {
      result.substitutions += 1;
      row -= 1;
      col -= 1;
    } else if (op === 'delete') {
      result.deletions += 1;
      row -= 1;
    } else {
      result.insertions += 1;
      col -= 1;
    }
  }

  return result;
}
