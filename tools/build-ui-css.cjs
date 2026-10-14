'use strict';
// Generates extension/ui-css.js from extension/ui.css so Twitch pages can share one constructed stylesheet
// without exposing ui.css as a web-accessible resource. Run after editing ui.css: node tools/build-ui-css.cjs
const fs = require('node:fs');
const path = require('node:path');
const extension = path.resolve(__dirname, '../extension');
const css = fs.readFileSync(path.join(extension, 'ui.css'), 'utf8');
const output = '// Generated from ui.css by tools/build-ui-css.cjs. Edit ui.css, then run: node tools/build-ui-css.cjs\n' +
  'globalThis.TwitchSnoozeCSS = ' + JSON.stringify(css) + ';\n';
const target = path.join(extension, 'ui-css.js');
if (process.argv.includes('--check')) {
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  if (current !== output) { console.error('ui-css.js is out of date. Run: node tools/build-ui-css.cjs'); process.exit(1); }
  console.log('ui-css.js matches ui.css');
} else {
  fs.writeFileSync(target, output);
  console.log('Wrote ' + path.relative(process.cwd(), target) + ' (' + output.length + ' bytes)');
}
