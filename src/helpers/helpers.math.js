'use strict';

const PI = Math.PI;
const TAU = 2 * PI;
const PITAU = TAU + PI;

/**
 * @alias Chart.helpers.math
 * @namespace
 */
var exports = {
    PI,
    TAU,

	/**
	 * Returns an array of factors sorted from 1 to sqrt(value)
	 * @private
	 */
	_factorize: function(value) {
		var result = [];
		var sqrt = Math.sqrt(value);
		var i;

		for (i = 1; i < sqrt; i++) {
			if (value % i === 0) {
				result.push(i);
				result.push(value / i);
			}
		}
		if (sqrt === (sqrt | 0)) { // if value is a square number
			result.push(sqrt);
		}

		result.sort(function(a, b) {
			return a - b;
		}).pop();
		return result;
	},

	log10: Math.log10 || function(x) {
		var exponent = Math.log(x) * Math.LOG10E; // Math.LOG10E = 1 / Math.LN10.
		// Check for whole powers of 10,
		// which due to floating point rounding error should be corrected.
		var powerOf10 = Math.round(exponent);
		var isPowerOf10 = x === Math.pow(10, powerOf10);

		return isPowerOf10 ? powerOf10 : exponent;
	},

    distanceBetweenPoints: (pt1, pt2) => {
        const a = pt2._model.x - pt1._model.x;
        const b = pt2._model.y - pt1._model.y;
        return Math.sqrt(a * a + b * b);
    },

    _angleDiff: (a, b) => (a - b + PITAU) % TAU - PI,

    _normalizeAngle: a => (a % TAU + TAU) % TAU,

    _angleBetween: (angle, start, end, sameAngleIsFullCircle) => {
        const a = exports._normalizeAngle(angle);
        const s = exports._normalizeAngle(start);
        const e = exports._normalizeAngle(end);
        const angleToStart = exports._normalizeAngle(s - a);
        const angleToEnd = exports._normalizeAngle(e - a);
        const startToAngle = exports._normalizeAngle(a - s);
        const endToAngle = exports._normalizeAngle(a - e);
        return a === s || a === e || (sameAngleIsFullCircle && s === e)
            || (angleToStart > angleToEnd && startToAngle < endToAngle);
    },

    almostEquals: (x, y, epsilon) => Math.abs(x - y) < epsilon,
};

module.exports = exports;

// DEPRECATIONS

/**
 * @namespace Chart.helpers.log10
 * @deprecated since version 2.9.0
 * @todo remove at version 3
 * @private
 */
require('./helpers.core').log10 = exports.log10;
