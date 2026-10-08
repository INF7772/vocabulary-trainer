import type { HandwritingDrawing, HandwritingPoint } from "../domain";

export interface HandwritingComparisonBreakdown {
  contour: number;
  coverage: number;
  structure: number;
  proportion: number;
  density: number;
}

export interface HandwritingComparison {
  score: number;
  isMatch: boolean;
  breakdown: HandwritingComparisonBreakdown;
  matchedTarget?: string;
}

const RASTER_SIZE = 96;
// Handwriting is compared with a typeset glyph, so local stroke placement must
// be deliberately forgiving. The safeguards below still reject fragments and
// differently oriented shapes, while the wider distances and coarser grid
// avoid treating a person's handwriting as an attempt to reproduce the font.
const MATCH_THRESHOLD = 0.62;
const COVERAGE_THRESHOLD = 0.42;
const STRUCTURE_THRESHOLD = 0.48;
const PROPORTION_THRESHOLD = 0.38;
const MAXIMUM_CONTOUR_DISTANCE = 16;
const COVERAGE_DISTANCE = 7;
const GRID_SIZE = 5;

const EMPTY_BREAKDOWN: HandwritingComparisonBreakdown = {
  contour: 0,
  coverage: 0,
  structure: 0,
  proportion: 0,
  density: 0,
};

/**
 * Compares normalized ink with a locally rendered reference glyph. The score
 * combines tolerant contour distance, bidirectional coverage, coarse spatial
 * distribution, proportions and ink density. It judges whether the overall
 * symbol is recognizable rather than whether the handwriting reproduces the
 * reference font, and remains visual matching rather than OCR or stroke-order
 * recognition.
 */
export function compareHandwriting(
  drawing: HandwritingDrawing,
  target: string | readonly string[],
): HandwritingComparison {
  const ink = drawing.flat();
  const targets = (typeof target === "string" ? [target] : target)
    .map((value) => value.trim())
    .filter(Boolean);
  if (ink.length < 2 || targets.length === 0 || typeof document === "undefined") {
    return emptyComparison();
  }
  const userPixels = rasterizeDrawing(drawing);
  return targets.reduce<HandwritingComparison>((best, candidate) => {
    const comparison = compareHandwritingPointClouds(
      userPixels,
      rasterizeTarget(candidate),
    );
    return comparison.score > best.score
      ? { ...comparison, matchedTarget: candidate }
      : best;
  }, emptyComparison());
}

/** Pure comparison boundary used by the canvas adapter and deterministic tests. */
export function compareHandwritingPointClouds(
  userPixels: readonly HandwritingPoint[],
  targetPixels: readonly HandwritingPoint[],
): HandwritingComparison {
  if (userPixels.length === 0 || targetPixels.length === 0) {
    return emptyComparison();
  }

  const userDistances = nearestDistances(userPixels, targetPixels);
  const targetDistances = nearestDistances(targetPixels, userPixels);
  const contour = average(
    [...userDistances, ...targetDistances].map(
      (distance) =>
        1 -
        Math.min(distance, MAXIMUM_CONTOUR_DISTANCE) /
          MAXIMUM_CONTOUR_DISTANCE,
    ),
  );
  const precision = fractionWithin(userDistances, COVERAGE_DISTANCE);
  const recall = fractionWithin(targetDistances, COVERAGE_DISTANCE);
  const coverage = harmonicMean(precision, recall);
  const structure = spatialDistributionSimilarity(userPixels, targetPixels);
  const userBounds = getBounds(userPixels);
  const targetBounds = getBounds(targetPixels);
  const proportion = ratioSimilarity(
    aspectRatio(userBounds),
    aspectRatio(targetBounds),
    1.4,
  );
  const density = ratioSimilarity(
    inkDensity(userPixels, userBounds),
    inkDensity(targetPixels, targetBounds),
    0.7,
  );
  const breakdown = { contour, coverage, structure, proportion, density };
  const score = clamp(
    contour * 0.25 +
      coverage * 0.25 +
      structure * 0.35 +
      proportion * 0.1 +
      density * 0.05,
  );
  const isMatch =
    score >= MATCH_THRESHOLD &&
    coverage >= COVERAGE_THRESHOLD &&
    structure >= STRUCTURE_THRESHOLD &&
    proportion >= PROPORTION_THRESHOLD;

  return { score, isMatch, breakdown };
}

