import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import copy from 'rollup-plugin-copy';
import replace from '@rollup/plugin-replace';
import image from '@rollup/plugin-image';
import { readFileSync } from 'fs';

const isDev = process.env.NODE_ENV === 'development';

export default {
  input: 'src/main.js',
  output: {
    file: 'dist/main.js',
    format: 'iife',
    name: 'LeboncoinRepublish',
    sourcemap: true
  },
  plugins: [
    image(),
    replace({
      'process.env.VERSION': JSON.stringify(JSON.parse(readFileSync('package.json', 'utf8')).version),
      preventAssignment: true
    }),
    nodeResolve({
      browser: true,
      preferBuiltins: false
    }),
    commonjs(),
    ...(isDev ? [] : [
      terser({
        compress: {
          drop_console: true,
          drop_debugger: true
        }
      })
    ]),
    copy({
      targets: [
        { src: 'src/popup.html', dest: 'dist' },
        { src: 'src/popup.css', dest: 'dist' },
        { src: 'src/popup.js', dest: 'dist' },
        {
          src: 'manifest.json',
          dest: 'dist',
          transform: (contents) => {
            const manifest = JSON.parse(contents.toString());
            // Remove 'dist/' prefix from paths when manifest is in dist folder
            if (manifest.action?.default_popup) {
              manifest.action.default_popup = manifest.action.default_popup.replace(/^dist\//, '');
            }
            if (manifest.content_scripts) {
              manifest.content_scripts.forEach(script => {
                if (script.js) {
                  script.js = script.js.map(path => path.replace(/^dist\//, ''));
                }
              });
            }
            return JSON.stringify(manifest, null, 2);
          }
        },
        { src: 'icons', dest: 'dist' }
      ]
    })
  ],
  external: []
};
