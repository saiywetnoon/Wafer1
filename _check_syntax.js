/* Dev tool: syntax-check every app JS file (classic scripts — construct each in
   a Function scope so both module wrappers and top-level scripts validate).
   Usage: node _check_syntax.js */
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'js');
const files = fs.readdirSync(dir).filter(function (f) { return f.endsWith('.js'); }).sort();
let fail = 0;
files.forEach(function (file) {
  try {
    new Function(fs.readFileSync(path.join(dir, file), 'utf8'));
    console.log('  OK ' + file);
  } catch (e) {
    fail++;
    console.log('  FAIL ' + file + ' — ' + String(e.message).split('\n')[0]);
  }
});
console.log(fail === 0
  ? 'ALL ' + files.length + ' JS FILES OK'
  : fail + ' FILE(S) FAILED SYNTAX');
process.exit(fail === 0 ? 0 : 1);