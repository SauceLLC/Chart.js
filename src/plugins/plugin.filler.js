/**
 * NOTE: Backported from 3.6.0
 * Plugin based on discussion from the following Chart.js issues:
 * @see https://github.com/chartjs/Chart.js/issues/2380#issuecomment-279961569
 * @see https://github.com/chartjs/Chart.js/issues/2440#issuecomment-256461897
 */

'use strict';

const defaults = require('../core/core.defaults');
const {_boundSegment, _boundSegments} = require('../helpers/helpers.segment');
const {clipArea, unclipArea} = require('../helpers/helpers.canvas');
const {isArray, isFinite, isObject, valueOrDefault} = require('../helpers/helpers.core');
const {TAU, _isBetween, _normalizeAngle} = require('../helpers/helpers.math');
const LineElement = require('../elements/element.line');

defaults._set('global', {
	plugins: {
		filler: {
			propagate: true,
            drawTime: 'beforeDatasetDraw'
		}
	}
});


function getLineByIndex(chart, index) {
  const meta = chart.getDatasetMeta(index);
  const visible = meta && chart.isDatasetVisible(index);
  return visible ? meta.dataset : null;
}

/**
 * @param {LineElement} line
 */
function parseFillOption(line) {
  const options = line._model;
  const fillOption = options.fill;
  let fill = valueOrDefault(fillOption && fillOption.target, fillOption);

  if (fill === undefined) {
    debugger;
    fill = !!options.backgroundColor;
  }

  if (fill === false || fill === null) {
    return false;
  }

  if (fill === true) {
    return 'origin';
  }
  return fill;
}

function decodeFill(line, index, count) {
  const fill = parseFillOption(line);
  if (isObject(fill)) {
    return isNaN(fill.value) ? false : fill;
  }
  let target = parseFloat(fill);
  if (isFinite(target) && Math.floor(target) === target) {
    if (fill[0] === '-' || fill[0] === '+') {
      target = index + target;
    }
    if (target === index || target < 0 || target >= count) {
      return false;
    }
    return target;
  }
  return ['origin', 'start', 'end', 'stack', 'shape'].indexOf(fill) >= 0 && fill;
}

function computeLinearBoundary(source) {
  const {scale = {}, fill} = source;
  let target = null;
  let horizontal;

  if (fill === 'start') {
    target = scale.bottom;
  } else if (fill === 'end') {
    target = scale.top;
  } else if (isObject(fill)) {
    target = scale.getPixelForValue(fill.value);
  } else if (scale.getBasePixel) {
    target = scale.getBasePixel();
  }

  if (isFinite(target)) {
    horizontal = scale.isHorizontal();
    return {
      x: horizontal ? target : null,
      y: horizontal ? null : target
    };
  }

  return null;
}

// TODO: use elements.ArcElement instead
class simpleArc {
  constructor(opts) {
    this._model = opts;
  }

  pathSegment(ctx, bounds, opts) {
    const {x, y, radius} = this._model;
    bounds = bounds || {start: 0, end: TAU};
    ctx.arc(x, y, radius, bounds.end, bounds.start, true);
    return !opts.bounds;
  }

  interpolate(point) {
    const {x, y, radius} = this._model;
    const angle = point.angle;
    return {
      x: x + Math.cos(angle) * radius,
      y: y + Math.sin(angle) * radius,
      angle
    };
  }
}

function computeCircularBoundary(source) {
  const {scale, fill} = source;
  const options = scale.options;
  const length = scale.getLabels().length;
  const target = [];
  const start = options.reverse ? scale.max : scale.min;
  const end = options.reverse ? scale.min : scale.max;
  let i, center, value;

  if (fill === 'start') {
    value = start;
  } else if (fill === 'end') {
    value = end;
  } else if (isObject(fill)) {
    value = fill.value;
  } else {
    value = scale.getBaseValue();
  }

  if (options.grid.circular) {
    center = scale.getPointPositionForValue(0, start);
    return new simpleArc({
      x: center._model.x,
      y: center._model.y,
      radius: scale.getDistanceFromCenterForValue(value)
    });
  }

  for (i = 0; i < length; ++i) {
    target.push(scale.getPointPositionForValue(i, value));
  }
  return target;
}

