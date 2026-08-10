import fs from 'fs';
import path from 'path';

const roots = ['backend/src', 'backend/scripts', 'backend/database', 'frontend/src'];
const extraFiles = ['frontend/vite.config.js', 'backend/eslint.config.mjs'];
const skipDirs = new Set(['node_modules', 'dist', 'coverage', 'test-results', '.git', 'storage']);

const KEEP_LINE =
  /^\s*@(ts-check|ts-ignore|ts-expect-error|ts-nocheck)\b|^\s*eslint-(disable|enable)(-next-line|-line)?\b|^\s*istanbul ignore\b|^\s*prettier-ignore\b|^\s*@__PURE__\b|^\s*@(vitest|jest)-environment\b/;
const KEEP_BLOCK =
  /@(ts-check|ts-ignore|ts-expect-error|ts-nocheck)\b|eslint-(disable|enable)(-next-line|-line)?\b|istanbul ignore\b|prettier-ignore\b|@__PURE__\b|@(vitest|jest)-environment\b/;
const REGEX_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete',
  'void', 'throw', 'do', 'else', 'yield', 'await', 'case', 'default',
]);

function isRegexStart(text, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(text[j])) j--;
  if (j < 0) return true;
  const ch = text[j];
  if (/[A-Za-z0-9_$]/.test(ch)) {
    let k = j;
    while (k >= 0 && /[A-Za-z0-9_$]/.test(text[k])) k--;
    return REGEX_KEYWORDS.has(text.slice(k + 1, j + 1));
  }
  if (ch === ')' || ch === ']' || ch === '}') return false;
  if (ch === '>') return text[j - 1] === '=';
  if (ch === '<') return false;
  return true;
}

function lineStartOf(text, i) {
  let k = i - 1;
  while (k >= 0 && text[k] !== '\n') k--;
  return k + 1;
}

function popWs(out) {
  while (
    out.length &&
    (out[out.length - 1] === ' ' || out[out.length - 1] === '\t' || out[out.length - 1] === '\uFEFF')
  ) out.pop();
}

function endOfLine(text, j) {
  if (j >= text.length) return j;
  if (text[j] === '\r') {
    if (j + 1 < text.length && text[j + 1] === '\n') return j + 2;
    return j + 1;
  }
  return j + 1;
}

function wholeLinePrefix(text, i) {
  return text.slice(lineStartOf(text, i), i).trim() === '';
}

function stripJs(text) {
  const out = [];
  let i = 0;
  const n = text.length;
  let mode = 'code';
  let quote = '';
  const stack = [];
  let exprDepth = 0;
  let removed = 0;
  let rdepth = 0;
  while (i < n) {
    const c = text[i];
    const nx = text[i + 1];
    if (mode === 'code') {
      if (c === '/' && nx === '/') {
        let j = i + 2;
        while (j < n && text[j] !== '\n' && text[j] !== '\r') j++;
        const content = text.slice(i + 2, j);
        if (KEEP_LINE.test(content)) {
          out.push(text.slice(i, j));
          i = j;
        } else {
          removed++;
          if (wholeLinePrefix(text, i)) {
            popWs(out);
            i = endOfLine(text, j);
          } else {
            popWs(out);
            i = j;
          }
        }
      } else if (c === '/' && nx === '*') {
        let j = i + 2;
        let end = -1;
        while (j < n - 1) {
          if (text[j] === '*' && text[j + 1] === '/') { end = j + 2; break; }
          j++;
        }
        if (end === -1) end = n;
        const content = text.slice(i + 2, end - 2);
        if (KEEP_BLOCK.test(content)) {
          out.push(text.slice(i, end));
          i = end;
        } else {
          removed++;
          let k = end;
          while (k < n && (text[k] === ' ' || text[k] === '\t')) k++;
          const suffixWs = k >= n || text[k] === '\n' || text[k] === '\r';
          if (wholeLinePrefix(text, i) && suffixWs) {
            popWs(out);
            i = endOfLine(text, k);
          } else {
            popWs(out);
            i = end;
          }
        }
      } else if (c === '"' || c === "'") {
        quote = c;
        mode = 'sq';
        out.push(c);
        i++;
      } else if (c === '`') {
        stack.push({ retMode: 'code', retExprDepth: exprDepth });
        mode = 'tpl';
        out.push(c);
        i++;
      } else if (c === '{' && exprDepth > 0) {
        exprDepth++;
        out.push(c);
        i++;
      } else if (c === '}' && exprDepth > 0) {
        exprDepth--;
        out.push(c);
        if (exprDepth === 0) {
          const entry = stack.pop();
          mode = entry.retMode;
          exprDepth = entry.retExprDepth;
        }
        i++;
      } else if (c === '/') {
        if (isRegexStart(text, i)) {
          mode = 'regex';
          rdepth = 0;
          out.push(c);
          i++;
        } else {
          out.push(c);
          i++;
        }
      } else {
        out.push(c);
        i++;
      }
    } else if (mode === 'sq') {
      if (c === '\\') {
        out.push(c);
        if (i + 1 < n) { out.push(text[i + 1]); i++; }
        i++;
      } else {
        out.push(c);
        if (c === quote) mode = 'code';
        i++;
      }
    } else if (mode === 'tpl') {
      if (c === '\\') {
        out.push(c);
        if (i + 1 < n) { out.push(text[i + 1]); i++; }
        i++;
      } else if (c === '$' && nx === '{') {
        stack.push({ retMode: 'tpl', retExprDepth: exprDepth });
        mode = 'code';
        exprDepth = 1;
        out.push(c, nx);
        i += 2;
      } else if (c === '`') {
        const entry = stack.pop();
        mode = entry.retMode;
        exprDepth = entry.retExprDepth;
        out.push(c);
        i++;
      } else {
        out.push(c);
        i++;
      }
    } else if (mode === 'regex') {
      if (c === '\\') {
        out.push(c);
        if (i + 1 < n) { out.push(text[i + 1]); i++; }
        i++;
      } else {
        out.push(c);
        if (c === '[') rdepth++;
        else if (c === ']') rdepth = Math.max(0, rdepth - 1);
        else if (c === '/' && rdepth === 0) mode = 'code';
        i++;
      }
    }
  }
  return { text: out.join(''), removed };
}

