import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const output = join(root, 'dist', 'server', 'index.js');
const fonts = (await readdir(join(root, 'vendor/katex/fonts'))).map(file => `vendor/katex/fonts/${file}`);
const files = ['index.html', 'app.js', 'runtime.js', 'math.js', 'preparation.js', 'styles.css', 'favicon.svg', 'og.png', 'vendor/katex/katex.min.js', 'vendor/katex/katex.min.css', 'vendor/katex/LICENSE', ...fonts];
const contentTypes = {
  'index.html': 'text/html; charset=utf-8',
  'app.js': 'text/javascript; charset=utf-8',
  'runtime.js': 'text/javascript; charset=utf-8',
  'styles.css': 'text/css; charset=utf-8',
  'favicon.svg': 'image/svg+xml',
  'og.png': 'image/png',
  'vendor/katex/LICENSE': 'text/plain; charset=utf-8',
};

const assets = {};
for (const file of files) {
  assets[file] = (await readFile(join(root, file))).toString('base64');
  contentTypes[file] ||= { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' }[extname(file)];
}

const worker = `const assets = ${JSON.stringify(assets)};
const contentTypes = ${JSON.stringify(contentTypes)};

function decode(base64) {
  const binary = atob(base64);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/goldenbell/run') {
      url.pathname = '/goldenbell/run/';
      return Response.redirect(url.toString(), 302);
    }

    const prefix = '/goldenbell/run/';
    if (!url.pathname.startsWith(prefix)) return new Response('Not found', { status: 404 });
    const name = url.pathname.slice(prefix.length) || 'index.html';
    if (!Object.hasOwn(assets, name)) return new Response('Not found', { status: 404 });

    const headers = new Headers({
      'Content-Type': contentTypes[name],
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': name === 'index.html' ? 'no-store' : 'public, max-age=86400',
    });
    return new Response(decode(assets[name]), { headers });
  },
};
`;

await rm(join(root, 'dist'), { recursive: true, force: true });
await mkdir(dirname(output), { recursive: true });
await writeFile(output, worker);
console.log('Built Sigma Golden Bell worker.');