function computeBoundary(source) {
  const scale = source.scale || {};

  if (scale.getPointPositionForValue) {
    return computeCircularBoundary(source);
  }
  return computeLinearBoundary(source);
}

function findSegmentEnd(start, end, points) {
  for (;end > start; end--) {
    const point = points[end];
    if (!isNaN(point._model.x) && !isNaN(point._model.y)) {
      break;
    }
  }
  return end;
}

function pointsFromSegments(boundary, line) {
  const {x = null, y = null} = boundary || {};
  const linePoints = line.getPoints();
  const points = [];
  line.getSegments().forEach(({start, end}) => {
    end = findSegmentEnd(start, end, linePoints);
    const first = linePoints[start];
    const last = linePoints[end];
    if (y !== null) {
      points.push({x: first._model.x, y});
      points.push({x: last._model.x, y});
    } else if (x !== null) {
      points.push({x, y: first._model.y});
      points.push({x, y: last._model.y});
    }
  });
  return points.map(_model => ({_model}));
}

/**
 * @param {{ chart: Chart; scale: Scale; index: number; line: LineElement; }} source
 * @return {LineElement}
 */
function buildStackLine(source) {
  const {scale, index, line} = source;
  const points = [];
  const segments = line.getSegments();
  const sourcePoints = line.getPoints();
  const linesBelow = getLinesBelow(scale, index);
  linesBelow.push(createBoundaryLine({x: null, y: scale.bottom}, line));

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    for (let j = segment.start; j <= segment.end; j++) {
      addPointsBelow(points, sourcePoints[j], linesBelow);
    }
  }
  return new LineElement({points, options: {}});
}

/**
 * @param {Scale} scale
 * @param {number} index
 * @return {LineElement[]}
 */
function getLinesBelow(scale, index) {
  const below = [];
  const metas = scale.getMatchingVisibleMetas('line');

  for (let i = 0; i < metas.length; i++) {
    const meta = metas[i];
    if (meta.index === index) {
      break;
    }
    if (!meta.hidden) {
      below.unshift(meta.dataset);
    }
  }
  return below;
}

/**
 * @param {PointElement[]} points
 * @param {PointElement} sourcePoint
 * @param {LineElement[]} linesBelow
 */
function addPointsBelow(points, sourcePoint, linesBelow) {
  const postponed = [];
  for (let j = 0; j < linesBelow.length; j++) {
    const line = linesBelow[j];
    const {first, last, point} = findPoint(line, sourcePoint, 'x');

    if (!point || (first && last)) {
      continue;
    }
    if (first) {
      // First point of an segment -> need to add another point before this,
      // from next line below.
      postponed.unshift(point);
    } else {
      points.push(point);
      if (!last) {
        // In the middle of an segment, no need to add more points.
        break;
      }
    }
  }
  points.push(...postponed);
}

/**
 * @param {LineElement} line
 * @param {PointElement} sourcePoint
 * @param {string} property
 * @returns {{point?: PointElement, first?: boolean, last?: boolean}}
 */
function findPoint(line, sourcePoint, property) {
  const point = line.interpolate(sourcePoint, property);
  if (!point) {
    return {};
  }

  const pointValue = point[property];
  const segments = line.getSegments();
  const linePoints = line.getPoints();
  let first = false;
  let last = false;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const firstValue = linePoints[segment.start][property];
    const lastValue = linePoints[segment.end][property];
    if (_isBetween(pointValue, firstValue, lastValue)) {
      first = pointValue === firstValue;
      last = pointValue === lastValue;
      break;
    }
  }
  return {first, last, point};
}

function getTarget(source) {
  const {chart, fill, line} = source;

  if (isFinite(fill)) {
    return getLineByIndex(chart, fill);
  }

  if (fill === 'stack') {
    return buildStackLine(source);
  }

  if (fill === 'shape') {
    return true;
  }

  const boundary = computeBoundary(source);

  if (boundary instanceof simpleArc) {
    return boundary;
  }

  return createBoundaryLine(boundary, line);
}

