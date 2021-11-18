'use strict';

const defaults = require('../core/core.defaults');
const Element = require('../core/core.element');
const helpers = require('../helpers/index');

const {_bezierInterpolation, _pointInLine, _steppedInterpolation} = helpers.interpolation;
const {_computeSegments, _boundSegments} = helpers.segment;
const {_steppedLineTo, _bezierCurveTo} = helpers.canvas;
const {_updateBezierControlPoints} = helpers.curve;

const valueOrDefault = helpers.valueOrDefault;
const defaultColor = defaults.global.defaultColor;


defaults._set('global', {
  elements: {
    line: {
      tension: 0.4,
      backgroundColor: defaultColor,
      borderWidth: 3,
      borderColor: defaultColor,
      borderCapStyle: 'butt',
      borderDash: [],
      borderDashOffset: 0.0,
      borderJoinStyle: 'miter',
      capBezierPoints: true,
      cubicInterpolationMode: 'default',
      fill: false,
      spanGaps: false,
      stepped: false,
    }
  }
});


/**
 * @typedef { import("./element.point").default } PointElement
 */

function setStyle(ctx, options, style = options) {
  ctx.lineCap = valueOrDefault(style.borderCapStyle, options.borderCapStyle);
  ctx.setLineDash(valueOrDefault(style.borderDash, options.borderDash));
  ctx.lineDashOffset = valueOrDefault(style.borderDashOffset, options.borderDashOffset);
  ctx.lineJoin = valueOrDefault(style.borderJoinStyle, options.borderJoinStyle);
  ctx.lineWidth = valueOrDefault(style.borderWidth, options.borderWidth);
  ctx.strokeStyle = valueOrDefault(style.borderColor, options.borderColor);
}

function lineTo(ctx, previous, target) {
  ctx.lineTo(target._view.x, target._view.y);
}

function getLineMethod(options) {
  if (options.stepped) {
    return _steppedLineTo;
  }

  if (options.tension || options.cubicInterpolationMode === 'monotone') {
    return _bezierCurveTo;
  }

  return lineTo;
}

function pathVars(points, segment, params = {}) {
  const count = points.length;
  const {start: paramsStart = 0, end: paramsEnd = count - 1} = params;
  const {start: segmentStart, end: segmentEnd} = segment;
  const start = Math.max(paramsStart, segmentStart);
  const end = Math.min(paramsEnd, segmentEnd);
  const outside = paramsStart < segmentStart && paramsEnd < segmentStart || paramsStart > segmentEnd && paramsEnd > segmentEnd;

  return {
    count,
    start,
    loop: segment.loop,
    ilen: end < start && !outside ? count + end - start : end - start
  };
}

/**
 * Create path from points, grouping by truncated x-coordinate
 * Points need to be in order by x-coordinate for this to work efficiently
 * @param {CanvasRenderingContext2D|Path2D} ctx - Context
 * @param {LineElement} line
 * @param {object} segment
 * @param {number} segment.start - start index of the segment, referring the points array
 * @param {number} segment.end - end index of the segment, referring the points array
 * @param {boolean} segment.loop - indicates that the segment is a loop
 * @param {object} params
 * @param {boolean} params.move - move to starting point (vs line to it)
 * @param {boolean} params.reverse - path the segment from end to start
 * @param {number} params.start - limit segment to points starting from `start` index
 * @param {number} params.end - limit segment to points ending at `start` + `count` index
 */
function pathSegment(ctx, line, segment, params) {
  const {points, options} = line;
  const {count, start, loop, ilen} = pathVars(points, segment, params);
  const lineMethod = getLineMethod(options);
  // eslint-disable-next-line prefer-const
  let {move = true, reverse} = params || {};
  let i, point, prev;

  for (i = 0; i <= ilen; ++i) {
    point = points[(start + (reverse ? ilen - i : i)) % count];

    if (point.skip) {
      // If there is a skipped point inside a segment, spanGaps must be true
      continue;
    } else if (move) {
      ctx.moveTo(point._view.x, point._view.y);
      move = false;
    } else {
      lineMethod(ctx, prev, point, reverse, options.stepped);
    }

    prev = point;
  }

  if (loop) {
    point = points[(start + (reverse ? ilen : 0)) % count];
    lineMethod(ctx, prev, point, reverse, options.stepped);
  }

  return !!loop;
}

