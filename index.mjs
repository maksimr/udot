#!/usr/bin/env bash
":" //# comment; exec /usr/bin/env node --input-type=module - --module-path="$0" "$@" < "$0"

import { AsyncLocalStorage } from 'node:async_hooks';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const contextProvider = new AsyncLocalStorage();

if (
  !import.meta.url ||
  // Allow to use esm as a stand alone script without extension and package.json
  // https://stackoverflow.com/questions/48179714/how-can-an-es6-module-be-run-as-a-script-in-node
  import.meta.url.indexOf('[eval') !== -1 ||
  (
    import.meta.url &&
    import.meta.url.startsWith('file:') &&
    fileURLToPath(import.meta.url) === process.argv[1])
) {
  exec().catch((error) => {
    if (error.message) {
      console.error(bold(error.message));
      if (error.stack) {
        console.error();
        console.error(error.stack);
      }
    } else {
      console.error(error);
    }
  });
}

export async function exec(/**@type {string[]}*/argv = process.argv.slice(2)) {
  const { _: [command, url], ...params } = parseArgv(argv);
  let baseDir = params.baseDir || path.join(os.homedir(), '.dotfiles');
  let homeDir = params.homeDir || process.env.HOME || process.env.USERPROFILE;

  if (!baseDir) throw new Error('--base-dir is required');
  if (!homeDir) throw new Error('--home-dir is required');

  baseDir = tildeExpansion(baseDir);
  homeDir = tildeExpansion(homeDir);
  const DEFAULT_EXCLUDES_FILE = path.join(baseDir, '.dotignore');

  await contextProvider.run({
    dryRun: params.dryRun,
    modulePath: params.modulePath,
    exclude: [].concat(params.exclude || []),
    excludesFile: params.excludesFile || DEFAULT_EXCLUDES_FILE
  }, async () => {
    if (command === 'apply') {
      await apply(baseDir, homeDir);
    } else if (command === 'use') {
      await use(url, baseDir, homeDir);
    } else if (command === 'ls') {
      await ls(baseDir, homeDir);
    } else if (command === 'restore') {
      await restore(homeDir, baseDir, url);
    } else if (command === 'update') {
      await update(baseDir, homeDir);
    } else if (command === 'install') {
      await install(params.moduleUrl);
    } else {
      const cmd = path.basename(getCurrentContext().modulePath || '<dot>');
      console.log(supertrim(`
      Usage: ${cmd} <command> [options]

        ${cmd} apply          --base-dir=<path> --home-dir=<path> [--exclude=<path1> --exclude=<path2>]
        ${cmd} ls             --base-dir=<path> --home-dir=<path>
        ${cmd} restore        --base-dir=<path> --home-dir=<path>
        ${cmd} restore <path> --base-dir=<path> --home-dir=<path>
        ${cmd} update         --base-dir=<path> --home-dir=<path>
        ${cmd} use <url>      --base-dir=<path> --home-dir=<path> [--exclude=<path1> --exclude=<path2>]
        ${cmd} install        --module-path=<path> --module-url=<url>

      Commands
        apply     Create symlinks from <base-dir> to <home-dir>
        ls        List of created symlinks
        restore   Remove created symlinks
        update    Save changes and sync with remote repository
        use       Clone repostory from <url> to <base-dir> and apply
        install   Install or upgrade "${cmd}" to the latest version

      Options
        --base-dir       Source directory. By default "~/.dotfiles"
        --home-dir       Destination directory. By default "~"
        --module-path    Path to "${cmd}" module
        --module-url     URL to "${cmd}" module
        --dry-run        Don't make real modification, just print what will be done
        --exclude        Exclude files or directories from processing
        --excludes-file  Path to file with exclude patterns. By default "${DEFAULT_EXCLUDES_FILE}"

      ${process.version} ${process.platform} ${process.arch} ${process.env.SHELL}
    `))
    }
  });
}

async function install(url = 'https://raw.github.com/maksimr/udot/main/index.mjs') {
  const modulePath = (import.meta.url && fileURLToPath(import.meta.url)) || getCurrentContext().modulePath;

  if (!modulePath) {
    return;
  }

  mutating(execSync)(`curl -sL ${url} --output ${modulePath}`);
  mutating(execSync)(`chmod +x ${modulePath}`);

  console.log(`${green('✓')} sucessfully installed "${modulePath}" from "${url}"`);
}

