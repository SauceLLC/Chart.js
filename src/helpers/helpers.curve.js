
const {almostEquals, distanceBetweenPoints} = require('./helpers.math');
const {_isPointInArea} = require('./helpers.canvas');

const EPSILON = Number.EPSILON || 1e-14;
const getPoint = (points, i) => i < points.length && !points[i]._model.skip && points[i];
const getValueAxis = (indexAxis) => indexAxis === 'x' ? 'y' : 'x';


function splineCurve(firstPoint, middlePoint, afterPoint, t) {
  // Props to Rob Spencer at scaled innovation for his post on splining between points
  // http://scaledinnovation.com/analytics/splines/aboutSplines.html

  // This function must also respect "skipped" points

  const previous = firstPoint._model.skip ? middlePoint : firstPoint;
  const current = middlePoint;
  const next = afterPoint._model.skip ? middlePoint : afterPoint;
  const d01 = distanceBetweenPoints(current, previous);
  const d12 = distanceBetweenPoints(next, current);

  let s01 = d01 / (d01 + d12);
  let s12 = d12 / (d01 + d12);

  // If all points are the same, s01 & s02 will be inf
  s01 = isNaN(s01) ? 0 : s01;
  s12 = isNaN(s12) ? 0 : s12;

  const fa = t * s01; // scaling factor for triangle Ta
  const fb = t * s12;

  return {
    previous: {
      x: current._model.x - fa * (next._model.x - previous._model.x),
      y: current._model.y - fa * (next._model.y - previous._model.y)
    },
    next: {
      x: current._model.x + fb * (next._model.x - previous._model.x),
      y: current._model.y + fb * (next._model.y - previous._model.y)
    }
  };
}

/**
 * Adjust tangents to ensure monotonic properties
 */
function monotoneAdjust(points, deltaK, mK) {
  const pointsLen = points.length;

  let alphaK, betaK, tauK, squaredMagnitude, pointCurrent;
  let pointAfter = getPoint(points, 0);
  for (let i = 0; i < pointsLen - 1; ++i) {
    pointCurrent = pointAfter;
    pointAfter = getPoint(points, i + 1);
    if (!pointCurrent || !pointAfter) {
      continue;
    }

    if (almostEquals(deltaK[i], 0, EPSILON)) {
      mK[i] = mK[i + 1] = 0;
      continue;
    }

    alphaK = mK[i] / deltaK[i];
    betaK = mK[i + 1] / deltaK[i];
    squaredMagnitude = alphaK * alphaK + betaK * betaK;
    if (squaredMagnitude <= 9) {
      continue;
    }

    tauK = 3 / Math.sqrt(squaredMagnitude);
    mK[i] = alphaK * tauK * deltaK[i];
    mK[i + 1] = betaK * tauK * deltaK[i];
  }
}

function monotoneCompute(points, mK, indexAxis = 'x', tension=0.4) {
  const valueAxis = getValueAxis(indexAxis);
  const pointsLen = points.length;
  let delta, pointBefore, pointCurrent;
  let pointAfter = getPoint(points, 0);

  for (let i = 0; i < pointsLen; ++i) {
    pointBefore = pointCurrent;
    pointCurrent = pointAfter;
    pointAfter = getPoint(points, i + 1);
    if (!pointCurrent) {
      continue;
    }

    const iPixel = pointCurrent._model[indexAxis];
    const vPixel = pointCurrent._model[valueAxis];
    if (pointBefore) {
      delta = (iPixel - pointBefore._model[indexAxis]) / (1 / tension);
      pointCurrent[`cp1${indexAxis}`] = iPixel - delta;
      pointCurrent[`cp1${valueAxis}`] = vPixel - delta * mK[i];
    }
    if (pointAfter) {
      delta = (pointAfter._model[indexAxis] - iPixel) / (1 / tension);
      pointCurrent[`cp2${indexAxis}`] = iPixel + delta;
      pointCurrent[`cp2${valueAxis}`] = vPixel + delta * mK[i];
    }
  }
}