/**
 * Create path from points, grouping by truncated x-coordinate
 * Points need to be in order by x-coordinate for this to work efficiently
 * @param {CanvasRenderingContext2D|Path2D} ctx - Context
 * @param {LineElement} line
 * @param {object} segment
 * @param {number} segment.start - start index of the segment, referring the points array
 * @param {number} segment.end - end index of the segment, referring the points array
 * @param {boolean} segment.loop - indicates that the segment is a loop
 * @param {object} params
 * @param {boolean} params.move - move to starting point (vs line to it)
 * @param {boolean} params.reverse - path the segment from end to start
 * @param {number} params.start - limit segment to points starting from `start` index
 * @param {number} params.end - limit segment to points ending at `start` + `count` index
 */
function fastPathSegment(ctx, line, segment, params) {
  const points = line.getPoints();
  const {count, start, ilen} = pathVars(points, segment, params);
  const {move = true, reverse} = params || {};
  let avgX = 0;
  let countX = 0;
  let i, point, prevX, minY, maxY, lastY;

  const pointIndex = (index) => (start + (reverse ? ilen - index : index)) % count;
  const drawX = () => {
    if (minY !== maxY) {
      // Draw line to maxY and minY, using the average x-coordinate
      ctx.lineTo(avgX, maxY);
      ctx.lineTo(avgX, minY);
      // Line to y-value of last point in group. So the line continues
      // from correct position. Not using move, to have solid path.
      ctx.lineTo(avgX, lastY);
    }
  };

  if (move) {
    point = points[pointIndex(0)];
    ctx.moveTo(point._view.x, point._view.y);
  }

  for (i = 0; i <= ilen; ++i) {
    point = points[pointIndex(i)];

    if (point.skip) {
      // If there is a skipped point inside a segment, spanGaps must be true
      continue;
    }

    const x = point._view.x;
    const y = point._view.y;
    const truncX = x | 0; // truncated x-coordinate

    if (truncX === prevX) {
      // Determine `minY` / `maxY` and `avgX` while we stay within same x-position
      if (y < minY) {
        minY = y;
      } else if (y > maxY) {
        maxY = y;
      }
      // For first point in group, countX is `0`, so average will be `x` / 1.
      avgX = (countX * avgX + x) / ++countX;
    } else {
      drawX();
      // Draw line to next x-position, using the first (or only)
      // y-value in that group
      ctx.lineTo(x, y);

      prevX = truncX;
      countX = 0;
      minY = maxY = y;
    }
    // Keep track of the last y-value in group
    lastY = y;
  }
  drawX();
}

/**
 * @param {LineElement} line - the line
 * @returns {function}
 * @private
 */
function _getSegmentMethod(line) {
  const opts = line._scale.options;
  const borderDash = opts.borderDash && opts.borderDash.length;
  const useFastPath = !line._decimated && !line._loop && !opts.tension && opts.cubicInterpolationMode !== 'monotone' && !opts.stepped && !borderDash;
  return useFastPath ? fastPathSegment : pathSegment;
}

/**
 * @private
 */
function _getInterpolationMethod(options) {
  if (options.stepped) {
    return _steppedInterpolation;
  }

  if (options.tension || options.cubicInterpolationMode === 'monotone') {
    return _bezierInterpolation;
  }

  return _pointInLine;
}

function strokePathWithCache(ctx, line, start, count) {
  let path = line._path;
  if (!path) {
    path = line._path = new Path2D();
    if (line.path(path, start, count)) {
      path.closePath();
    }
  }
  setStyle(ctx, line._view, line._scale.options);
  ctx.stroke(path);
}

function strokePathDirect(ctx, line, start, count) {
  const segments = line.getSegments();
  const options = line._scale.options;
  const segmentMethod = _getSegmentMethod(line);
  for (const segment of segments) {
    setStyle(ctx, options, segment.style);
    ctx.beginPath();
    if (segmentMethod(ctx, line, segment, {start, end: start + count - 1})) {
      ctx.closePath();
    }
    ctx.stroke();
  }
}

const usePath2D = typeof Path2D === 'function';

function draw(ctx, line, start, count) {
  if (usePath2D && !line._scale.options.segment) {
    strokePathWithCache(ctx, line, start, count);
  } else {
    strokePathDirect(ctx, line, start, count);
  }
}