function stripSql(text) {
  const out = [];
  let i = 0;
  const n = text.length;
  let mode = 'code';
  let removed = 0;
  while (i < n) {
    const c = text[i];
    const nx = text[i + 1];
    if (mode === 'code') {
      if (c === "'") {
        mode = 'sq';
        out.push(c);
        i++;
      } else if (c === '-' && nx === '-') {
        const after = text[i + 2];
        if (
          after === undefined || after === ' ' || after === '\t' ||
          after === '\n' || after === '\r'
        ) {
          let j = i + 2;
          while (j < n && text[j] !== '\n' && text[j] !== '\r') j++;
          removed++;
          if (wholeLinePrefix(text, i)) {
            popWs(out);
            i = endOfLine(text, j);
          } else {
            popWs(out);
            i = j;
          }
        } else {
          out.push(c);
          i++;
        }
      } else if (c === '/' && nx === '*') {
        let j = i + 2;
        let end = -1;
        while (j < n - 1) {
          if (text[j] === '*' && text[j + 1] === '/') { end = j + 2; break; }
          j++;
        }
        if (end === -1) end = n;
        removed++;
        let k = end;
        while (k < n && (text[k] === ' ' || text[k] === '\t')) k++;
        const suffixWs = k >= n || text[k] === '\n' || text[k] === '\r';
        if (wholeLinePrefix(text, i) && suffixWs) {
          popWs(out);
          i = endOfLine(text, k);
        } else {
          popWs(out);
          i = end;
        }
      } else if (c === '#') {
        let j = i + 1;
        while (j < n && text[j] !== '\n' && text[j] !== '\r') j++;
        removed++;
        if (wholeLinePrefix(text, i)) {
          popWs(out);
          i = endOfLine(text, j);
        } else {
          popWs(out);
          i = j;
        }
      } else {
        out.push(c);
        i++;
      }
    } else {
      if (c === "'") {
        out.push(c);
        if (nx === "'") { out.push(nx); i += 2; } else { mode = 'code'; i++; }
      } else {
        out.push(c);
        i++;
      }
    }
  }
  return { text: out.join(''), removed };
}

