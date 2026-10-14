'use strict';
// Builds extension/_locales/<language>/messages.json from tools/messages.cjs, and checks every
// language has every message with the same {placeholders}. Run: node tools/build-locales.cjs [--check]
const fs = require('node:fs');
const path = require('node:path');
const { languages, messages } = require('./messages.cjs');
const root = path.resolve(__dirname, '../extension/_locales');
const problems = [];
const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join(',');
for (const [key, values] of Object.entries(messages)) {
  if (!/^[A-Za-z0-9_]+$/.test(key)) problems.push(`${key}: invalid key name`);
  if (!Array.isArray(values) || values.length !== languages.length) { problems.push(`${key}: needs ${languages.length} translations`); continue; }
  values.forEach((value, index) => {
    if (typeof value !== 'string' || !value.trim()) problems.push(`${key} [${languages[index]}]: empty`);
    else if (placeholders(value) !== placeholders(values[0])) problems.push(`${key} [${languages[index]}]: placeholders {${placeholders(value)}} differ from English {${placeholders(values[0])}}`);
  });
}
const limits = { extName: 75, extDescription: 132 };
for (const [key, limit] of Object.entries(limits)) messages[key].forEach((value, index) => { if ([...value].length > limit) problems.push(`${key} [${languages[index]}]: ${[...value].length} characters, store limit is ${limit}`); });
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
const outputs = languages.map((language, index) => {
  const json = {};
  for (const [key, values] of Object.entries(messages)) json[key] = { message: values[index].replace(/\$/g, '$$$$') };
  return [path.join(root, language, 'messages.json'), JSON.stringify(json, null, 2) + '\n'];
});
if (process.argv.includes('--check')) {
  const stale = outputs.filter(([file, text]) => !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text);
  if (stale.length) { console.error('Out of date: ' + stale.map(([file]) => path.relative(process.cwd(), file)).join(', ') + '. Run: node tools/build-locales.cjs'); process.exit(1); }
  console.log(`_locales match tools/messages.cjs (${languages.length} languages, ${Object.keys(messages).length} messages)`);
} else {
  for (const [file, text] of outputs) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
  console.log(`Wrote ${languages.length} languages, ${Object.keys(messages).length} messages each`);
}