module.exports = Element.extend({
  _type: 'line',

  constructor: function(cfg) {
    Element.prototype.constructor();
    this._decimated = false;
    this._pointsUpdated = false;
    if (cfg) {
      Object.assign(this, cfg);
    }
  },

  updateControlPoints: function(chartArea, indexAxis) {
    const options = this.options;
    if ((options.tension || options.cubicInterpolationMode === 'monotone') && !options.stepped && !this._pointsUpdated) {
      const loop = options.spanGaps ? this._loop : this._fullLoop;
      _updateBezierControlPoints(this._points, options, chartArea, loop, indexAxis);
      this._pointsUpdated = true;
    }
  },

  setPoints: function(points) {
    this._points = points;
    delete this._segments;
    delete this._path;
    this._pointsUpdated = false;
  },

  getPoints: function() {
    return this._children.slice();
  },

  getSegments: function() {
    return this._segments || (this._segments = _computeSegments(this, this._scale.options.segment));
  },

  /**
   * First non-skipped point on this line
   * @returns {PointElement|undefined}
   */
  first: function() {
    const segments = this.getSegments();
    const points = this.getPoints();
    return segments.length && points[segments[0].start];
  },

  /**
   * Last non-skipped point on this line
   * @returns {PointElement|undefined}
   */
  last: function() {
    const segments = this.getSegments();
    const points = this.getPoints();
    const count = segments.length;
    return count && points[segments[count - 1].end];
  },

  /**
   * Interpolate a point in this line at the same value on `property` as
   * the reference `point` provided
   * @param {PointElement} point - the reference point
   * @param {string} property - the property to match on
   * @returns {PointElement|undefined}
   */
  interpolate: function(point, property) {
    const options = this._scale.options;
    const value = point[property];
    const points = this.getPoints();
    const segments = _boundSegments(this, {property, start: value, end: value});
    if (!segments.length) {
      return;
    }
    const result = [];
    const _interpolate = _getInterpolationMethod(options);
    let i, ilen;
    for (i = 0, ilen = segments.length; i < ilen; ++i) {
      const {start, end} = segments[i];
      const p1 = points[start];
      const p2 = points[end];
      if (p1 === p2) {
        result.push(p1);
        continue;
      }
      const t = Math.abs((value - p1[property]) / (p2[property] - p1[property]));
      const interpolated = _interpolate(p1, p2, t, options.stepped);
      interpolated[property] = point[property];
      result.push(interpolated);
    }
    return result.length === 1 ? result[0] : result;
  },

  /**
   * Append a segment of this line to current path.
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} segment
   * @param {number} segment.start - start index of the segment, referring the points array
   * @param {number} segment.end - end index of the segment, referring the points array
   * @param {boolean} segment.loop - indicates that the segment is a loop
   * @param {object} params
   * @param {boolean} params.move - move to starting point (vs line to it)
   * @param {boolean} params.reverse - path the segment from end to start
   * @param {number} params.start - limit segment to points starting from `start` index
   * @param {number} params.end - limit segment to points ending at `start` + `count` index
   * @returns {undefined|boolean} - true if the segment is a full loop (path should be closed)
   */
  pathSegment: function(ctx, segment, params) {
    const segmentMethod = _getSegmentMethod(this);
    return segmentMethod(ctx, this, segment, params);
  },

  /**
   * Append all segments of this line to current path.
   * @param {CanvasRenderingContext2D|Path2D} ctx
   * @param {number} [start]
   * @param {number} [count]
   * @returns {undefined|boolean} - true if line is a full loop (path should be closed)
   */
  path: function(ctx, start, count) {
    const segments = this.getSegments();
    const segmentMethod = _getSegmentMethod(this);
    let loop = this._loop;
    start = start || 0;
    count = count || (this.getPoints().length - start);
    for (const segment of segments) {
      loop &= segmentMethod(ctx, this, segment, {start, end: start + count - 1});
    }
    return !!loop;
  },

  /**
   * Draw
   */
  draw: function() {
    const vm = this._view;
    const ctx = this._chart.ctx;
    const points = this.getPoints() || [];
    if (points.length && vm.borderWidth) {
      ctx.save();
      draw(ctx, this); // Would pass start, count but 2.9 doesn't have this.
      ctx.restore();
    }
    if (this.animated) {
      // When line is animated, the control points and path are not cached.
      this._pointsUpdated = false;
      this._path = undefined;
    }
  }
});


/**
 * @type {any}
 */
/*LineElement.defaultRoutes = {
  backgroundColor: 'backgroundColor',
  borderColor: 'borderColor'
};


LineElement.descriptors = {
  _scriptable: true,
  _indexable: (name) => name !== 'borderDash' && name !== 'fill',
};*/