/**
 * This function calculates Bézier control points in a similar way than |splineCurve|,
 * but preserves monotonicity of the provided data and ensures no local extremums are added
 * between the dataset discrete points due to the interpolation.
 * See : https://en.wikipedia.org/wiki/Monotone_cubic_interpolation
 *
 * @param {{
 * x: number,
 * y: number,
 * skip?: boolean,
 * cp1x?: number,
 * cp1y?: number,
 * cp2x?: number,
 * cp2y?: number,
 * }[]} points
 * @param {string} indexAxis
 */
function splineCurveMonotone(points, indexAxis = 'x', tension) {
  const valueAxis = getValueAxis(indexAxis);
  const pointsLen = points.length;
  const deltaK = Array(pointsLen).fill(0);
  const mK = Array(pointsLen);

  // Calculate slopes (deltaK) and initialize tangents (mK)
  let i, pointBefore, pointCurrent;
  let pointAfter = getPoint(points, 0);

  for (i = 0; i < pointsLen; ++i) {
    pointBefore = pointCurrent;
    pointCurrent = pointAfter;
    pointAfter = getPoint(points, i + 1);
    if (!pointCurrent) {
      continue;
    }

    if (pointAfter) {
      const slopeDelta = pointAfter._model[indexAxis] - pointCurrent._model[indexAxis];

      // In the case of two points that appear at the same x pixel, slopeDeltaX is 0
      deltaK[i] = slopeDelta !== 0 ?
        (pointAfter._model[valueAxis] - pointCurrent._model[valueAxis]) / slopeDelta :
        0;
    }
    mK[i] = !pointBefore ? deltaK[i]
      : !pointAfter ? deltaK[i - 1]
      : (Math.sign(deltaK[i - 1]) !== Math.sign(deltaK[i])) ? 0
      : (deltaK[i - 1] + deltaK[i]) / 2;
  }

  monotoneAdjust(points, deltaK, mK);

  monotoneCompute(points, mK, indexAxis, tension);
}

function capControlPoint(pt, min, max) {
  return Math.max(Math.min(pt, max), min);
}

function capBezierPoints(points, area) {
  let i, ilen, point, inArea, inAreaPrev;
  let inAreaNext = _isPointInArea(points[0], area);
  for (i = 0, ilen = points.length; i < ilen; ++i) {
    inAreaPrev = inArea;
    inArea = inAreaNext;
    inAreaNext = i < ilen - 1 && _isPointInArea(points[i + 1], area);
    if (!inArea) {
      continue;
    }
    point = points[i];
    if (inAreaPrev) {
      point.cp1x = capControlPoint(point.cp1x, area.left, area.right);
      point.cp1y = capControlPoint(point.cp1y, area.top, area.bottom);
    }
    if (inAreaNext) {
      point.cp2x = capControlPoint(point.cp2x, area.left, area.right);
      point.cp2y = capControlPoint(point.cp2y, area.top, area.bottom);
    }
  }
}

/**
 * @private
 */
function _updateBezierControlPoints(points, options, area, loop, indexAxis) {
  // Only consider points that are drawn in case the spanGaps option is used
  if (options.spanGaps) {
    points = points.filter((pt) => !pt._model.skip);
  }
  if (options.cubicInterpolationMode === 'monotone') {
    splineCurveMonotone(points, indexAxis, options.tension);
  } else {
    let prev = loop ? points[points.length - 1] : points[0];
    for (let i = 0, ilen = points.length; i < ilen; i++) {
      const point = points[i];
      const after = points[Math.min(i + 1, ilen - (loop ? 0 : 1)) % ilen];
      const controlPoints = splineCurve(prev, point, after, options.tension);
      point.cp1x = controlPoints.previous.x;
      point.cp1y = controlPoints.previous.y;
      point.cp2x = controlPoints.next.x;
      point.cp2y = controlPoints.next.y;
      prev = point;
    }
  }

  if (options.capBezierPoints) {
    capBezierPoints(points, area);
  }
}

module.exports = {
    splineCurve,
    splineCurveMonotone,
    _updateBezierControlPoints,
};
