/* eslint-env es6 */

const pkg = require('./package.json');
const plugins = require('./rollup.plugins');
const commonjs = require('@rollup/plugin-commonjs');
const {nodeResolve} = require('@rollup/plugin-node-resolve');
const {terser} = require('rollup-plugin-terser');

const stylesheet = plugins.stylesheet;

const input = 'src/index.js';
const banner = `/*!
 * Chart.js v${pkg.version}
 * ${pkg.homepage}
 * (c) ${new Date().getFullYear()} Chart.js Contributors
 * Released under the MIT License
 */`;

module.exports = [{
    input,
    plugins: [
        nodeResolve(),
        commonjs(),
        stylesheet({
            extract: true
        }),
        /*terser({
            ecma: 6,
            keep_classnames: true,
            keep_fnames: true,
            compress: {
                defaults: false,
                arrows: true,
                dead_code: true,
                unused: true,
                evaluate: true,
            },
            format: {
                beautify: true,
                indent_level: 4,
                comments: false,
                keep_numbers: true,
                quote_style: 3, // use orig
                preamble: banner,
                braces: true,
            }
        })*/
    ],
    output: {
        name: 'Chart',
        file: 'dist/Chart.js',
        format: 'umd',
        indent: false,
    }
}/*, {
    input,
    plugins: [
        nodeResolve(),
        commonjs(),
        stylesheet({
            extract: true,
            minify: true
        }),
        terser({
            ecma: 6,
            format: {
                preamble: banner
            }
        })
    ],
    output: {
        name: 'Chart',
        file: 'dist/Chart.min.js',
        format: 'umd',
        indent: false,
    },
}*/];
