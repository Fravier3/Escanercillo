// Each candidate describes four clockwise sides. Look for the actual pixel
// transition along their entire length before trusting the four corners.
globalThis.refinePaperEdges = function refinePaperEdges(corners, gray, color, width, height, detail = false) {
  const radius = Math.max(4, Math.min(detail ? 26 : 18, Math.round(Math.min(width, height) * .026)));
  const samples = detail ? 38 : 24;
  const lines = [];
  const confidence = [];

  function sample(data, stride, channel, x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const dx = x - ix, dy = y - iy;
    const at = (iy * width + ix) * stride + channel;
    const top = data[at] * (1 - dx) + data[at + stride] * dx;
    const bottom = data[at + width * stride] * (1 - dx) + data[at + (width + 1) * stride] * dx;
    return top * (1 - dy) + bottom * dy;
  }

  function transition(x, y, nx, ny) {
    const span = detail ? 2.4 : 1.6;
    const a = [x - nx * span, y - ny * span], b = [x + nx * span, y + ny * span];
    if ([a, b].some(([px, py]) => px < 0 || py < 0 || px >= width - 1 || py >= height - 1)) return 0;
    const difference = sample(gray, 1, 0, ...b) - sample(gray, 1, 0, ...a);
    if (Math.abs(difference) >= 30) return Math.abs(difference) * (difference > 0 ? 1.08 : 1);
    let chroma = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      const change = sample(color, 4, channel, ...b) - sample(color, 4, channel, ...a);
      chroma = Math.max(chroma, Math.abs(change - difference));
    }
    return (Math.abs(difference) + chroma * .55) * (difference > 0 ? 1.08 : 1);
  }

  function fit(hits) {
    let best = [], score = 0;
    const tolerance = detail ? 1.8 : 1.45;
    // A short isolated transition (a letter, crease, or scratch) cannot
    // define a side. Fit to the transition supported across the side.
    for (let i = 0; i < hits.length; i += 1) {
      for (let j = i + 1; j < hits.length; j += 1) {
        const a = hits[i], b = hits[j];
        if (b.t - a.t < .34) continue;
        const slope = (b.offset - a.offset) / (b.t - a.t);
        if (Math.abs(slope) > 1.6 * radius) continue;
        const inliers = hits.filter(p => Math.abs(p.offset - (a.offset + (p.t - a.t) * slope)) < tolerance);
        const coverage = inliers.at(-1).t - inliers[0].t;
        const weight = inliers.reduce((sum, p) => sum + 1 + Math.min(1, p.strength / 35) * .16, 0);
        const quality = weight * coverage;
        if (quality > score) {
          best = inliers;
          score = quality;
        }
      }
    }
    if (best.length < samples * .36 || best.at(-1).t - best[0].t < .49) return null;
    const tMean = best.reduce((sum, p) => sum + p.t, 0) / best.length;
    const offsetMean = best.reduce((sum, p) => sum + p.offset, 0) / best.length;
    const slope = best.reduce((sum, p) => sum + (p.t - tMean) * (p.offset - offsetMean), 0) /
      best.reduce((sum, p) => sum + (p.t - tMean) ** 2, 0);
    return { base: offsetMean - slope * tMean, slope, coverage: best.length / samples };
  }

  for (const [index, a] of corners.entries()) {
    const b = corners[(index + 1) % 4];
    const dx = b.x - a.x, dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    const nx = -dy / length, ny = dx / length;
    const hits = [];
    for (let step = 0; step < samples; step += 1) {
      const t = .09 + .82 * step / (samples - 1);
      const x = a.x + t * dx, y = a.y + t * dy;
      let strength = 0, offset = 0, score = 0;
      for (let shift = -radius; shift <= radius; shift += 1) {
        const value = transition(x + nx * shift, y + ny * shift, nx, ny);
        // A transition far from the candidate needs better evidence, but a
        // true high-contrast edge should still outrank a nearby weak contour.
        const weighted = value / (1 + .55 * Math.abs(shift) / radius);
        if (weighted > score) {
          score = weighted;
          strength = value;
          offset = shift;
        }
      }
      if (strength >= (detail ? 7 : 6)) hits.push({ t, offset, strength });
    }
    const fitResult = fit(hits);
    if (!fitResult) return null;
    confidence.push(fitResult.coverage);
    // A tiny inset on verified sides excludes the transition pixels that
    // would otherwise blend desk color into the paper during resampling.
    const inset = detail ? 1.9 : 0;
    const start = fitResult.base + inset, end = start + fitResult.slope;
    lines.push([{ x: a.x + nx * start, y: a.y + ny * start }, { x: b.x + nx * end, y: b.y + ny * end }]);
  }

  function intersect([a, b], [c, d]) {
    const dx = b.x - a.x, dy = b.y - a.y, ex = d.x - c.x, ey = d.y - c.y;
    const determinant = dx * ey - dy * ex;
    if (Math.abs(determinant) < 1) return null;
    const t = ((c.x - a.x) * ey - (c.y - a.y) * ex) / determinant;
    return { x: a.x + t * dx, y: a.y + t * dy };
  }

  const points = lines.map((line, i) => intersect(lines[(i + 3) % 4], line));
  if (points.some((point, i) => !point || point.x < 0 || point.y < 0 || point.x >= width || point.y >= height ||
    Math.hypot(point.x - corners[i].x, point.y - corners[i].y) > radius * 2.8)) return null;
  return { points, confidence: .58 * Math.min(...confidence) + .42 * confidence.reduce((a, b) => a + b, 0) / 4 };
};

