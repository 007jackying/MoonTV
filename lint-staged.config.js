// lint-staged config. Lives here rather than in package.json because the
// build-output filter below needs a function.
//
// public/sw.js and public/workbox-*.js are minified service-worker output that
// next-pwa rewrites on every `next build`. Both are tracked, so after a local
// build `git commit -a` stages them, and eslint fails on the minified worker
// (`importScripts` / `define` are not defined). `.eslintignore` cannot help:
// ESLint 8 reports an explicitly passed ignored file as a warning, which
// `--max-warnings=0` turns into a failure. So they are filtered out here.
const isBuildOutput = (f) =>
  /[\\/]public[\\/](sw|workbox-[^\\/]+)\.js$/.test(f);
const quote = (files) => files.map((f) => JSON.stringify(f)).join(' ');

module.exports = {
  '**/*.{js,jsx,ts,tsx}': (files) => {
    const src = files.filter((f) => !isBuildOutput(f));
    return src.length
      ? [`eslint --max-warnings=0 ${quote(src)}`, `prettier -w ${quote(src)}`]
      : [];
  },
  '**/*.{json,css,scss,md,webmanifest}': (files) =>
    `prettier -w ${quote(files)}`,
};