function stripDbml(text) {
  const out = [];
  let i = 0;
  const n = text.length;
  let mode = 'code';
  let removed = 0;
  while (i < n) {
    const c = text[i];
    const nx = text[i + 1];
    const nnx = text[i + 2];
    if (mode === 'code') {
      if (c === "'" && nx === "'" && nnx === "'") {
        mode = 'tq';
        out.push("'''");
        i += 3;
      } else if (c === "'") {
        mode = 'sq';
        out.push(c);
        i++;
      } else if (c === '/' && nx === '/') {
        let j = i + 2;
        while (j < n && text[j] !== '\n' && text[j] !== '\r') j++;
        removed++;
        if (wholeLinePrefix(text, i)) {
          popWs(out);
          i = endOfLine(text, j);
        } else {
          popWs(out);
          i = j;
        }
      } else if (c === '/' && nx === '*') {
        let j = i + 2;
        let end = -1;
        while (j < n - 1) {
          if (text[j] === '*' && text[j + 1] === '/') { end = j + 2; break; }
          j++;
        }
        if (end === -1) end = n;
        removed++;
        let k = end;
        while (k < n && (text[k] === ' ' || text[k] === '\t')) k++;
        const suffixWs = k >= n || text[k] === '\n' || text[k] === '\r';
        if (wholeLinePrefix(text, i) && suffixWs) {
          popWs(out);
          i = endOfLine(text, k);
        } else {
          popWs(out);
          i = end;
        }
      } else {
        out.push(c);
        i++;
      }
    } else if (mode === 'tq') {
      if (c === "'" && nx === "'" && nnx === "'") {
        mode = 'code';
        out.push("'''");
        i += 3;
      } else {
        out.push(c);
        i++;
      }
    } else {
      if (c === "'") {
        out.push(c);
        mode = 'code';
        i++;
      } else {
        out.push(c);
        i++;
      }
    }
  }
  return { text: out.join(''), removed };
}

function stripPs1(text) {
  const out = [];
  let i = 0;
  const n = text.length;
  let mode = 'code';
  let removed = 0;
  while (i < n) {
    const c = text[i];
    const nx = text[i + 1];
    if (mode === 'code') {
      if (c === "'") { mode = 'sq'; out.push(c); i++; }
      else if (c === '"') { mode = 'dq'; out.push(c); i++; }
      else if (c === '#') {
        let j = i + 1;
        while (j < n && text[j] !== '\n' && text[j] !== '\r') j++;
        removed++;
        if (wholeLinePrefix(text, i)) {
          popWs(out);
          i = endOfLine(text, j);
        } else {
          popWs(out);
          i = j;
        }
      } else { out.push(c); i++; }
    } else if (mode === 'sq') {
      if (c === "'") {
        out.push(c);
        if (nx === "'") { out.push(nx); i += 2; } else { mode = 'code'; i++; }
      } else { out.push(c); i++; }
    } else {
      if (c === '`') {
        out.push(c);
        if (i + 1 < n) { out.push(text[i + 1]); i++; }
        i++;
      } else if (c === '"') { out.push(c); mode = 'code'; i++; }
      else { out.push(c); i++; }
    }
  }
  return { text: out.join(''), removed };
}

function stripHtml(text) {
  const out = [];
  let i = 0;
  const n = text.length;
  let removed = 0;
  while (i < n) {
    const start = text.indexOf('<!--', i);
    if (start === -1) {
      out.push(text.slice(i));
      break;
    }
    out.push(text.slice(i, start));
    const end = text.indexOf('-->', start + 4);
    const blockEnd = end === -1 ? n : end + 3;
    removed++;
    let k = blockEnd;
    while (k < n && (text[k] === ' ' || text[k] === '\t')) k++;
    const suffixWs = k >= n || text[k] === '\n' || text[k] === '\r';
    if (wholeLinePrefix(text, start) && suffixWs) {
      popWs(out);
      i = endOfLine(text, k);
    } else {
      popWs(out);
      i = blockEnd;
    }
  }
  return { text: out.join(''), removed };
}

function walk(dir) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!skipDirs.has(e.name)) out = out.concat(walk(p));
    } else {
      out.push(p);
    }
  }
  return out;
}

const files = [];
for (const r of roots) if (fs.existsSync(r)) files.push(...walk(r));
for (const e of extraFiles) if (fs.existsSync(e)) files.push(e);

const stripByExt = {
  '.ts': stripJs, '.tsx': stripJs, '.js': stripJs, '.jsx': stripJs,
  '.mjs': stripJs, '.cjs': stripJs,
  '.sql': stripSql,
  '.dbml': stripDbml,
  '.ps1': stripPs1,
  '.html': stripHtml,
};

let scanned = 0;
let changed = 0;
const report = [];
const onlyFile = process.env.STRIP_ONLY;
for (const f of files) {
  const ext = path.extname(f).toLowerCase();
  const strip = stripByExt[ext];
  if (!strip) continue;
  if (onlyFile && !f.includes(onlyFile)) continue;
  scanned++;
  const original = fs.readFileSync(f, 'utf8');
  const { text, removed } = strip(original);
  if (removed === 0) continue;
  changed++;
  report.push([f, removed]);
  fs.writeFileSync(f, text);
}

report.sort((a, b) => b[1] - a[1]);
console.log('Fichiers scannés :', scanned);
console.log('Fichiers modifiés :', changed);
console.log('Détail :');
for (const [f, r] of report) {
  console.log(String(r).padStart(4), f);
}