function rasterizeDrawing(drawing: HandwritingDrawing): HandwritingPoint[] {
  const points = drawing.flat();
  const bounds = getBounds(points);
  const canvas = createCanvas();
  const context = canvas.getContext("2d");
  if (!context) return [];
  const padding = 11;
  const width = Math.max(1, bounds.maximumX - bounds.minimumX);
  const height = Math.max(1, bounds.maximumY - bounds.minimumY);
  const scale = Math.min(
    (RASTER_SIZE - padding * 2) / width,
    (RASTER_SIZE - padding * 2) / height,
  );
  const offsetX = (RASTER_SIZE - width * scale) / 2;
  const offsetY = (RASTER_SIZE - height * scale) / 2;
  context.strokeStyle = "black";
  context.fillStyle = "black";
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = 7;
  for (const stroke of drawing) {
    if (stroke.length === 0) continue;
    const project = (point: HandwritingPoint) => ({
      x: offsetX + (point.x - bounds.minimumX) * scale,
      y: offsetY + (point.y - bounds.minimumY) * scale,
    });
    if (stroke.length === 1) {
      const point = project(stroke[0]!);
      context.beginPath();
      context.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
      context.fill();
      continue;
    }
    context.beginPath();
    const first = project(stroke[0]!);
    context.moveTo(first.x, first.y);
    for (const point of stroke.slice(1)) {
      const projected = project(point);
      context.lineTo(projected.x, projected.y);
    }
    context.stroke();
  }
  return readInk(context);
}

function rasterizeTarget(target: string): HandwritingPoint[] {
  const source = createCanvas();
  const sourceContext = source.getContext("2d");
  if (!sourceContext) return [];
  const characterCount = Math.max(1, [...target.trim()].length);
  const fontSize = characterCount > 1 ? 58 : 78;
  sourceContext.fillStyle = "black";
  sourceContext.font = `500 ${fontSize}px sans-serif`;
  sourceContext.textAlign = "center";
  sourceContext.textBaseline = "middle";
  sourceContext.fillText(target.trim(), RASTER_SIZE / 2, RASTER_SIZE / 2 + 3);
  const raw = readInk(sourceContext);
  if (raw.length === 0) return [];
  const bounds = getBounds(raw);
  const normalized = createCanvas();
  const context = normalized.getContext("2d");
  if (!context) return [];
  const padding = 9;
  const width = Math.max(1, bounds.maximumX - bounds.minimumX + 1);
  const height = Math.max(1, bounds.maximumY - bounds.minimumY + 1);
  const scale = Math.min(
    (RASTER_SIZE - padding * 2) / width,
    (RASTER_SIZE - padding * 2) / height,
  );
  const destinationWidth = width * scale;
  const destinationHeight = height * scale;
  context.drawImage(
    source,
    bounds.minimumX,
    bounds.minimumY,
    width,
    height,
    (RASTER_SIZE - destinationWidth) / 2,
    (RASTER_SIZE - destinationHeight) / 2,
    destinationWidth,
    destinationHeight,
  );
  return readInk(context);
}

function nearestDistances(
  source: readonly HandwritingPoint[],
  target: readonly HandwritingPoint[],
): number[] {
  const sampledSource = source.filter((_, index) => index % 2 === 0);
  const sampledTarget = target.filter((_, index) => index % 2 === 0);
  return sampledSource.map((point) => {
    let nearestSquared = MAXIMUM_CONTOUR_DISTANCE ** 2;
    for (const candidate of sampledTarget) {
      const deltaX = point.x - candidate.x;
      const deltaY = point.y - candidate.y;
      nearestSquared = Math.min(
        nearestSquared,
        deltaX * deltaX + deltaY * deltaY,
      );
      if (nearestSquared <= 1) break;
    }
    return Math.sqrt(nearestSquared);
  });
}

