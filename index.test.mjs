import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import mock from 'mock-fs';
import { exec } from './index.mjs';

describe('main', () => {
  afterEach(mock.restore);

  it('should create symlink on files', async () => {
    mock({
      'src': {
        'file1.txt': 'file1',
        'file2.txt': 'file2'
      },
      'dest': {}
    });

    await exec('apply --base-dir=src --home-dir=dest'.split(' '));

    assert.deepEqual(readdirSync('dest'), ['file1.txt', 'file2.txt']);
  });

  it('should create symlink on files in nested directory', async () => {
    mock({
      'src': {
        'dir1': {
          'file1.txt': 'file1',
          'file2.txt': 'file2'
        }
      },
      'dest': {}
    });

    await exec('apply --base-dir=src --home-dir=dest'.split(' '));

    assert.deepEqual(readdirSync('dest'), ['dir1']);
    assert.deepEqual(readdirSync('dest/dir1'), ['file1.txt', 'file2.txt']);
  });

  it('should not create symlink if file already exits', async () => {
    mock({
      'src': {
        'file1.txt': 'file1'
      },
      'dest': {
        'file1.txt': 'destfile1'
      }
    });

    await exec('apply --base-dir=src --home-dir=dest'.split(' '));

    assert.deepEqual(readFileSync('dest/file1.txt').toString(), 'destfile1');
  });

  it('should remove created symlinks', async () => {
    mock({
      'src': {
        'file1.txt': 'file1',
        'file2.txt': 'file2'
      },
      'dest': {}
    });

    await exec('apply --base-dir=src --home-dir=dest'.split(' '));
    await exec('restore --base-dir=src --home-dir=dest'.split(' '));

    assert.deepEqual(readdirSync('dest'), []);
  });

  it('should remove created symlinks with nested directory', async () => {
    mock({
      'src': {
        'dir1': {
          'file1.txt': 'file1',
          'file2.txt': 'file2'
        }
      },
      'dest': {}
    });

    await exec('apply --base-dir=src --home-dir=dest'.split(' '));
    await exec('restore --base-dir=src --home-dir=dest'.split(' '));

    assert.deepEqual(readdirSync('dest'), []);
  });

  it('should not remove directory if it contains other files', async () => {
    mock({
      'src': {
        'dir1': {
          'file1.txt': 'file1'
        }
      },
      'dest': {
        'dir1': {
          'file2.txt': 'file2'
        }
      }
    });

    await exec('apply --base-dir=src --home-dir=dest'.split(' '));
    await exec('restore --base-dir=src --home-dir=dest'.split(' '));

    assert.deepEqual(readdirSync('dest'), ['dir1']);
    assert.deepEqual(readdirSync('dest/dir1'), ['file2.txt']);
  });

  it('should run dry command', async () => {
    mock({
      'src': {
        'file1.txt': 'file1',
        'file2.txt': 'file2'
      },
      'dest': {}
    });

    await exec('apply --dry-run --base-dir=src --home-dir=dest'.split(' '));

    assert.deepEqual(readdirSync('dest'), []);
  });

  it('should ignore .git and node_modules folders', async () => {
    mock({
      'src': {
        '.git': {
          'file1.txt': 'file1'
        },
        'node_modules': {
          'file2.txt': 'file2'
        }
      },
      'dest': {}
    });

    await exec('apply --base-dir=src --home-dir=dest'.split(' '));

    assert.deepEqual(readdirSync('dest'), []);
  });

  it('should ignore files from .dotignore', async () => {
    mock({
      'src': {
        '.dotignore': 'bootstrap.sh\nnode_modules\n.dotignore',
        'bootstrap.sh': 'file2',
        'foo': {
          'file1.txt': 'file1'
        },
        'node_modules': {
          'file2.txt': 'file2'
        }
      },
      'dest': {}
    });

    await exec('apply --base-dir=src --home-dir=dest'.split(' '));

    assert.deepEqual(readdirSync('dest'), ['foo']);
  });

  it('should ignore file passed in exclude', async () => {
    mock({
      'src': {
        'foo': {
          'file1.txt': 'file1'
        },
        'bar': {
          'file2.txt': 'file2'
        }
      },
      'dest': {}
    });

    await exec('apply --base-dir=src --home-dir=dest --exclude=foo'.split(' '));

    assert.deepEqual(readdirSync('dest'), ['bar']);
  });

  it('should ignore several files passed in exclude', async () => {
    mock({
      'src': {
        'foo': {
          'file1.txt': 'file1'
        },
        'bar': {
          'file2.txt': 'file2'
        }
      },
      'dest': {}
    });

    await exec('apply --base-dir=src --home-dir=dest --exclude=foo --exclude=bar'.split(' '));

    assert.deepEqual(readdirSync('dest'), []);
  });

  it('should allow pass custom ignore file', async () => {
    mock({
      'src': {
        '.exclude': 'bootstrap.sh\nnode_modules\n.exclude',
        'bootstrap.sh': 'file2',
        'foo': {
          'file1.txt': 'file1'
        },
        'node_modules': {
          'file2.txt': 'file2'
        }
      },
      'dest': {}
    });

    await exec('apply --base-dir=src --home-dir=dest --excludes-file=./src/.exclude'.split(' '));

    assert.deepEqual(readdirSync('dest'), ['foo']);
  });

  it('should remove specific symlinks', async () => {
    mock({
      'src': {
        'file1.txt': 'file1',
        'file2.txt': 'file2'
      },
      'dest': {}
    });

    await exec('apply --base-dir=src --home-dir=dest'.split(' '));
    await exec('restore dest/file2.txt --base-dir=src --home-dir=dest'.split(' '));

    assert.deepEqual(readdirSync('dest'), ['file1.txt']);
  });
});
