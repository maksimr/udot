#!/usr/bin/env bash
":" //# comment; exec /usr/bin/env node --input-type=module - "$@" < "$0"

import { AsyncLocalStorage } from 'node:async_hooks';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
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
  const baseDir = params.baseDir;
  const homeDir = params.homeDir || process.env.HOME || process.env.USERPROFILE;

  if (!baseDir) throw new Error('--base-dir is required');
  if (!homeDir) throw new Error('--home-dir is required');

  await contextProvider.run({
    dry: params.dry
  }, async () => {
    if (command === 'apply') {
      await apply(baseDir, homeDir);
    } else if (command === 'use') {
      await use(url, baseDir, homeDir);
    } else if (command === 'ls') {
      await ls(baseDir, homeDir);
    } else if (command === 'restore') {
      await restore(homeDir, baseDir);
    } else if (command === 'update') {
      await update(baseDir, homeDir);
    } else {
      console.log(`
      Usage: <dot> <command> [options]

        <dot> apply     --base-dir=<path> --home-dir=<path>
        <dot> ls        --base-dir=<path> --home-dir=<path>
        <dot> restore   --base-dir=<path> --home-dir=<path>
        <dot> update    --base-dir=<path> --home-dir=<path>
        <dot> use <url> --base-dir=<path> --home-dir=<path>
      
      Commands:
        apply     Create symlinks from <base-dir> to <home-dir>
        ls        List of created symlinks
        restore   Remove created symlinks
        update    Save changes and sync with remote repository
        use       Clone repostory from <url> to <base-dir> and apply

      Options:
        --base-dir  Source directory
        --home-dir  Destination directory
        --dry       Don't make real modification, just print what will be done

      ${process.version}
    `)
    }
  });
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

async function restore(/**@type {string}*/homeDir, /**@type {string}*/baseDir) {
  const queue = [baseDir];
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
  return Boolean(getCurrentContext().dry);
}

function mutating(fn) {
  return (...args) => {
    if (isDryrun()) {
      return '';
    }

    return fn(...args);
  };
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
    return str.replace(/-([a-z])/g, (m, c) => c.toUpperCase());
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