async function apply(/**@type {string}*/baseDir, /**@type {string}*/homeDir) {
  if (!await isExists(homeDir)) {
    await mutating(fs.promises.mkdir)(homeDir);
  }

  const isIgnored = await getIgnoreFunction();
  await processDir(baseDir);

  async function processDir(/**@type {string}*/dir) {
    const files = await fs.promises.readdir(dir, { withFileTypes: true });
    await Promise.all(
      files.map(async (file) => {
        if (isIgnored(file.name)) {
          return;
        }

        const source = path.join(dir, file.name);
        const target = path.join(homeDir, path.relative(baseDir, source));

        if (file.isFile() && !(await isExists(target))) {
          console.log(`${green('+')} ${target} -> ${source}`);
          await mutating(fs.promises.symlink)(source, target);
        } else if (file.isDirectory()) {
          if (!(await isExists(target))) {
            await mutating(fs.promises.mkdir)(target);
          }
          await processDir(source);
        }
      })
    );
  }
}

async function ls(/**@type {string}*/baseDir, /**@type {string}*/homeDir) {
  if (!await isExists(homeDir) || !await isExists(baseDir)) {
    return;
  }

  const isIgnored = await getIgnoreFunction();
  await processDir(baseDir);

  async function processDir(/**@type {string}*/dir) {
    const files = await fs.promises.readdir(dir, { withFileTypes: true });
    await Promise.all(
      files.map(async (file) => {
        if (isIgnored(file.name)) {
          return;
        }

        const source = path.join(dir, file.name);
        const target = path.join(homeDir, path.relative(baseDir, source));

        if (file.isFile() && await isExists(target)) {
          if (await isSymbolicLinkFrom(target, baseDir)) {
            console.log(`${green('⊙')} ${target} -> ${source}`);
          } else {
            console.log(`${yellow('○')} ${target}`);
          }
        } else if (file.isDirectory()) {
          await processDir(source);
        }
      })
    );
  }
}

async function restore(/**@type {string}*/homeDir, /**@type {string}*/baseDir, /**@type {string|undefined}*/filePath) {
  if (filePath) {
    const file = await fs.promises.lstat(filePath);
    if (file.isSymbolicLink()) {
      const target = filePath;
      console.log(`${red('-')} ${target}`);
      await mutating(fs.promises.unlink)(target);
      return;
    }

    if (!file.isDirectory()) {
      return;
    }

    await processDir(filePath);
  } else {
    await processDir(baseDir);
  }

  async function processDir(/**@type {string}*/dir) {
    const files = await fs.promises.readdir(dir, { withFileTypes: true });
    await Promise.all(
      files.map(async (file) => {
        const source = path.join(dir, file.name);
        const target = path.join(homeDir, path.relative(baseDir, source));
        if (file.isFile() && await isSymbolicLinkFrom(target, baseDir)) {
          console.log(`${red('-')} ${target}`);
          await mutating(fs.promises.unlink)(target);
        } else if (file.isDirectory()) {
          await processDir(source);
        }
      })
    );

    const targetDir = path.join(homeDir, path.relative(baseDir, dir));
    if (await isExists(targetDir) && (await fs.promises.readdir(targetDir)).length === 0 && targetDir !== homeDir) {
      await mutating(fs.promises.rmdir)(targetDir);
    }
  }
}

async function use(/**@type {string}*/url, /**@type {string}*/baseDir, /**@type {string}*/homeDir) {
  try {
    if (!fs.existsSync(baseDir)) {
      mutating(execSync)(`git clone ${url} ${baseDir}`);
    }
    await apply(baseDir, homeDir);
  } catch (e) {
    console.error(e.message || e);
    process.exit(e.exitCode || 1);
  }
}

async function update(/**@type {string}*/baseDir, /**@type {string}*/homeDir) {
  await push(baseDir);
  await pull(baseDir);
  await apply(baseDir, homeDir);
}

async function push(/**@type {string}*/baseDir) {
  try {
    const output = execSync('git status --porcelain', { cwd: baseDir }).toString().trim();

    if (output === '') {
      return;
    }

    const message = output;
    mutating(execSync)('git add -A', { cwd: baseDir });
    mutating(execSync)(`git commit -m "${message}"`, { cwd: baseDir });
    mutating(execSync)('git push --set-upstream origin main --progress', { cwd: baseDir });
  } catch (e) {
    console.error(e.message || e);
    process.exit(e.exitCode || 1);
  }
}