/**
 * @param {PointElement[] | { x: number; y: number; }} boundary
 * @param {LineElement} line
 * @return {LineElement?}
 */
function createBoundaryLine(boundary, line) {
  let points = [];
  let _loop = false;

  if (isArray(boundary)) {
    _loop = true;
    // @ts-ignore
    points = boundary;
  } else {
    points = pointsFromSegments(boundary, line);
  }

  return points.length ? new LineElement({
    points,
    options: {tension: 0},
    _loop,
    _fullLoop: _loop
  }) : null;
}

function resolveTarget(sources, index, propagate) {
  const source = sources[index];
  let fill = source.fill;
  const visited = [index];
  let target;

  if (!propagate) {
    return fill;
  }

  while (fill !== false && visited.indexOf(fill) === -1) {
    if (!isFinite(fill)) {
      return fill;
    }

    target = sources[fill];
    if (!target) {
      return false;
    }

    if (target.visible) {
      return fill;
    }

    visited.push(fill);
    fill = target.fill;
  }

  return false;
}

function _clip(ctx, target, clipY) {
  ctx.beginPath();
  target.path(ctx);
  ctx.lineTo(target.last()._model.x, clipY);
  ctx.lineTo(target.first()._model.x, clipY);
  ctx.closePath();
  ctx.clip();
}

function getBounds(property, first, last, loop) {
  // Ick.  we have to support getting passed a v2 Element and a x/y coord because of the backport.
  if (loop) {
    return;
  }
  let start = first._model ? first._model[property]: first[property];
  let end = last._model ? last._model[property]: last[property];

  if (property === 'angle') {
    start = _normalizeAngle(start);
    end = _normalizeAngle(end);
  }
  return {property, start, end};
}

function _getEdge(a, b, prop, fn) {
  if (a && b) {
    return fn(a[prop], b[prop]);
  }
  return a ? a[prop] : b ? b[prop] : 0;
}

function _segments(line, target, property) {
  const segments = line.getSegments();
  const points = line.getPoints();
  const tpoints = target.getPoints();
  const parts = [];

  for (const segment of segments) {
    let {start, end} = segment;
    end = findSegmentEnd(start, end, points);
    const bounds = getBounds(property, points[start], points[end], segment.loop);
    if (!target.getSegments()) {
      // Special case for boundary not supporting `segments` (simpleArc)
      // Bounds are provided as `target` for partial circle, or undefined for full circle
      parts.push({
        source: segment,
        target: bounds,
        start: points[start],
        end: points[end]
      });
      continue;
    }

    // Get all segments from `target` that intersect the bounds of current segment of `line`
    const targetSegments = _boundSegments(target, bounds);

    for (const tgt of targetSegments) {
      const subBounds = getBounds(property, tpoints[tgt.start], tpoints[tgt.end], tgt.loop);
      const fillSources = _boundSegment(segment, points, subBounds);

      for (const fillSource of fillSources) {
        parts.push({
          source: fillSource,
          target: tgt,
          start: {
            [property]: _getEdge(bounds, subBounds, 'start', Math.max)
          },
          end: {
            [property]: _getEdge(bounds, subBounds, 'end', Math.min)
          }
        });
      }
    }
  }
  return parts;
}

function clipBounds(ctx, scale, bounds) {
  const {top, bottom} = scale.chart.chartArea;
  const {property, start, end} = bounds || {};
  if (property === 'x') {
    ctx.beginPath();
    ctx.rect(start, top, end - start, bottom - top);
    ctx.clip();
  }
}

function interpolatedLineTo(ctx, target, point, property) {
  const interpolatedPoint = target.interpolate(point, property);
  if (interpolatedPoint) {
    ctx.lineTo(interpolatedPoint._model.x, interpolatedPoint._model.y);
  }
}

