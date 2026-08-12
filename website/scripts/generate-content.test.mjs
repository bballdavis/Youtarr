import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {manifest} from './manifest.mjs';
import {rewriteLinks, assertManifest, generate} from './generate-content.mjs';

test('manifest has unique ids and slugs', () => { assert.equal(new Set(manifest.map((x) => x.id)).size, manifest.length); assert.equal(new Set(manifest.map((x) => x.slug)).size, manifest.length); });
test('canonical corpus covers every public source exactly once', () => { for (const source of ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CHANGELOG.md', 'LICENSE.md', 'CONTRIBUTORS.md']) assert.ok(manifest.some((item) => item.source === source)); assert.ok(manifest.some((item) => item.source.endsWith('YOUTARR_DOWNLOADS_FOLDER_STRUCTURE.md'))); assert.equal(manifest.length, 29); });
test('manifest sources are relative and safe', () => manifest.forEach((x) => { assert.ok(!x.source.startsWith('/')); assert.ok(!x.source.includes('..')); }));
test('manifest validation rejects missing, duplicate, and unsafe entries', () => {
  assert.throws(() => assertManifest([{id:'x', slug:'x', source:'missing.md'}]), /missing source/);
  assert.throws(() => assertManifest([{id:'x', slug:'x', source:'README.md'}, {id:'x', slug:'y', source:'README.md'}]), /duplicate/);
  assert.throws(() => assertManifest([{id:'x', slug:'x', source:'README.md'}, {id:'y', slug:'x', source:'README.md'}]), /duplicate/);
  assert.throws(() => assertManifest([{id:'../x', slug:'x', source:'README.md'}]), /unsafe/);
  assert.throws(() => assertManifest([{id:'x', slug:'bad_slug', source:'README.md'}]), /unsafe/);
  assert.throws(() => assertManifest([{id:'x', slug:'x', source:'../README.md'}]), /unsafe/);
});
test('links rewrite with anchors and reject unresolved markdown/assets', () => { const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'youtarr-docs-')); fs.mkdirSync(path.join(tmp, 'docs')); fs.writeFileSync(path.join(tmp, 'docs', 'a.md'), '[B](b.md#part)'); fs.writeFileSync(path.join(tmp, 'docs', 'b.md'), '# B'); const routes = new Map([['a.md', 'a'], ['b.md', 'b']]); assert.match(rewriteLinks('[B](b.md#part)', 'a.md', routes, tmp), /\/docs\/b#part/); assert.throws(() => rewriteLinks('[X](missing.md)', 'a.md', routes, tmp), /unresolved canonical link/); assert.throws(() => rewriteLinks('![x](missing.png)', 'a.md', routes, tmp), /unresolved relative asset/); });
test('safe MDX preserves intentional HTML, inline code, and escapes placeholders/braces', () => { const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'youtarr-html-')); fs.writeFileSync(path.join(tmp, 'a.md'), '<details><summary>More</summary><img src="x.png" /></details>\nUse <YOUR_PATH> and {unsafe}; run `${YOUTUBE_OUTPUT_DIR}` and `echo {VALUE}`'); const routes = new Map([['a.md', 'a']]); const output = rewriteLinks(fs.readFileSync(path.join(tmp, 'a.md'), 'utf8'), 'a.md', routes, tmp); assert.match(output, /<details><summary>More<\/summary><img src="x\.png" \/><\/details>/); assert.match(output, /&lt;YOUR_PATH&gt;/); assert.match(output, /&amp;#123;|&#123;/); assert.match(output, /`\$\{YOUTUBE_OUTPUT_DIR\}`/); assert.match(output, /`echo \{VALUE\}`/); });
test('generated OpenAPI is nonempty and representative quick-start is complete', () => { const spec = JSON.parse(fs.readFileSync(new URL('../.generated/static/openapi/youtarr.openapi.json', import.meta.url))); assert.ok(Object.keys(spec.paths).length); const quick = fs.readFileSync(new URL('../.generated/docs/quick-start.md', import.meta.url), 'utf8'); for (const script of ['start.sh', 'start-with-external-db.sh', 'scripts/start-dev.sh', 'scripts/start-dev-external-db.sh']) assert.match(quick, new RegExp(script.replaceAll('.', '\\.'))); assert.match(quick, /DB_HOST.*DB_USER.*DB_PASSWORD/s); });
test('generator accepts injected output and applies OpenAPI security inheritance', async () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'youtarr-generated-'));
  await generate({
    root: path.resolve(new URL('../..', import.meta.url).pathname),
    outputRoot,
    swaggerSpec: {
      openapi: '3.0.0',
      info: {title: 'Fixture', version: '1.0.0'},
      security: [{ApiKeyAuth: []}],
      paths: {
        '/inherited': {get: {summary: 'Inherited'}},
        '/public': {get: {summary: 'Public', security: []}},
        '/explicit': {get: {summary: 'Explicit', security: [{SessionAuth: []}]}},
      },
    },
  });
  assert.ok(fs.existsSync(path.join(outputRoot, 'docs/quick-start.md')));
  assert.match(fs.readFileSync(path.join(outputRoot, 'static/openapi/youtarr.openapi.json'), 'utf8'), /Fixture/);
  const api = fs.readFileSync(path.join(outputRoot, 'docs/api.md'), 'utf8');
  assert.match(api, /\| GET \| \/inherited \| Inherited \| Yes \|/);
  assert.match(api, /\| GET \| \/public \| Public \| No \|/);
  assert.match(api, /\| GET \| \/explicit \| Explicit \| Yes \|/);
});