function spatialDistributionSimilarity(
  left: readonly HandwritingPoint[],
  right: readonly HandwritingPoint[],
): number {
  const leftHistogram = spatialHistogram(left);
  const rightHistogram = spatialHistogram(right);
  return leftHistogram.reduce(
    (total, value, index) =>
      total + Math.min(value, rightHistogram[index] ?? 0),
    0,
  );
}

function spatialHistogram(points: readonly HandwritingPoint[]): number[] {
  const result = Array.from({ length: GRID_SIZE ** 2 }, () => 0);
  for (const point of points) {
    const column = Math.min(
      GRID_SIZE - 1,
      Math.max(0, Math.floor((point.x / RASTER_SIZE) * GRID_SIZE)),
    );
    const row = Math.min(
      GRID_SIZE - 1,
      Math.max(0, Math.floor((point.y / RASTER_SIZE) * GRID_SIZE)),
    );
    result[row * GRID_SIZE + column]! += 1;
  }
  return result.map((value) => value / points.length);
}

function fractionWithin(values: readonly number[], maximum: number): number {
  return values.filter((value) => value <= maximum).length / values.length;
}

function harmonicMean(left: number, right: number): number {
  return left + right === 0 ? 0 : (2 * left * right) / (left + right);
}

function aspectRatio(bounds: Bounds): number {
  return (
    Math.max(1, bounds.maximumX - bounds.minimumX + 1) /
    Math.max(1, bounds.maximumY - bounds.minimumY + 1)
  );
}

function inkDensity(points: readonly HandwritingPoint[], bounds: Bounds): number {
  const width = Math.max(1, bounds.maximumX - bounds.minimumX + 1);
  const height = Math.max(1, bounds.maximumY - bounds.minimumY + 1);
  return points.length / (width * height);
}

function ratioSimilarity(left: number, right: number, weight: number): number {
  if (left <= 0 || right <= 0) return 0;
  return Math.exp(-Math.abs(Math.log(left / right)) * weight);
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function readInk(context: CanvasRenderingContext2D): HandwritingPoint[] {
  const pixels = context.getImageData(0, 0, RASTER_SIZE, RASTER_SIZE).data;
  const result: HandwritingPoint[] = [];
  for (let y = 0; y < RASTER_SIZE; y += 1) {
    for (let x = 0; x < RASTER_SIZE; x += 1) {
      if (pixels[(y * RASTER_SIZE + x) * 4 + 3]! > 80) result.push({ x, y });
    }
  }
  return result;
}

function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = RASTER_SIZE;
  canvas.height = RASTER_SIZE;
  return canvas;
}

interface Bounds {
  minimumX: number;
  maximumX: number;
  minimumY: number;
  maximumY: number;
}

function getBounds(points: readonly HandwritingPoint[]): Bounds {
  return points.reduce(
    (bounds, point) => ({
      minimumX: Math.min(bounds.minimumX, point.x),
      maximumX: Math.max(bounds.maximumX, point.x),
      minimumY: Math.min(bounds.minimumY, point.y),
      maximumY: Math.max(bounds.maximumY, point.y),
    }),
    {
      minimumX: Number.POSITIVE_INFINITY,
      maximumX: Number.NEGATIVE_INFINITY,
      minimumY: Number.POSITIVE_INFINITY,
      maximumY: Number.NEGATIVE_INFINITY,
    },
  );
}

function emptyComparison(): HandwritingComparison {
  return { score: 0, isMatch: false, breakdown: { ...EMPTY_BREAKDOWN } };
}