function _fill(ctx, cfg) {
  const {line, target, property, color, scale} = cfg;
  const segments = _segments(line, target, property);

  for (const {source: src, target: tgt, start, end} of segments) {
    const {style: {backgroundColor = color} = {}} = src;
    const notShape = target !== true;

    ctx.save();
    ctx.fillStyle = backgroundColor;
    clipBounds(ctx, scale, notShape && getBounds(property, start, end));
    ctx.beginPath();

    const lineLoop = !!line.pathSegment(ctx, src);

    let loop;
    if (notShape) {
      if (lineLoop) {
        ctx.closePath();
      } else {
        interpolatedLineTo(ctx, target, end, property);
      }

      const targetLoop = !!target.pathSegment(ctx, tgt, {move: lineLoop, reverse: true});
      loop = lineLoop && targetLoop;
      if (!loop) {
        interpolatedLineTo(ctx, target, start, property);
      }
    }

    ctx.closePath();
    ctx.fill(loop ? 'evenodd' : 'nonzero');

    ctx.restore();
  }
}

function doFill(ctx, cfg) {
  const {line, target, above, below, area, scale} = cfg;
  const property = line._loop ? 'angle' : cfg.axis;

  ctx.save();

  if (property === 'x' && below !== above) {
    _clip(ctx, target, area.top);
    _fill(ctx, {line, target, color: above, scale, property});
    ctx.restore();
    ctx.save();
    _clip(ctx, target, area.bottom);
  }
  _fill(ctx, {line, target, color: below, scale, property});

  ctx.restore();
}

function drawfill(ctx, source, area) {
  const target = getTarget(source);
  const {line, scale, axis} = source;
  const lineOpts = line._model;
  const fillOption = lineOpts.fill;
  const color = lineOpts.backgroundColor;
  const {above = color, below = color} = fillOption || {};
  if (target && line.getPoints().length) {
    clipArea(ctx, area);
    doFill(ctx, {line, target, above, below, area, scale, axis});
    unclipArea(ctx);
  }
}

module.exports = {
  id: 'filler',

  afterDatasetsUpdate(chart, options) {
    const count = (chart.data.datasets || []).length;
    const sources = [];
    let meta, i, line, source;

    for (i = 0; i < count; ++i) {
      meta = chart.getDatasetMeta(i);
      line = meta.dataset;
      source = null;

      if (line && line._model && line instanceof LineElement) {
        source = {
          visible: chart.isDatasetVisible(i),
          index: i,
          fill: decodeFill(line, i, count),
          chart,
          axis: 'x', // XXX meta.controller.options.indexAxis,
          scale: meta.controller.getScaleForId(meta.yAxisID), // XXX
          line,
        };
      }

      meta.$filler = source;
      sources.push(source);
    }

    for (i = 0; i < count; ++i) {
      source = sources[i];
      if (!source || source.fill === false) {
        continue;
      }

      source.fill = resolveTarget(sources, i, options.propagate);
    }
  },

  beforeDraw(chart, _easingValue, options) {
    const draw = options.drawTime === 'beforeDraw';
    const metasets = chart._getSortedVisibleDatasetMetas();
    const area = chart.chartArea;
    for (let i = metasets.length - 1; i >= 0; --i) {
      const source = metasets[i].$filler;
      if (!source) {
        continue;
      }
      source.line.updateControlPoints(area, source.axis);
      if (draw) {
        drawfill(chart.ctx, source, area);
      }
    }
  },

  beforeDatasetsDraw(chart, easingValue, options) {
    if (options.drawTime !== 'beforeDatasetsDraw') {
      return;
    }
    debugger;
    const metasets = chart.getSortedVisibleDatasetMetas();
    for (let i = metasets.length - 1; i >= 0; --i) {
      const source = metasets[i].$filler;
      if (source) {
        drawfill(chart.ctx, source, chart.chartArea);
      }
    }
  },

  beforeDatasetDraw(chart, args, options) {
    const source = args.meta.$filler;

    if (!source || source.fill === false || options.drawTime !== 'beforeDatasetDraw') {
      return;
    }

    drawfill(chart.ctx, source, chart.chartArea);
  },
};
