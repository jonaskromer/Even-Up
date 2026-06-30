/**
 * Reads the built index.html, computes SHA-256 hashes for every inline <script>
 * block (those without a src attribute), then writes nginx.conf with the
 * CSP_SCRIPT_HASHES placeholder replaced by the exact hash list.
 *
 * Run after `vite build`, from the apps/web working directory.
 */
import { readFileSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';

const html = readFileSync('build/client/index.html', 'utf8');

// Match <script> tags that have no src= attribute (i.e. inline scripts)
const inlineScriptRe = /<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/gi;
const hashes = [...html.matchAll(inlineScriptRe)]
  .map((m) => m[1])
  .filter((content) => content.trim().length > 0)
  .map((content) => {
    const hash = createHash('sha256').update(content).digest('base64');
    return `'sha256-${hash}'`;
  });

if (hashes.length === 0) {
  console.warn('inject-csp-hashes: no inline scripts found in index.html');
}

const directive = hashes.join(' ');
console.log(`inject-csp-hashes: ${hashes.length} hash(es) → ${directive}`);

const conf = readFileSync('nginx.conf', 'utf8').replaceAll('CSP_SCRIPT_HASHES', directive);
writeFileSync('/tmp/nginx_final.conf', conf);