// When a contour breaks at a shadow or a low-contrast corner, reconstruct
// candidates by intersecting long edge segments around the center of the shot.
globalThis.paperFromSegments = function paperFromSegments(values, width, height, consider) {
  const groups = [[], [], [], []];
  for (let i = 0; i < values.length; i += 4) {
    const [x, y, bx, by] = values.subarray(i, i + 4);
    const dx = bx - x, dy = by - y;
    const horizontal = Math.abs(dx) > Math.abs(dy);
    const center = horizontal ? height / 2 : width / 2;
    const intercept = horizontal ? y + dy * (width / 2 - x) / dx : x + dx * (height / 2 - y) / dy;
    if (Math.abs(intercept - center) < center * .19 || intercept < 1 || intercept > 2 * center - 2) continue;
    const side = horizontal ? (intercept < center ? 0 : 2) : (intercept < center ? 3 : 1);
    const score = Math.hypot(dx, dy) * (1 + .25 * Math.abs(intercept - center) / center);
    groups[side].push({ x, y, dx, dy, intercept, score });
  }

  const best = groups.map(group => {
    const picked = [];
    for (const line of group.sort((a, b) => b.score - a.score)) {
      if (picked.some(item => Math.abs(line.intercept - item.intercept) < 10)) continue;
      picked.push(line);
      if (picked.length === 4) break;
    }
    return picked;
  });

  function intersect(a, b) {
    const determinant = a.dx * b.dy - a.dy * b.dx;
    if (Math.abs(determinant) < 1) return null;
    const t = ((b.x - a.x) * b.dy - (b.y - a.y) * b.dx) / determinant;
    return { x: a.x + t * a.dx, y: a.y + t * a.dy };
  }

  for (const top of best[0]) {
    for (const right of best[1]) {
      const upperRight = intersect(top, right);
      for (const bottom of best[2]) {
        const lowerRight = intersect(right, bottom);
        for (const left of best[3]) {
          const points = [intersect(left, top), upperRight, lowerRight, intersect(bottom, left)];
          if (points.some(point => !point || point.x < 0 || point.y < 0 || point.x >= width || point.y >= height)) continue;
          consider(points, .94);
        }
      }
    }
  }
};
