#!/usr/bin/env node
// What the release workflow says about the files running apps update from.
//
//   release-files.mjs platform --target darwin-aarch64 --file <asset name> --signature <.sig file> --version 3.0.0
//       prints one platform's entry of latest.json
//   release-files.mjs latest --version 3.0.0 --from <directory of *.platform.json>
//       writes <directory>/latest.json from every entry found there, none when there is no entry
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const REPOSITORY = process.env.GITHUB_REPOSITORY ?? 'gtanczyk/genaicode';

function checked(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error(`Not a version: ${version}`);
  return version;
}

export function platform({ target, file, signature, version }) {
  if (!target || !file || !signature) throw new Error('platform takes --target, --file and --signature');
  return {
    target,
    signature,
    url: `https://github.com/${REPOSITORY}/releases/download/v${checked(version)}/${file}`,
  };
}

export function latest(version, entries, now = new Date()) {
  const platforms = {};
  for (const { target, signature, url } of entries) platforms[target] = { signature, url };
  return { version: checked(version), pub_date: now.toISOString(), platforms };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      target: { type: 'string' },
      file: { type: 'string' },
      signature: { type: 'string' },
      version: { type: 'string' },
      from: { type: 'string' },
    },
  });
  if (positionals[0] === 'platform') {
    const signature = readFileSync(values.signature, 'utf8').trim();
    process.stdout.write(`${JSON.stringify(platform({ ...values, signature }), null, 2)}\n`);
  } else if (positionals[0] === 'latest') {
    const entries = readdirSync(values.from)
      .filter((name) => name.endsWith('.platform.json'))
      .sort()
      .map((name) => JSON.parse(readFileSync(join(values.from, name), 'utf8')));
    if (entries.length) {
      writeFileSync(join(values.from, 'latest.json'), `${JSON.stringify(latest(values.version, entries), null, 2)}\n`);
      console.log(`latest.json: ${entries.map((entry) => entry.target).join(', ')}`);
    } else console.log('No platform has an update archive: no latest.json.');
  } else throw new Error('release-files.mjs platform|latest');
}
