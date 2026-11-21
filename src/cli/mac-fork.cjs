// Darwin Seatbelt keeps the test's process group fixed. Node can still start ordinary
// children with fork/exec by asking libuv to preserve the current user explicitly.
const childProcess = require('node:child_process');
const { syncBuiltinESMExports } = require('node:module');

function forkOptions(options) {
  return { ...options, uid: options?.uid ?? process.getuid() };
}

const spawn = childProcess.ChildProcess.prototype.spawn;
childProcess.ChildProcess.prototype.spawn = function (options) {
  return spawn.call(this, forkOptions(options));
};

for (const name of ['spawnSync', 'execFileSync']) {
  const original = childProcess[name];
  childProcess[name] = (file, args, options) =>
    Array.isArray(args) ? original(file, args, forkOptions(options)) : original(file, forkOptions(args ?? options));
}
const execSync = childProcess.execSync;
childProcess.execSync = (command, options) => execSync(command, forkOptions(options));
syncBuiltinESMExports();
