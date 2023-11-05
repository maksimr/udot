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

  await contextProvider.run({
    dryRun: params.dryRun,
    modulePath: params.modulePath
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

        ${cmd} apply          --base-dir=<path> --home-dir=<path>
        ${cmd} ls             --base-dir=<path> --home-dir=<path>
        ${cmd} restore        --base-dir=<path> --home-dir=<path>
        ${cmd} restore <path> --base-dir=<path> --home-dir=<path>
        ${cmd} update         --base-dir=<path> --home-dir=<path>
        ${cmd} use <url>      --base-dir=<path> --home-dir=<path>
        ${cmd} install        --module-path=<path> --module-url=<url>

      Commands
        apply     Create symlinks from <base-dir> to <home-dir>
        ls        List of created symlinks
        restore   Remove created symlinks
        update    Save changes and sync with remote repository
        use       Clone repostory from <url> to <base-dir> and apply
        install   Install or upgrade "${cmd}" to the latest version

      Options
        --base-dir     Source directory. By default "~/.dotfiles"
        --home-dir     Destination directory. By default "~"
        --module-path  Path to "${cmd}" module
        --module-url   URL to "${cmd}" module
        --dry-run      Don't make real modification, just print what will be done

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
  const queue = [baseDir];

  if (!fs.existsSync(homeDir)) {
    mutating(fs.mkdirSync)(homeDir);
  }

  while (queue.length > 0) {
    const dir = queue.shift();
    const files = fs.readdirSync(dir, { withFileTypes: true });
    for (const file of files) {
      if (isIgnored(file.name)) {
        continue;
      }

      const source = path.join(dir, file.name);
      const target = path.join(homeDir, path.relative(baseDir, source));

      if (file.isFile() && !fs.existsSync(target)) {
        console.log(`${green('+')} ${target} -> ${source}`);
        mutating(fs.symlinkSync)(source, target);
      } else if (file.isDirectory()) {
        if (!fs.existsSync(target)) {
          mutating(fs.mkdirSync)(target);
        }
        queue.push(source);
      }
    }
  }
}

async function ls(/**@type {string}*/baseDir, /**@type {string}*/homeDir) {
  const queue = [baseDir];

  if (!fs.existsSync(homeDir) || !fs.existsSync(baseDir)) {
    return;
  }

  while (queue.length > 0) {
    const dir = queue.shift();
    const files = fs.readdirSync(dir, { withFileTypes: true });
    for (const file of files) {
      if (isIgnored(file.name)) {
        continue;
      }

      const source = path.join(dir, file.name);
      const target = path.join(homeDir, path.relative(baseDir, source));
      if (file.isFile() && fs.existsSync(target)) {
        if (isSymbolicLinkFrom(target, baseDir)) {
          console.log(`${green('⊙')} ${target} -> ${source}`);
        } else {
          console.log(`${yellow('○')} ${target}`);
        }
      } else if (file.isDirectory()) {
        queue.push(source);
      }
    }
  }
}

async function restore(/**@type {string}*/homeDir, /**@type {string}*/baseDir, /**@type {string|undefined}*/filePath) {
  const queue = [];

  if (filePath) {
    const file = fs.lstatSync(filePath);
    if (file.isSymbolicLink()) {
      const target = filePath;
      console.log(`${red('-')} ${target}`);
      mutating(fs.unlinkSync)(target);
      return;
    }

    if (!file.isDirectory()) {
      return;
    }

    queue.push(filePath);
  } else {
    queue.push(baseDir);
  }

  while (queue.length > 0) {
    const dir = queue.shift();
    const files = fs.readdirSync(dir, { withFileTypes: true });
    for (const file of files) {
      const source = path.join(dir, file.name);
      const target = path.join(homeDir, path.relative(baseDir, source));
      if (file.isFile() && isSymbolicLinkFrom(target, baseDir)) {
        console.log(`${red('-')} ${target}`);
        mutating(fs.unlinkSync)(target);
      } else if (file.isDirectory()) {
        queue.push(source);
      }
    }

    const targetDir = path.join(homeDir, path.relative(baseDir, dir));
    if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length === 0 && targetDir !== homeDir) {
      mutating(fs.rmdirSync)(targetDir);
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

function isIgnored(/**@type {string}*/name) {
  return [
    '.git',
    '.gitignore',
    '.vscode',
    '.DS_Store',
    'README.md',
    'node_modules',
    'package-lock.json',
    'package.json',
    'yarn.lock'
  ].includes(name);
}

function isSymbolicLinkFrom(/**@type {string}*/target, /**@type {string}*/baseDir) {
  return isSymbolicLinkExists(target) && fs.readlinkSync(target).startsWith(baseDir);
}

function isSymbolicLinkExists(/**@type {string}*/target) {
  try {
    return fs.lstatSync(target).isSymbolicLink();
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
  return `\x1b[31m${str}\x1b[0m`;
}

function green(/**@type {string}*/str) {
  return `\x1b[32m${str}\x1b[0m`;
}

function yellow(/**@type {string}*/str) {
  return `\x1b[33m${str}\x1b[0m`;
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

  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      const camelCaseKey = toCamelCase(key);

      parsed[camelCaseKey] = value || true;
    } else if (arg.startsWith('-')) {
      const [key, value] = arg.slice(1).split('=');
      const camelCaseKey = toCamelCase(key);

      parsed[camelCaseKey] = value || true;
    } else {
      parsed._.push(arg);
    }
  }

  return parsed;
}