async function pull(/**@type {string}*/cwd) {
  try {
    const output = execSync('git pull --progress', { cwd }).toString().trim();
    console.log(output);
  } catch (e) {
    console.error(e.message || e);
    process.exit(e.exitCode || 1);
  }
}

async function getIgnoreFunction() {
  const ignoreFilePath = getCurrentContext().excludesFile;
  const ignorePatterns = await isExists(ignoreFilePath) ?
    (await fs.promises.readFile(ignoreFilePath, 'utf8'))
      .split('\n').map((line) => line.trim()).filter((line) => line !== '') :
    [
      '.gitignore',
      '.vscode',
      '.DS_Store',
      'node_modules',
      'package-lock.json',
      'package.json'
    ];

  const exclude = getCurrentContext().exclude;
  ignorePatterns.push('.git');
  ignorePatterns.push('README.md');
  ignorePatterns.push(...exclude);

  const ignoreRegExps = ignorePatterns.map((ignorePatter) => {
    const pattern = ignorePatter.replace(/\/$/, '');
    const regexp = new RegExp(`^${pattern.replace(/\./g, '\\.').replace(/\*/g, '.*')}$`);
    return regexp;
  });

  return (/**@type {string}*/name) => {
    return ignoreRegExps.some((regexp) => {
      return regexp.test(name);
    });
  }
}

function isExists(/**@type {string}*/fpath) {
  return fs.promises.access(fpath)
    .then(() => true)
    .catch(() => false);
}

async function isSymbolicLinkFrom(/**@type {string}*/target, /**@type {string}*/baseDir) {
  return await isSymbolicLinkExists(target) &&
    (await fs.promises.readlink(target)).startsWith(baseDir);
}

async function isSymbolicLinkExists(/**@type {string}*/target) {
  try {
    const result = await fs.promises.lstat(target);
    return result.isSymbolicLink();
  } catch (_) {
    return false;
  }
}

function getCurrentContext() {
  return contextProvider.getStore() || {};
}

function isDryrun() {
  return Boolean(getCurrentContext().dryRun);
}

function mutating(fn) {
  return (...args) => {
    if (isDryrun()) {
      return '';
    }

    return fn(...args);
  };
}

function supertrim(/**@type {string}*/str) {
  str = str.replace(/^\n+/, '');
  const indent = str.match(/^\s+/);
  if (indent) {
    str = str.replace(new RegExp(`^${indent[0]}`, 'gm'), '');
  }
  return str.trimEnd();
}

// https://github.com/nodejs/node/issues/684
function tildeExpansion(/**@type {string}*/str) {
  if (str.startsWith('~')) {
    return str.replace('~', os.homedir());
  }
  return str;
}

function bold(/**@type {string}*/str) {
  return `\u001b[1m${str}\u001b[0m`;
}

function red(/**@type {string}*/str) {
  return colorText(str, '31');
}

function green(/**@type {string}*/str) {
  return colorText(str, '32');
}

function yellow(/**@type {string}*/str) {
  return colorText(str, '33');
}

function colorText(/**@type {string}*/str, /**@type {string}*/color) {
  return `\x1b[${color}m${str}\x1b[0m`;
}

/**
 * @template {{_: string[]}} T
 * @param {string[]} argv
 * @returns {Partial<T>}
 */
function parseArgv(/**@type {string[]}*/argv) {
  /**@type {T}*/
  const parsed = { _: [] };
  const toCamelCase = (/**@type {string}*/str) => {
    return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  }
  const addOption = (/**@type {string}*/key, /**@type {string}*/value) => {
    const camelCaseKey = toCamelCase(key);
    if (parsed[camelCaseKey] && value) {
      parsed[camelCaseKey] = Array.isArray(parsed[camelCaseKey]) ?
        [...parsed[camelCaseKey], value || true] :
        [parsed[camelCaseKey], value || true];
    } else {
      parsed[camelCaseKey] = value || true;
    }
  }

  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      addOption(key, value);
    } else if (arg.startsWith('-')) {
      const [key, value] = arg.slice(1).split('=');
      addOption(key, value);
    } else {
      parsed._.push(arg);
    }
  }

  return parsed;
}
