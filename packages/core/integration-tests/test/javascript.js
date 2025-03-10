import assert from 'assert';
import path from 'path';
import url from 'url';
import {
  bundle,
  bundler,
  run,
  runBundle,
  runBundles,
  assertBundles,
  ncp,
  overlayFS,
  removeDistDirectory,
  distDir,
  outputFS,
  inputFS,
} from '@parcel/test-utils';
import {makeDeferredWithPromise, normalizePath} from '@parcel/utils';
import vm from 'vm';
import Logger from '@parcel/logger';

describe('javascript', function() {
  beforeEach(async () => {
    await removeDistDirectory();
  });

  it('should produce a basic JS bundle with CommonJS requires', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/commonjs/index.js'),
    );

    // assert.equal(b.assets.size, 8);
    // assert.equal(b.childBundles.size, 1);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should support url: imports with CommonJS output', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/commonjs-import-url/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'esmodule-helpers.js'],
      },
      {
        type: 'txt',
        assets: ['x.txt'],
      },
    ]);

    let txtBundle = b.getBundles().find(b => b.type === 'txt').filePath;

    let output = await run(b);
    assert.strictEqual(path.basename(output), path.basename(txtBundle));
  });

  it('should support url: imports of another javascript file', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/worklet/pipeline.js'),
      {
        mode: 'production',
      },
    );

    assertBundles(b, [
      {
        name: 'pipeline.js',
        assets: ['bundle-url.js', 'pipeline.js', 'bundle-manifest.js'],
      },
      {
        type: 'js',
        assets: ['worklet.js', 'colors.js'],
      },
    ]);

    let url;
    await run(b, {
      CSS: {
        paintWorklet: {
          addModule(u) {
            url = u;
          },
        },
      },
    });
    assert(/^http:\/\/localhost\/worklet\.[0-9a-f]+\.js$/.test(url));

    let name;
    await runBundle(
      b,
      b.getBundles()[1],
      {
        registerPaint(n) {
          name = n;
        },
      },
      {require: false},
    );

    assert.equal(name, 'checkerboard');
  });

  it('should support new URL() of another javascript file', async function() {
    let b = await bundle(path.join(__dirname, '/integration/worklet/url.js'));

    assertBundles(b, [
      {
        name: 'url.js',
        assets: ['bundle-url.js', 'esmodule-helpers.js', 'url.js'],
      },
      {
        type: 'js',
        assets: ['worklet.js', 'colors.js', 'esmodule-helpers.js'],
      },
    ]);

    let res = await run(b);
    assert(/^http:\/\/localhost\/worklet\.[0-9a-f]+\.js$/.test(res.default));

    let name;
    await runBundle(
      b,
      b.getBundles()[1],
      {
        registerPaint(n) {
          name = n;
        },
      },
      {require: false},
    );

    assert.equal(name, 'checkerboard');
  });

  it('should support CSS paint worklets', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/worklet/url-worklet.js'),
    );

    assertBundles(b, [
      {
        name: 'url-worklet.js',
        assets: ['bundle-url.js', 'url-worklet.js'],
      },
      {
        type: 'js',
        assets: ['worklet.js', 'colors.js', 'esmodule-helpers.js'],
      },
    ]);

    let url;
    await run(b, {
      CSS: {
        paintWorklet: {
          addModule(u) {
            url = u;
          },
        },
      },
    });
    assert(/^http:\/\/localhost\/worklet\.[0-9a-f]+\.js$/.test(url));

    let name;
    await runBundle(
      b,
      b.getBundles()[1],
      {
        registerPaint(n) {
          name = n;
        },
      },
      {require: false},
    );

    assert.equal(name, 'checkerboard');
  });

  it('should error on dynamic import() inside worklets', async function() {
    let errored = false;
    try {
      await bundle(
        path.join(__dirname, '/integration/worklet/url-worklet-error.js'),
      );
    } catch (err) {
      errored = true;
      assert.equal(err.message, 'import() is not allowed in worklets.');
      assert.deepEqual(err.diagnostics, [
        {
          message: 'import() is not allowed in worklets.',
          origin: '@parcel/transformer-js',
          codeFrames: [
            {
              filePath: path.join(
                __dirname,
                '/integration/worklet/worklet-error.js',
              ),
              codeHighlights: [
                {
                  start: {
                    line: 1,
                    column: 8,
                  },
                  end: {
                    line: 1,
                    column: 18,
                  },
                },
              ],
            },
            {
              filePath: path.join(
                __dirname,
                'integration/worklet/url-worklet-error.js',
              ),
              codeHighlights: [
                {
                  message: 'The environment was originally created here',
                  start: {
                    line: 1,
                    column: 36,
                  },
                  end: {
                    line: 1,
                    column: 53,
                  },
                },
              ],
            },
          ],
          hints: ['Try using a static `import`.'],
        },
      ]);
    }

    assert(errored);
  });

  it('should support audio worklets via a pipeline', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/worklet/worklet-pipeline.js'),
      {
        mode: 'production',
      },
    );

    assertBundles(b, [
      {
        name: 'worklet-pipeline.js',
        assets: ['bundle-url.js', 'bundle-manifest.js', 'worklet-pipeline.js'],
      },
      {
        type: 'js',
        assets: ['worklet.js', 'colors.js'],
      },
    ]);

    let res = await run(b);
    assert(/^http:\/\/localhost\/worklet\.[0-9a-f]+\.js$/.test(res));

    let name;
    await runBundle(
      b,
      b.getBundles()[1],
      {
        registerPaint(n) {
          name = n;
        },
      },
      {require: false},
    );

    assert.equal(name, 'checkerboard');
  });

  it('should error on dynamic import() inside worklets imported via a pipeline', async function() {
    let errored = false;
    try {
      await bundle(
        path.join(__dirname, '/integration/worklet/worklet-pipeline-error.js'),
      );
    } catch (err) {
      errored = true;
      assert.equal(err.message, 'import() is not allowed in worklets.');
      assert.deepEqual(err.diagnostics, [
        {
          message: 'import() is not allowed in worklets.',
          origin: '@parcel/transformer-js',
          codeFrames: [
            {
              filePath: path.join(
                __dirname,
                '/integration/worklet/worklet-error.js',
              ),
              codeHighlights: [
                {
                  start: {
                    line: 1,
                    column: 8,
                  },
                  end: {
                    line: 1,
                    column: 18,
                  },
                },
              ],
            },
          ],
          hints: ['Try using a static `import`.'],
        },
      ]);
    }

    assert(errored);
  });

  it('should produce a basic JS bundle with ES6 imports', async function() {
    let b = await bundle(path.join(__dirname, '/integration/es6/index.js'));

    // assert.equal(b.assets.size, 8);
    // assert.equal(b.childBundles.size, 1);

    let output = await run(b);
    assert.equal(typeof output, 'object');
    assert.equal(typeof output.default, 'function');
    assert.equal(output.default(), 3);
  });

  it('should detect dependencies inserted by a prior transform', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/dependency-prior-transform/index.js'),
    );

    let jsBundle = b.getBundles()[0];
    let contents = await outputFS.readFile(jsBundle.filePath);

    assert(!contents.includes('import'));
  });

  it('should produce a basic JS bundle with object rest spread support', async function() {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/object-rest-spread/object-rest-spread.js',
      ),
    );

    // assert.equal(b.assets.size, 1);

    let output = await run(b);
    assert.equal(typeof output, 'object');
    assert.equal(typeof output.default, 'function');

    let res = output.default();
    assert.equal(res.y, 'a');
    assert.deepEqual(res.z, {y: 'a', b: 'b'});
    assert.deepEqual(res.ys, {b: 'b'});
  });

  it('should bundle node_modules for a browser environment', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/node_require_browser/main.js'),
    );

    assertBundles(b, [
      {
        name: 'main.js',
        assets: ['main.js', 'local.js', 'index.js'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should not bundle node_modules for a node environment', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/node_require/main.js'),
    );

    assertBundles(b, [
      {
        name: 'main.js',
        assets: ['main.js', 'local.js'],
      },
    ]);

    await outputFS.mkdirp(path.join(distDir, 'node_modules/testmodule'));
    await outputFS.writeFile(
      path.join(distDir, 'node_modules/testmodule/index.js'),
      'exports.a = 5;',
    );

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 7);
  });

  it.skip('should not bundle node_modules on --target=electron', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/node_require/main.js'),
      {
        target: 'electron',
      },
    );

    assertBundles(b, {
      name: 'main.js',
      assets: ['main.js', 'local.js'],
    });

    await outputFS.mkdirp(path.join(distDir, 'node_modules/testmodule'));
    await outputFS.writeFile(
      path.join(distDir, 'node_modules/testmodule/index.js'),
      'exports.a = 5;',
    );

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 7);
  });

  it('should preserve hashbangs in bundles and preserve executable file mode', async () => {
    let fixturePath = path.join(__dirname, '/integration/node_hashbang');
    await bundle(path.join(fixturePath, 'main.js'));

    let mainPath = path.join(fixturePath, 'dist', 'node', 'main.js');
    let main = await outputFS.readFile(mainPath, 'utf8');
    assert.equal(main.lastIndexOf('#!/usr/bin/env node\n'), 0);
    assert.equal(
      (await outputFS.stat(mainPath)).mode,
      (await inputFS.stat(path.join(fixturePath, 'main.js'))).mode,
    );
    await outputFS.rimraf(path.join(fixturePath, 'dist'));
  });

  it('should not preserve hashbangs in browser bundles', async () => {
    let fixturePath = path.join(__dirname, '/integration/node_hashbang');
    await bundle(path.join(fixturePath, 'main.js'));

    let main = await outputFS.readFile(
      path.join(fixturePath, 'dist', 'browser', 'main.js'),
      'utf8',
    );
    assert(!main.includes('#!/usr/bin/env node\n'));
    await outputFS.rimraf(path.join(fixturePath, 'dist'));
  });

  it('should preserve hashbangs in scopehoisted bundles', async () => {
    let fixturePath = path.join(__dirname, '/integration/node_hashbang');
    await bundle(path.join(__dirname, '/integration/node_hashbang/main.js'), {
      defaultTargetOptions: {
        shouldScopeHoist: true,
      },
    });

    let main = await outputFS.readFile(
      path.join(fixturePath, 'dist', 'node', 'main.js'),
      'utf8',
    );
    assert.equal(main.lastIndexOf('#!/usr/bin/env node\n'), 0);
    await outputFS.rimraf(path.join(fixturePath, 'dist'));
  });

  it('should bundle node_modules for a node environment if includeNodeModules is specified', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/include_node_modules/main.js'),
    );

    assertBundles(b, [
      {
        name: 'main.js',
        assets: ['main.js', 'local.js', 'index.js'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should bundle builtins for a browser environment', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/include_builtins-browser/main.js'),
    );

    assertBundles(b, [
      {
        name: 'main.js',
        assets: [
          '_empty.js',
          'browser.js',
          'esmodule-helpers.js',
          'index.js',
          'main.js',
        ],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    let [fs, filepath] = output();
    assert.equal(filepath, path.posix.join('app', 'index.js'));
    assert.equal(typeof fs, 'object');
    assert.deepEqual(Object.keys(fs), Object.keys({}));
  });

  it('should not bundle builtins for a node environment if includeNodeModules is specified', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/include_builtins-node/main.js'),
    );

    assertBundles(b, [
      {
        name: 'main.js',
        assets: ['esmodule-helpers.js', 'main.js'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    let [fs, filepath] = output();
    assert.equal(filepath, path.join('app', 'index.js'));
    assert.equal(typeof fs.readFile, 'function');
  });

  it.skip('should bundle node_modules on --target=electron and --bundle-node-modules', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/node_require/main.js'),
      {
        target: 'electron',
        bundleNodeModules: true,
      },
    );

    assertBundles(b, {
      name: 'main.js',
      assets: ['main.js', 'local.js', 'index.js'],
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should produce a JS bundle with default exports and no imports', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/es6-default-only/index.js'),
    );

    // assert.equal(b.assets.size, 1);
    // assert.equal(b.childBundles.size, 1);

    let output = await run(b);
    assert.equal(typeof output, 'object');
    assert.equal(typeof output.default, 'function');
    assert.equal(output.default(), 3);
  });

  it('should split bundles when a dynamic import is used a browser environment', async function() {
    let b = await bundle(path.join(__dirname, '/integration/dynamic/index.js'));

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'bundle-url.js', 'cacheLoader.js', 'js-loader.js'],
      },
      {
        assets: ['local.js'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 3);
  });

  it('should prefetch bundles when declared as an import attribute statically', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic-static-prefetch/index.js'),
    );

    let output = await run(b);
    let headChildren = await output.default;

    assert.equal(headChildren.length, 3);

    assert(headChildren[0].tag === 'script');
    assert(headChildren[0].src.match(/async\..*\.js/));

    assert(headChildren[1].tag === 'link');
    assert(headChildren[1].rel === 'prefetch');
    assert(headChildren[1].as === 'script');
    assert(headChildren[1].href.match(/prefetched\..*\.js/));

    assert(headChildren[2].tag === 'link');
    assert(headChildren[2].rel === 'prefetch');
    assert(headChildren[2].as === 'style');
    assert(headChildren[2].href.match(/prefetched\..*\.css/));
  });

  it('should load additional links that were prefetched', async function() {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/dynamic-static-prefetch-loaded/index.js',
      ),
    );

    let output = await run(b);
    let outputReturn = await output.default;
    await outputReturn.loadDependency();

    let headChildren = outputReturn.children;
    assert.equal(headChildren.length, 5);
    let cssBundles = headChildren.filter(child =>
      child.href?.match(/prefetched-loaded\..*\.css/),
    );
    assert.equal(cssBundles.length, 2);

    assert(cssBundles[0].tag === 'link');
    assert(cssBundles[0].rel === 'prefetch');
    assert(cssBundles[0].as === 'style');
    assert(cssBundles[0].href.match(/prefetched-loaded\..*\.css/));

    assert(cssBundles[1].tag === 'link');
    assert(cssBundles[1].rel === 'stylesheet');
    assert(cssBundles[1].href.match(/prefetched-loaded\..*\.css/));
  });

  it('should preload bundles when declared as an import attribute statically', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic-static-preload/index.js'),
    );

    let output = await run(b);
    let headChildren = await output.default;

    assert(headChildren.length === 3);

    assert(headChildren[0].tag === 'script');
    assert(headChildren[0].src.match(/async\..*\.js/));

    assert(headChildren[1].tag === 'link');
    assert(headChildren[1].rel === 'preload');
    assert(headChildren[1].as === 'script');
    assert(headChildren[1].href.match(/preloaded\..*\.js/));

    assert(headChildren[2].tag === 'link');
    assert(headChildren[2].rel === 'preload');
    assert(headChildren[2].as === 'style');
    assert(headChildren[2].href.match(/preloaded\..*\.css/));
  });

  // TODO: Implement when we can evaluate bundles against esmodule targets
  it(
    'targetting esmodule, should modulepreload bundles when declared as an import attribute statically',
  );

  it('should remove import attributes', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic-import-attributes/index.js'),
    );

    let mainBundle = b.getBundles()[0];
    let mainBundleContent = await outputFS.readFile(
      mainBundle.filePath,
      'utf8',
    );
    assert(!mainBundleContent.includes('foo:'));
  });

  it('should split bundles when a dynamic import is used with a node environment', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic-node/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js'],
      },
      {
        assets: ['local.js'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 3);
  });

  it('should split bundles when a dynamic import is used with an electron-main environment', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic-electron-main/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js'],
      },
      {
        assets: ['local.js'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 3);
  });

  it('should split bundles when a dynamic import is used with an electron-renderer environment', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic-electron-renderer/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js'],
      },
      {
        assets: ['local.js'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 3);
  });

  it.skip('should load dynamic bundle when entry is in a subdirectory', async function() {
    let bu = await bundler(
      path.join(
        __dirname,
        '/integration/dynamic-subdirectory/subdirectory/index.js',
      ),
      {
        target: 'browser',
      },
    );
    // Set the rootDir to make sure subdirectory is preserved
    bu.options.rootDir = path.join(
      __dirname,
      '/integration/dynamic-subdirectory',
    );
    let b = await bu.bundle();
    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 3);
  });

  // TODO: re-enable when this actually works
  it.skip('Should not run parcel over external modules', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic-external/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['esmodule-helpers.js', 'index.js'],
      },
    ]);
  });

  it('should support bundling workers', async function() {
    let b = await bundle(path.join(__dirname, '/integration/workers/index.js'));

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'common.js',
          'worker-client.js',
          'feature.js',
          'get-worker-url.js',
          'bundle-url.js',
        ],
      },
      {
        assets: ['service-worker.js'],
      },
      {
        assets: ['shared-worker.js'],
      },
      {
        assets: ['worker.js', 'common.js'],
      },
    ]);
  });

  it('should support bundling workers with dynamic import', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/worker-dynamic/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'bundle-url.js', 'get-worker-url.js'],
      },
      {
        assets: [
          'worker.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
        ],
      },
      {
        assets: ['async.js', 'esmodule-helpers.js'],
      },
    ]);

    let res = await new Promise(resolve => {
      run(b, {
        output: resolve,
      });
    });
    assert.deepEqual(res, {default: 42});
  });

  it('should support bundling workers with dynamic import with legacy browser targets', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/worker-dynamic/index.js'),
      {
        defaultTargetOptions: {
          outputFormat: 'esmodule',
          shouldScopeHoist: true,
          engines: {
            browsers: 'IE 11',
          },
        },
      },
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'bundle-url.js', 'get-worker-url.js'],
      },
      {
        assets: [
          'worker.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
        ],
      },
      {
        assets: ['async.js'],
      },
    ]);

    let res = await new Promise(resolve => {
      run(b, {
        output: resolve,
      });
    });
    assert.deepEqual(res, {default: 42});
  });

  it('should support bundling workers with dynamic import in both page and worker', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/worker-dynamic/index-async.js'),
    );

    assertBundles(b, [
      {
        name: 'index-async.js',
        assets: [
          'index-async.js',
          'bundle-url.js',
          'get-worker-url.js',
          'cacheLoader.js',
          'js-loader.js',
        ],
      },
      {
        assets: [
          'worker.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
        ],
      },
      {
        assets: ['async.js', 'esmodule-helpers.js'],
      },
      {
        assets: ['async.js', 'esmodule-helpers.js'],
      },
    ]);

    let res = await new Promise(resolve => {
      run(b, {
        output: resolve,
      });
    });
    assert.deepEqual(res, {default: 42});
  });

  it('should support bundling workers with dynamic import in nested worker', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/worker-dynamic/index-nested.js'),
    );

    assertBundles(b, [
      {
        name: 'index-nested.js',
        assets: ['index-nested.js', 'bundle-url.js', 'get-worker-url.js'],
      },
      {
        assets: [
          'worker-nested.js',
          'bundle-url.js',
          'get-worker-url.js',
          'cacheLoader.js',
          'js-loader.js',
        ],
      },
      {
        assets: [
          'worker.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
        ],
      },
      {
        assets: ['async.js', 'esmodule-helpers.js'],
      },
    ]);

    let res = await new Promise(resolve => {
      run(b, {
        output: resolve,
      });
    });
    assert.deepEqual(res, {default: 42});
  });

  it('should support workers pointing to themselves', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/worker-self/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'bundle-url.js',
          'get-worker-url.js',
          'workerHelpers.js',
          'esmodule-helpers.js',
        ],
      },
      {
        assets: [
          'workerHelpers.js',
          'bundle-url.js',
          'get-worker-url.js',
          'esmodule-helpers.js',
        ],
      },
    ]);

    await run(b);
  });

  it('should support workers pointing to themselves with import.meta.url', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/worker-self/import-meta.js'),
    );

    assertBundles(b, [
      {
        assets: [
          'import-meta.js',
          'bundle-url.js',
          'get-worker-url.js',
          'esmodule-helpers.js',
        ],
      },
      {
        assets: [
          'import-meta.js',
          'bundle-url.js',
          'get-worker-url.js',
          'esmodule-helpers.js',
        ],
      },
    ]);

    await run(b);
  });

  it('should support bundling workers of type module', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/workers-module/index.js'),
      {
        defaultTargetOptions: {
          shouldScopeHoist: true,
        },
      },
    );

    assertBundles(b, [
      {
        assets: ['dedicated-worker.js', 'index.js'],
      },
      {
        name: 'index.js',
        assets: ['index.js', 'bundle-url.js', 'get-worker-url.js'],
      },
      {
        assets: ['shared-worker.js', 'index.js'],
      },
    ]);

    let dedicated, shared;
    b.traverseBundles((bundle, ctx, traversal) => {
      if (bundle.getMainEntry().filePath.endsWith('shared-worker.js')) {
        shared = bundle;
      } else if (
        bundle.getMainEntry().filePath.endsWith('dedicated-worker.js')
      ) {
        dedicated = bundle;
      }
      if (dedicated && shared) traversal.stop();
    });

    assert(dedicated);
    assert(shared);

    let main = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
    dedicated = await outputFS.readFile(dedicated.filePath, 'utf8');
    shared = await outputFS.readFile(shared.filePath, 'utf8');
    assert(/new Worker(.*?, {[\n\s]+type: 'module'[\n\s]+})/.test(main));
    assert(/new SharedWorker(.*?, {[\n\s]+type: 'module'[\n\s]+})/.test(main));
  });

  for (let shouldScopeHoist of [true, false]) {
    it(`should compile workers to non modules if ${
      shouldScopeHoist
        ? 'browsers do not support it'
        : 'shouldScopeHoist = false'
    }`, async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/workers-module/index.js'),
        {
          defaultTargetOptions: {
            shouldScopeHoist,
            engines: {
              browsers: '>= 0.25%',
            },
          },
        },
      );

      assertBundles(b, [
        {
          assets: [
            'dedicated-worker.js',
            !shouldScopeHoist && 'esmodule-helpers.js',
            'index.js',
          ].filter(Boolean),
        },
        {
          name: 'index.js',
          assets: ['index.js', 'bundle-url.js', 'get-worker-url.js'],
        },
        {
          assets: [
            !shouldScopeHoist && 'esmodule-helpers.js',
            'shared-worker.js',
            'index.js',
          ].filter(Boolean),
        },
      ]);

      let dedicated, shared;
      b.traverseBundles((bundle, ctx, traversal) => {
        if (bundle.getMainEntry().filePath.endsWith('shared-worker.js')) {
          shared = bundle;
        } else if (
          bundle.getMainEntry().filePath.endsWith('dedicated-worker.js')
        ) {
          dedicated = bundle;
        }
        if (dedicated && shared) traversal.stop();
      });

      assert(dedicated);
      assert(shared);

      let main = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      dedicated = await outputFS.readFile(dedicated.filePath, 'utf8');
      shared = await outputFS.readFile(shared.filePath, 'utf8');
      assert(/new Worker([^,]*?)/.test(main));
      assert(/new SharedWorker([^,]*?)/.test(main));
      assert(!/export var foo/.test(dedicated));
      assert(!/export var foo/.test(shared));
    });
  }

  for (let supported of [false, true]) {
    it(`should compile workers to ${
      supported ? '' : 'non '
    }modules when browsers do ${
      supported ? '' : 'not '
    }support it with esmodule parent script`, async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/workers-module/index.js'),
        {
          mode: 'production',
          defaultTargetOptions: {
            engines: {browsers: supported ? 'Chrome 80' : 'Chrome 75'},
            outputFormat: 'esmodule',
            shouldScopeHoist: true,
            shouldOptimize: false,
          },
        },
      );

      assertBundles(b, [
        {
          type: 'js',
          assets: ['dedicated-worker.js'],
        },
        {
          name: 'index.js',
          assets: ['index.js', 'bundle-manifest.js', 'get-worker-url.js'],
        },
        {
          type: 'js',
          assets: ['shared-worker.js'],
        },
        {
          type: 'js',
          assets: ['index.js'],
        },
      ]);

      let dedicated, shared;
      b.traverseBundles((bundle, ctx, traversal) => {
        if (bundle.getMainEntry()?.filePath.endsWith('shared-worker.js')) {
          shared = bundle;
        } else if (
          bundle.getMainEntry()?.filePath.endsWith('dedicated-worker.js')
        ) {
          dedicated = bundle;
        }
        if (dedicated && shared) traversal.stop();
      });

      assert(dedicated);
      assert(shared);

      let main = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(/new Worker([^,]*?)/.test(main));
      assert(/new SharedWorker([^,]*?)/.test(main));

      dedicated = await outputFS.readFile(dedicated.filePath, 'utf8');
      shared = await outputFS.readFile(shared.filePath, 'utf8');
      let importRegex = supported ? /importScripts\s*\(/ : /import\s*("|')/;
      assert(!importRegex.test(dedicated));
      assert(!importRegex.test(shared));
    });
  }

  it('should preserve the name option to workers', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/workers-module/named.js'),
      {
        defaultTargetOptions: {
          shouldScopeHoist: true,
          engines: {
            browsers: '>= 0.25%',
          },
        },
      },
    );

    let main = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
    assert(/new Worker(.*?, {[\n\s]+name: 'worker'[\n\s]+})/.test(main));
    assert(/new SharedWorker(.*?, {[\n\s]+name: 'shared'[\n\s]+})/.test(main));
  });

  it('should error if importing in a worker without type: module', async function() {
    let errored = false;
    try {
      await bundle(
        path.join(__dirname, '/integration/workers-module/error.js'),
        {
          defaultTargetOptions: {
            shouldScopeHoist: true,
          },
        },
      );
    } catch (err) {
      errored = true;
      assert.equal(
        err.message,
        'Web workers cannot have imports or exports without the `type: "module"` option.',
      );
      assert.deepEqual(err.diagnostics, [
        {
          message:
            'Web workers cannot have imports or exports without the `type: "module"` option.',
          origin: '@parcel/transformer-js',
          codeFrames: [
            {
              filePath: path.join(
                __dirname,
                '/integration/workers-module/dedicated-worker.js',
              ),
              codeHighlights: [
                {
                  message: null,
                  start: {
                    line: 1,
                    column: 1,
                  },
                  end: {
                    line: 1,
                    column: 22,
                  },
                },
              ],
            },
            {
              filePath: path.join(
                __dirname,
                '/integration/workers-module/error.js',
              ),
              codeHighlights: [
                {
                  message: 'The environment was originally created here',
                  start: {
                    line: 1,
                    column: 20,
                  },
                  end: {
                    line: 1,
                    column: 40,
                  },
                },
              ],
            },
          ],
          hints: [
            "Add {type: 'module'} as a second argument to the Worker constructor.",
          ],
          documentationURL:
            'https://parceljs.org/languages/javascript/#classic-scripts',
        },
      ]);
    }

    assert(errored);
  });

  it('should support bundling workers with different order', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/workers/index-alternative.js'),
    );

    assertBundles(b, [
      {
        name: 'index-alternative.js',
        assets: [
          'index-alternative.js',
          'common.js',
          'worker-client.js',
          'feature.js',
          'bundle-url.js',
          'get-worker-url.js',
        ],
      },
      {
        assets: ['service-worker.js'],
      },
      {
        assets: ['shared-worker.js'],
      },
      {
        assets: ['worker.js', 'common.js'],
      },
    ]);
  });

  for (let workerType of ['webworker', 'serviceworker']) {
    it(`should error when ${workerType}s use importScripts`, async function() {
      let filePath = path.join(
        __dirname,
        `/integration/worker-import-scripts/index-${workerType}.js`,
      );
      let errored = false;
      try {
        await bundle(filePath);
      } catch (err) {
        errored = true;
        assert.equal(
          err.message,
          'Argument to importScripts() must be a fully qualified URL.',
        );
        assert.deepEqual(err.diagnostics, [
          {
            message:
              'Argument to importScripts() must be a fully qualified URL.',
            origin: '@parcel/transformer-js',
            codeFrames: [
              {
                filePath: path.join(
                  __dirname,
                  `/integration/worker-import-scripts/importScripts.js`,
                ),
                codeHighlights: [
                  {
                    message: null,
                    start: {
                      line: 1,
                      column: 15,
                    },
                    end: {
                      line: 1,
                      column: 27,
                    },
                  },
                ],
              },
              {
                filePath: path.join(
                  __dirname,
                  `integration/worker-import-scripts/index-${workerType}.js`,
                ),
                codeHighlights: [
                  {
                    message: 'The environment was originally created here',
                    start: {
                      line: 1,
                      column: workerType === 'webworker' ? 20 : 42,
                    },
                    end: {
                      line: 1,
                      column: workerType === 'webworker' ? 37 : 59,
                    },
                  },
                ],
              },
            ],
            hints: [
              'Use a static `import`, or dynamic `import()` instead.',
              "Add {type: 'module'} as a second argument to the " +
                (workerType === 'webworker'
                  ? 'Worker constructor.'
                  : 'navigator.serviceWorker.register() call.'),
            ],
            documentationURL:
              'https://parceljs.org/languages/javascript/#classic-script-workers',
          },
        ]);
      }

      assert(errored);
    });
  }

  it('should ignore importScripts when not in a worker context', async function() {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/worker-import-scripts/importScripts.js',
      ),
    );

    assertBundles(b, [
      {
        type: 'js',
        assets: ['importScripts.js'],
      },
    ]);

    let res = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
    assert(res.includes("importScripts('imported.js')"));
  });

  it('should ignore importScripts in script workers when not passed a string literal', async function() {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/worker-import-scripts/index-variable.js',
      ),
    );

    assertBundles(b, [
      {
        type: 'js',
        assets: ['index-variable.js', 'bundle-url.js', 'get-worker-url.js'],
      },
      {
        type: 'js',
        assets: ['variable.js'],
      },
    ]);

    let res = await outputFS.readFile(b.getBundles()[1].filePath, 'utf8');
    assert(res.includes('importScripts(url)'));
  });

  it('should ignore importScripts in script workers a fully qualified URL is provided', async function() {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/worker-import-scripts/index-external.js',
      ),
    );

    assertBundles(b, [
      {
        type: 'js',
        assets: ['index-external.js', 'bundle-url.js', 'get-worker-url.js'],
      },
      {
        type: 'js',
        assets: ['external.js'],
      },
    ]);

    let res = await outputFS.readFile(b.getBundles()[1].filePath, 'utf8');
    assert(res.includes("importScripts('https://unpkg.com/parcel')"));
  });

  it('should support bundling service-workers', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/service-worker/a/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'index.js', 'bundle-url.js'],
      },
      {
        assets: ['worker-nested.js'],
      },
      {
        assets: ['worker-outside.js'],
      },
    ]);
  });

  it('should support bundling service-workers with type: module', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/service-worker/module.js'),
      {
        defaultTargetOptions: {
          shouldScopeHoist: true,
        },
      },
    );

    assertBundles(b, [
      {
        name: 'module.js',
        assets: ['module.js', 'bundle-url.js'],
      },
      {
        assets: ['module-worker.js'],
      },
    ]);

    let bundles = b.getBundles();
    let main = bundles.find(b => !b.env.isWorker());
    let worker = bundles.find(b => b.env.isWorker());
    let mainContents = await outputFS.readFile(main.filePath, 'utf8');
    let workerContents = await outputFS.readFile(worker.filePath, 'utf8');
    assert(/navigator.serviceWorker.register\([^,]+?\)/.test(mainContents));
    assert(!/export /.test(workerContents));
  });

  it('should preserve the scope option for service workers', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/service-worker/scope.js'),
      {
        defaultTargetOptions: {
          shouldScopeHoist: true,
        },
      },
    );

    assertBundles(b, [
      {
        name: 'scope.js',
        assets: ['bundle-url.js', 'scope.js'],
      },
      {
        assets: ['module-worker.js'],
      },
    ]);

    let bundles = b.getBundles();
    let main = bundles.find(b => !b.env.isWorker());
    let mainContents = await outputFS.readFile(main.filePath, 'utf8');
    assert(
      /navigator.serviceWorker.register\(.*?, {[\n\s]*scope: 'foo'[\n\s]*}\)/.test(
        mainContents,
      ),
    );
  });

  it('should error if importing in a service worker without type: module', async function() {
    let errored = false;
    try {
      await bundle(
        path.join(__dirname, '/integration/service-worker/error.js'),
        {
          defaultTargetOptions: {
            shouldScopeHoist: true,
          },
        },
      );
    } catch (err) {
      errored = true;
      assert.equal(
        err.message,
        'Service workers cannot have imports or exports without the `type: "module"` option.',
      );
      assert.deepEqual(err.diagnostics, [
        {
          message:
            'Service workers cannot have imports or exports without the `type: "module"` option.',
          origin: '@parcel/transformer-js',
          codeFrames: [
            {
              filePath: path.join(
                __dirname,
                '/integration/service-worker/module-worker.js',
              ),
              codeHighlights: [
                {
                  message: null,
                  start: {
                    line: 1,
                    column: 1,
                  },
                  end: {
                    line: 1,
                    column: 19,
                  },
                },
              ],
            },
            {
              filePath: path.join(
                __dirname,
                'integration/service-worker/error.js',
              ),
              codeHighlights: [
                {
                  message: 'The environment was originally created here',
                  start: {
                    line: 1,
                    column: 42,
                  },
                  end: {
                    line: 1,
                    column: 59,
                  },
                },
              ],
            },
          ],
          hints: [
            "Add {type: 'module'} as a second argument to the navigator.serviceWorker.register() call.",
          ],
          documentationURL:
            'https://parceljs.org/languages/javascript/#classic-scripts',
        },
      ]);
    }

    assert(errored);
  });

  it('should expose a manifest to service workers', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/service-worker/manifest.js'),
      {
        defaultTargetOptions: {
          shouldScopeHoist: true,
        },
      },
    );

    assertBundles(b, [
      {
        name: 'manifest.js',
        assets: ['manifest.js', 'bundle-url.js'],
      },
      {
        assets: ['manifest-worker.js', 'service-worker.js'],
      },
    ]);

    let bundles = b.getBundles();
    let worker = bundles.find(b => b.env.isWorker());
    let manifest, version;
    await await runBundle(b, worker, {
      output(m, v) {
        manifest = m;
        version = v;
      },
    });
    assert.deepEqual(manifest, ['/manifest.js']);
    assert.equal(typeof version, 'string');
  });

  it('should recognize serviceWorker.register with static URL and import.meta.url', async function() {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/service-worker-import-meta-url/index.js',
      ),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'bundle-url.js'],
      },
      {
        assets: ['worker.js'],
      },
    ]);

    let contents = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
    assert(!contents.includes('import.meta.url'));
  });

  it('should throw a codeframe for a missing file in serviceWorker.register with URL and import.meta.url', async function() {
    let fixture = path.join(
      __dirname,
      'integration/service-worker-import-meta-url/missing.js',
    );
    let code = await inputFS.readFileSync(fixture, 'utf8');
    await assert.rejects(() => bundle(fixture), {
      name: 'BuildError',
      diagnostics: [
        {
          codeFrames: [
            {
              filePath: fixture,
              code,
              codeHighlights: [
                {
                  end: {
                    column: 55,
                    line: 1,
                  },
                  start: {
                    column: 42,
                    line: 1,
                  },
                },
              ],
            },
          ],
          message: "Failed to resolve './invalid.js' from './missing.js'",
          origin: '@parcel/core',
        },
        {
          hints: ["Did you mean '__./index.js__'?"],
          message: "Cannot load file './invalid.js' in './'.",
          origin: '@parcel/resolver-default',
        },
      ],
    });
  });

  it('should error on dynamic import() inside service workers', async function() {
    let errored = false;
    try {
      await bundle(
        path.join(
          __dirname,
          '/integration/service-worker/dynamic-import-index.js',
        ),
      );
    } catch (err) {
      errored = true;
      assert.equal(err.message, 'import() is not allowed in service workers.');
      assert.deepEqual(err.diagnostics, [
        {
          message: 'import() is not allowed in service workers.',
          origin: '@parcel/transformer-js',
          codeFrames: [
            {
              filePath: path.join(
                __dirname,
                '/integration/service-worker/dynamic-import.js',
              ),
              codeHighlights: [
                {
                  start: {
                    line: 1,
                    column: 8,
                  },
                  end: {
                    line: 1,
                    column: 27,
                  },
                },
              ],
            },
            {
              filePath: path.join(
                __dirname,
                'integration/service-worker/dynamic-import-index.js',
              ),
              codeHighlights: [
                {
                  message: 'The environment was originally created here',
                  start: {
                    line: 1,
                    column: 42,
                  },
                  end: {
                    line: 1,
                    column: 60,
                  },
                },
              ],
            },
          ],
          hints: ['Try using a static `import`.'],
        },
      ]);
    }

    assert(errored);
  });

  it('should support bundling workers with circular dependencies', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/worker-circular/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'bundle-url.js', 'get-worker-url.js'],
      },
      {
        assets: ['worker.js', 'worker-dep.js'],
      },
    ]);
  });

  it('should recognize worker constructor with static URL and import.meta.url', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/worker-import-meta-url/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'bundle-url.js', 'get-worker-url.js'],
      },
      {
        assets: ['worker.js'],
      },
    ]);

    let contents = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
    assert(!contents.includes('import.meta.url'));
  });

  it('should ignore worker constructors with dynamic URL and import.meta.url', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/worker-import-meta-url/dynamic.js'),
    );

    assertBundles(b, [
      {
        name: 'dynamic.js',
        assets: ['dynamic.js'],
      },
    ]);

    let contents = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
    assert(contents.includes('import.meta.url'));
  });

  it('should ignore worker constructors with local URL binding and import.meta.url', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/worker-import-meta-url/local-url.js'),
    );

    assertBundles(b, [
      {
        name: 'local-url.js',
        assets: ['local-url.js'],
      },
    ]);

    let contents = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
    assert(contents.includes('import.meta.url'));
  });

  it('should throw a codeframe for a missing file in worker constructor with URL and import.meta.url', async function() {
    let fixture = path.join(
      __dirname,
      'integration/worker-import-meta-url/missing.js',
    );
    let code = await inputFS.readFileSync(fixture, 'utf8');
    await assert.rejects(() => bundle(fixture), {
      name: 'BuildError',
      diagnostics: [
        {
          codeFrames: [
            {
              filePath: fixture,
              code,
              codeHighlights: [
                {
                  end: {
                    column: 33,
                    line: 1,
                  },
                  start: {
                    column: 20,
                    line: 1,
                  },
                },
              ],
            },
          ],
          message: "Failed to resolve './invalid.js' from './missing.js'",
          origin: '@parcel/core',
        },
        {
          hints: [
            "Did you mean '__./dynamic.js__'?",
            "Did you mean '__./index.js__'?",
          ],
          message: "Cannot load file './invalid.js' in './'.",
          origin: '@parcel/resolver-default',
        },
      ],
    });
  });

  it.skip('should support bundling in workers with other loaders', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/workers-with-other-loaders/index.js'),
    );

    assertBundles(b, {
      name: 'index.js',
      assets: [
        'index.js',
        'worker-client.js',
        'cacheLoader.js',
        'js-loader.js',
        'wasm-loader.js',
      ],
      childBundles: [
        {
          type: 'wasm',
          assets: ['add.wasm'],
          childBundles: [],
        },
        {
          type: 'map',
        },
        {
          assets: ['worker.js', 'cacheLoader.js', 'wasm-loader.js'],
          childBundles: [
            {
              type: 'map',
            },
          ],
        },
      ],
    });
  });

  it('should create a shared bundle to deduplicate assets in workers', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/worker-shared/index.js'),
      {
        mode: 'production',
        defaultTargetOptions: {
          shouldScopeHoist: false,
        },
      },
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'lodash.js',
          'bundle-url.js',
          'get-worker-url.js',
          'bundle-manifest.js',
          'esmodule-helpers.js',
        ],
      },
      {
        assets: [
          'worker-a.js',
          'bundle-url.js',
          'get-worker-url.js',
          'bundle-manifest.js',
        ],
      },
      {
        assets: ['worker-b.js'],
      },
      {
        assets: ['esmodule-helpers.js', 'lodash.js'],
      },
    ]);

    let sharedBundle = b
      .getBundles()
      .sort((a, b) => b.stats.size - a.stats.size)
      .find(b => b.name !== 'index.js');
    let workerBundle = b.getBundles().find(b => b.name.startsWith('worker-b'));
    let contents = await outputFS.readFile(workerBundle.filePath, 'utf8');
    assert(
      contents.includes(
        `importScripts("./${path.basename(sharedBundle.filePath)}")`,
      ),
    );
  });

  it('should contain duplicate assets in workers when in development', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/worker-shared/index.js'),
      {mode: 'development'},
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'bundle-url.js',
          'get-worker-url.js',
          'lodash.js',
          'esmodule-helpers.js',
        ],
      },
      {
        assets: [
          'worker-a.js',
          'bundle-url.js',
          'esmodule-helpers.js',
          'get-worker-url.js',
          'lodash.js',
        ],
      },
      {
        assets: ['worker-b.js', 'lodash.js', 'esmodule-helpers.js'],
      },
    ]);
  });

  it('should deduplicate and remove an unnecessary async bundle when it contains a cyclic reference to its entry', async () => {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/deduplicate-from-async-cyclic-bundle-entry/index.js',
      ),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'bar.js',
          'bundle-url.js',
          'cacheLoader.js',
          'esmodule-helpers.js',
          'foo.js',
          'js-loader.js',
        ],
      },
      {
        assets: ['async.js'],
      },
    ]);

    assert.deepEqual(await Promise.all((await run(b)).default), [5, 4]);
  });

  it('does not create bundles for dynamic imports when assets are available up the graph', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/internalize-no-bundle-split/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'bar.js', 'foo.js', 'esmodule-helpers.js'],
      },
    ]);

    assert.deepEqual(await (await run(b)).default, [3, 3]);
  });

  it('async dependency internalization successfully removes unneeded bundlegroups and their bundles', async () => {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/internalize-remove-bundlegroup/index.js',
      ),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['bundle-url.js', 'get-worker-url.js', 'index.js'],
      },
      {
        assets: [
          'bundle-url.js',
          'get-worker-url.js',
          'worker1.js',
          'worker2.js',
          'worker3.js',
          'core.js',
        ],
      },
      {assets: ['core.js', 'worker3.js']},
    ]);
  });

  it('should create a shared bundle between browser and worker contexts', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/html-shared-worker/index.html'),
      {mode: 'production', defaultTargetOptions: {shouldScopeHoist: false}},
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html'],
      },
      {
        assets: [
          'index.js',
          'bundle-url.js',
          'get-worker-url.js',
          'bundle-manifest.js',
          'lodash.js',
          'esmodule-helpers.js',
        ],
      },
      {
        assets: ['worker.js', 'lodash.js', 'esmodule-helpers.js'],
      },
    ]);

    // let sharedBundle = b
    //   .getBundles()
    //   .sort((a, b) => b.stats.size - a.stats.size)
    //   .find(b => b.name !== 'index.js');
    let workerBundle = b.getBundles().find(b => b.name.startsWith('worker'));
    // let contents = await outputFS.readFile(workerBundle.filePath, 'utf8');
    // assert(
    //   contents.includes(
    //     `importScripts("./${path.basename(sharedBundle.filePath)}")`,
    //   ),
    // );

    let outputArgs = [];
    let workerArgs = [];
    await run(b, {
      Worker: class {
        constructor(url) {
          workerArgs.push(url);
        }
      },
      output: (ctx, val) => {
        outputArgs.push([ctx, val]);
      },
    });

    assert.deepStrictEqual(outputArgs, [['main', 3]]);
    assert.deepStrictEqual(workerArgs, [
      `http://localhost/${path.basename(workerBundle.filePath)}`,
    ]);
  });

  it('should support workers with shared assets between page and worker with async imports', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/worker-shared-page/index.html'),
      {
        mode: 'production',
        defaultTargetOptions: {
          shouldOptimize: false,
        },
      },
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html'],
      },
      {
        assets: [
          'bundle-manifest.js',
          'bundle-url.js',
          'cacheLoader.js',
          'get-worker-url.js',
          'index.js',
          'js-loader.js',
          'large.js',
        ],
      },
      {
        assets: [
          'bundle-manifest.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
          'large.js',
          'worker.js',
        ],
      },
      {
        assets: [
          'bundle-manifest.js',
          'get-worker-url.js',
          'index.js',
          'large.js',
        ],
      },
      {
        assets: ['async.js'],
      },
      {
        assets: ['async.js'],
      },
      {
        assets: ['async.js'],
      },
    ]);

    await run(b);
  });

  it('should dynamic import files which import raw files', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic-references-raw/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'bundle-url.js', 'cacheLoader.js', 'js-loader.js'],
      },
      {
        assets: ['local.js', 'esmodule-helpers.js'],
      },
      {
        assets: ['test.txt'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 3);
  });

  it('should return all exports as an object when using ES modules', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic-esm/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'bundle-url.js',
          'cacheLoader.js',
          'esmodule-helpers.js',
          'js-loader.js',
        ],
      },
      {
        assets: ['local.js'],
      },
    ]);

    let output = (await run(b)).default;
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 3);
  });

  it('should duplicate small modules across multiple bundles', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic-common-small/index.js'),
    );

    assertBundles(b, [
      {
        assets: ['a.js', 'common.js', 'common-dep.js'],
      },
      {
        assets: ['b.js', 'common.js', 'common-dep.js'],
      },
      {
        name: 'index.js',
        assets: ['index.js', 'bundle-url.js', 'cacheLoader.js', 'js-loader.js'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 7);
  });

  it('should create a separate bundle for large modules shared between bundles', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic-common-large/index.js'),
      {
        mode: 'production',
        defaultTargetOptions: {
          shouldScopeHoist: false,
        },
      },
    );

    assertBundles(b, [
      {
        assets: ['a.js'],
      },
      {
        assets: ['b.js'],
      },
      {
        name: 'index.js',
        assets: [
          'index.js',
          'c.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
          'bundle-manifest.js',
        ],
      },
      {
        assets: ['common.js', 'lodash.js'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 7);
  });

  it('should not duplicate a module which is already in a parent bundle', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic-hoist-dup/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'common.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
        ],
      },
      {
        assets: ['a.js'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 5);
  });

  it('should duplicate an asset if it is not present in every parent bundle', async function() {
    let b = await bundle(
      ['a.js', 'b.js'].map(entry =>
        path.join(__dirname, 'integration/dynamic-hoist-no-dedupe', entry),
      ),
    );
    assertBundles(b, [
      {
        assets: ['c.js', 'common.js', 'esmodule-helpers.js'],
      },
      {
        name: 'b.js',
        assets: ['b.js', 'bundle-url.js', 'cacheLoader.js', 'js-loader.js'],
      },
      {
        name: 'a.js',
        assets: [
          'a.js',
          'bundle-url.js',
          'common.js',
          'cacheLoader.js',
          'esmodule-helpers.js',
          'js-loader.js',
        ],
      },
    ]);
  });

  it('should duplicate an asset if it is not available in all possible ancestries', async () => {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/dynamic-hoist-no-dedupe-ancestry/index.js',
      ),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
          'esmodule-helpers.js',
        ],
      },
      {
        assets: ['a.js', 'common.js'],
      },
      {
        assets: ['b.js'],
      },
      {
        assets: ['c.js'],
      },
      {
        assets: ['d.js', 'common.js'],
      },
    ]);

    let {default: promise} = await run(b);
    assert.equal(await promise, 42);
  });

  it('should support shared modules with async imports', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic-hoist-deep/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'bundle-url.js',
          'cacheLoader.js',
          'esmodule-helpers.js',
          'js-loader.js',
        ],
      },
      {
        assets: ['a.js', 'c.js'],
      },
      {
        assets: ['b.js', 'c.js'],
      },
      {
        assets: ['1.js'],
      },
    ]);

    let {default: promise} = await run(b);
    assert.ok(await promise);
  });

  it('should support requiring JSON files', async function() {
    let b = await bundle(path.join(__dirname, '/integration/json/index.js'));

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'local.json'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should support requiring JSON5 files', async function() {
    let b = await bundle(path.join(__dirname, '/integration/json5/index.js'));

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'local.json5'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should support importing a URL to a raw asset', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/import-raw/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'bundle-url.js'],
      },
      {
        type: 'txt',
        assets: ['test.txt'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert(/^http:\/\/localhost\/test\.[0-9a-f]+\.txt$/.test(output()));
    let stats = await outputFS.stat(
      path.join(distDir, url.parse(output()).pathname),
    );
    assert.equal(stats.size, 9);
  });

  it('should support referencing a raw asset with static URL and import.meta.url', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/import-raw-import-meta-url/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'bundle-url.js', 'esmodule-helpers.js'],
      },
      {
        type: 'txt',
        assets: ['test.txt'],
      },
    ]);

    let contents = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
    assert(!contents.includes('import.meta.url'));

    let output = await run(b);
    assert(/^http:\/\/localhost\/test\.[0-9a-f]+\.txt$/.test(output.default));
    let stats = await outputFS.stat(
      path.join(distDir, output.default.pathname),
    );
    assert.equal(stats.size, 9);
  });

  it('should support referencing a raw asset with static URL and CJS __filename', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/import-raw-import-meta-url/cjs.js'),
    );

    assertBundles(b, [
      {
        name: 'cjs.js',
        assets: ['cjs.js', 'bundle-url.js', 'esmodule-helpers.js'],
      },
      {
        type: 'txt',
        assets: ['test.txt'],
      },
    ]);

    let contents = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
    assert(!contents.includes('import.meta.url'));

    let output = await run(b);
    assert(/^http:\/\/localhost\/test\.[0-9a-f]+\.txt$/.test(output.default));
    let stats = await outputFS.stat(
      path.join(distDir, output.default.pathname),
    );
    assert.equal(stats.size, 9);
  });

  it('should ignore new URL and import.meta.url with local binding', async function() {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/import-raw-import-meta-url/local-url.js',
      ),
    );

    assertBundles(b, [
      {
        name: 'local-url.js',
        assets: ['esmodule-helpers.js', 'local-url.js'],
      },
    ]);

    let contents = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
    assert(contents.includes('"file:///local-url.js"'));
  });

  it('should throw a codeframe for a missing raw asset with static URL and import.meta.url', async function() {
    let fixture = path.join(
      __dirname,
      'integration/import-raw-import-meta-url/missing.js',
    );
    let code = await inputFS.readFileSync(fixture, 'utf8');
    await assert.rejects(() => bundle(fixture), {
      name: 'BuildError',
      diagnostics: [
        {
          codeFrames: [
            {
              filePath: fixture,
              code,
              codeHighlights: [
                {
                  end: {
                    column: 36,
                    line: 1,
                  },
                  start: {
                    column: 24,
                    line: 1,
                  },
                },
              ],
            },
          ],
          message: "Failed to resolve 'invalid.txt' from './missing.js'",
          origin: '@parcel/core',
        },
        {
          hints: [],
          message: "Cannot load file './invalid.txt' in './'.",
          origin: '@parcel/resolver-default',
        },
      ],
    });
  });

  it('should support importing a URL to a large raw asset', async function() {
    // 6 megabytes, which exceeds the threshold in summarizeRequest for buffering
    // entire contents into memory and should stream content instead
    let assetSizeBytes = 6000000;

    let distDir = path.join(outputFS.cwd(), '/dist');
    let fixtureDir = path.join(__dirname, '/integration/import-raw');
    let inputDir = path.join(__dirname, 'input');

    await ncp(fixtureDir, inputDir);
    await outputFS.writeFile(
      path.join(inputDir, 'test.txt'),
      Buffer.alloc(assetSizeBytes),
    );

    let b = await bundle(path.join(inputDir, 'index.js'), {
      inputFS: overlayFS,
      defaultTargetOptions: {
        distDir,
      },
    });
    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'bundle-url.js'],
      },
      {
        type: 'txt',
        assets: ['test.txt'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert(/^http:\/\/localhost\/test\.[0-9a-f]+\.txt$/.test(output()));
    let stats = await outputFS.stat(
      path.join(distDir, url.parse(output()).pathname),
    );
    assert.equal(stats.size, assetSizeBytes);
  });

  it('should minify JS in production mode', async function() {
    let b = await bundle(path.join(__dirname, '/integration/uglify/index.js'), {
      defaultTargetOptions: {
        shouldOptimize: true,
        shouldScopeHoist: false,
      },
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);

    let js = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(!js.includes('local.a'));
  });

  it('should use terser config', async function() {
    await bundle(path.join(__dirname, '/integration/terser-config/index.js'), {
      defaultTargetOptions: {
        shouldOptimize: true,
        shouldScopeHoist: false,
      },
    });

    let js = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(!js.includes('console.log'));
    assert(!js.includes('// This is a comment'));
  });

  it('should insert global variables when needed', async function() {
    let b = await bundle(path.join(__dirname, '/integration/globals/index.js'));

    let output = await run(b);
    assert.deepEqual(output(), {
      dir: 'integration/globals',
      file: 'integration/globals/index.js',
      buf: Buffer.from('browser').toString('base64'),
      global: true,
    });
  });

  it('should work when multiple files use globals with scope hoisting', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/globals/multiple.js'),
      {
        mode: 'production',
        defaultTargetOptions: {
          shouldScopeHoist: true,
          shouldOptimize: false,
        },
      },
    );

    let output = await run(b);
    assert.deepEqual(output, {
      file: 'integration/globals/multiple.js',
      other: 'integration/globals/index.js',
    });
  });

  it('should not insert global variables when used in a module specifier', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/globals-module-specifier/a.js'),
    );

    assertBundles(b, [
      {
        assets: ['a.js', 'b.js', 'c.js', 'esmodule-helpers.js'],
      },
    ]);

    let output = await run(b);
    assert.deepEqual(output, 1234);
  });

  it('should not insert global variables in dead branches', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/globals-unused/a.js'),
    );

    assertBundles(b, [
      {
        assets: ['a.js'],
      },
    ]);

    let output = await run(b);
    assert.deepEqual(output, 'foo');
  });

  it('should handle re-declaration of the global constant', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/global-redeclare/index.js'),
    );

    let output = await run(b);
    assert.deepEqual(output(), false);
  });

  it('should insert environment variables inserted by a prior transform', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/env-prior-transform/index.js'),
    );

    let jsBundle = b.getBundles()[0];
    let contents = await outputFS.readFile(jsBundle.filePath, 'utf8');

    assert(!contents.includes('process.env'));
    assert.equal(await run(b), 'test');
  });

  it('should not insert environment variables in node environment', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/env-node/index.js'),
    );

    let output = await run(b);
    assert.ok(output.toString().includes('process.env'));
    assert.equal(output(), 'test:test');
  });

  it('should not replace process.env.hasOwnProperty with undefined', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/env-hasOwnProperty/index.js'),
    );

    let output = await run(b);
    assert.strictEqual(output, false);
  });

  it('should not insert environment variables in electron-main environment', async function() {
    let b = await bundle(path.join(__dirname, '/integration/env/index.js'), {
      targets: {
        main: {
          context: 'electron-main',
          distDir: path.join(__dirname, '/integration/env/dist.js'),
        },
      },
    });

    let output = await run(b);
    assert.ok(output.toString().includes('process.env'));
    assert.equal(output(), 'test:test');
  });

  it('should not insert environment variables in electron-renderer environment', async function() {
    let b = await bundle(path.join(__dirname, '/integration/env/index.js'), {
      targets: {
        main: {
          context: 'electron-renderer',
          distDir: path.join(__dirname, '/integration/env/dist.js'),
        },
      },
    });

    let output = await run(b);
    assert.ok(output.toString().includes('process.env'));
    assert.equal(output(), 'test:test');
  });

  it('should inline NODE_ENV environment variable in browser environment even if disabled', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/env-nodeenv/index.js'),
      {
        env: {
          FOO: 'abc',
        },
      },
    );

    let output = await run(b);
    assert.ok(!output.toString().includes('process.env'));
    assert.equal(output(), 'test:undefined');
  });

  it('should not insert environment variables in browser environment if disabled', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/env-disabled/index.js'),
      {
        env: {FOOBAR: 'abc'},
      },
    );

    let output = await run(b);
    assert.ok(!output.toString().includes('process.env'));
    assert.equal(output(), 'undefined:undefined:undefined');
  });

  it('should only insert environment variables in browser environment matching the glob', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/env-disabled-glob/index.js'),
      {
        env: {A_1: 'abc', B_1: 'def', B_2: 'ghi'},
      },
    );

    let output = await run(b);
    assert.ok(!output.toString().includes('process.env'));
    assert.equal(output(), 'undefined:def:ghi');
  });

  it('should be able to inline environment variables in browser environment', async function() {
    let b = await bundle(path.join(__dirname, '/integration/env/index.js'), {
      env: {NODE_ENV: 'abc'},
    });

    let output = await run(b);
    assert.ok(!output.toString().includes('process.env'));
    assert.equal(output(), 'abc:abc');
  });

  it("should insert the user's NODE_ENV as process.env.NODE_ENV if passed", async function() {
    let b = await bundle(path.join(__dirname, '/integration/env/index.js'), {
      env: {
        NODE_ENV: 'production',
      },
    });

    let output = await run(b);
    assert.ok(!output.toString().includes('process.env'));
    assert.equal(output(), 'production:production');
  });

  it('should not inline computed accesses to process.env', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/env-computed/index.js'),
      {
        env: {ABC: 'abc'},
      },
    );

    let contents = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
    assert(contents.includes('process.env'));

    let output = await run(b);
    assert.strictEqual(output, undefined);
  });

  it('should inline computed accesses with string literals to process.env', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/env-computed-string/index.js'),
      {
        env: {ABC: 'XYZ'},
      },
    );

    let contents = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
    assert(!contents.includes('process.env'));

    let output = await run(b);
    assert.strictEqual(output, 'XYZ');
  });

  it('should inline environment variables when destructured in a variable declaration', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/env-destructuring/index.js'),
      {
        env: {TEST: 'XYZ'},
        defaultTargetOptions: {
          engines: {
            browsers: '>= 0.25%',
          },
        },
      },
    );

    let contents = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
    assert(!contents.includes('process.env'));

    let output = await run(b);
    assert.deepEqual(output, {
      env: {},
      NODE_ENV: 'test',
      renamed: 'XYZ',
      computed: undefined,
      fallback: 'yo',
      rest: {},
      other: 'hi',
    });
  });

  it('should inline environment variables when destructured in an assignment', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/env-destructuring/assign.js'),
      {
        env: {TEST: 'XYZ'},
        defaultTargetOptions: {
          engines: {
            browsers: '>= 0.25%',
          },
        },
      },
    );

    let contents = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
    assert(!contents.includes('process.env'));

    let output = await run(b);
    assert.deepEqual(output, {
      env: {},
      NODE_ENV: 'test',
      renamed: 'XYZ',
      computed: undefined,
      fallback: 'yo',
      rest: {},
      result: {},
    });
  });

  it('should insert environment variables from a file', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/env-file/index.js'),
    );

    // Make sure dotenv doesn't leak its values into the main process's env
    assert(process.env.FOO == null);

    let output = await run(b);
    assert.equal(output, 'bartest');
  });

  it("should insert environment variables matching the user's NODE_ENV if passed", async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/env-file/index.js'),
      {env: {NODE_ENV: 'production'}},
    );

    let output = await run(b);
    assert.equal(output, 'productiontest');
  });

  it('should overwrite environment variables from a file if passed', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/env-file/index.js'),
      {env: {BAR: 'baz'}},
    );

    let output = await run(b);
    assert.equal(output, 'barbaz');
  });

  it('should error on process.env mutations', async function() {
    let filePath = path.join(__dirname, '/integration/env-mutate/index.js');
    await assert.rejects(bundle(filePath), {
      diagnostics: [
        {
          origin: '@parcel/transformer-js',
          message: 'Mutating process.env is not supported',
          hints: null,
          codeFrames: [
            {
              filePath,
              codeHighlights: [
                {
                  message: null,
                  start: {
                    line: 1,
                    column: 1,
                  },
                  end: {
                    line: 1,
                    column: 29,
                  },
                },
              ],
            },
          ],
        },
        {
          origin: '@parcel/transformer-js',
          message: 'Mutating process.env is not supported',
          hints: null,
          codeFrames: [
            {
              filePath,
              codeHighlights: [
                {
                  message: null,
                  start: {
                    line: 2,
                    column: 1,
                  },
                  end: {
                    line: 2,
                    column: 30,
                  },
                },
              ],
            },
          ],
        },
        {
          origin: '@parcel/transformer-js',
          message: 'Mutating process.env is not supported',
          hints: null,
          codeFrames: [
            {
              filePath,
              codeHighlights: [
                {
                  message: null,
                  start: {
                    line: 3,
                    column: 1,
                  },
                  end: {
                    line: 3,
                    column: 28,
                  },
                },
              ],
            },
          ],
        },
        {
          origin: '@parcel/transformer-js',
          message: 'Mutating process.env is not supported',
          hints: null,
          codeFrames: [
            {
              filePath,
              codeHighlights: [
                {
                  message: null,
                  start: {
                    line: 4,
                    column: 1,
                  },
                  end: {
                    line: 4,
                    column: 23,
                  },
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it('should warn on process.env mutations in node_modules', async function() {
    let logs = [];
    let disposable = Logger.onLog(d => logs.push(d));
    let b = await bundle(
      path.join(__dirname, '/integration/env-mutate/warn.js'),
    );
    disposable.dispose();

    assert.deepEqual(logs, [
      {
        type: 'log',
        level: 'warn',
        diagnostics: [
          {
            origin: '@parcel/transformer-js',
            message: 'Mutating process.env is not supported',
            hints: null,
            codeFrames: [
              {
                filePath: path.join(
                  __dirname,
                  '/integration/env-mutate/node_modules/foo/index.js',
                ),
                codeHighlights: [
                  {
                    message: null,
                    start: {
                      line: 1,
                      column: 8,
                    },
                    end: {
                      line: 1,
                      column: 36,
                    },
                  },
                ],
              },
            ],
          },
          {
            origin: '@parcel/transformer-js',
            message: 'Mutating process.env is not supported',
            hints: null,
            codeFrames: [
              {
                filePath: path.join(
                  __dirname,
                  '/integration/env-mutate/node_modules/foo/index.js',
                ),
                codeHighlights: [
                  {
                    message: null,
                    start: {
                      line: 2,
                      column: 8,
                    },
                    end: {
                      line: 2,
                      column: 35,
                    },
                  },
                ],
              },
            ],
          },
          {
            origin: '@parcel/transformer-js',
            message: 'Mutating process.env is not supported',
            hints: null,
            codeFrames: [
              {
                filePath: path.join(
                  __dirname,
                  '/integration/env-mutate/node_modules/foo/index.js',
                ),
                codeHighlights: [
                  {
                    message: null,
                    start: {
                      line: 3,
                      column: 8,
                    },
                    end: {
                      line: 3,
                      column: 30,
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);

    let output = [];
    await run(b, {
      output(o) {
        output.push(o);
      },
    });
    assert.deepEqual(output, ['foo', true, undefined]);
  });

  it('should replace process.browser for target browser', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/process/index.js'),
      {
        targets: {
          main: {
            context: 'browser',
            distDir: path.join(__dirname, '/integration/process/dist.js'),
          },
        },
      },
    );

    let output = await run(b);
    assert.ok(output.toString().indexOf('process.browser') === -1);
    assert.equal(output(), true);
  });

  it('should not touch process.browser for target node', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/process/index.js'),
      {
        targets: {
          main: {
            context: 'node',
            distDir: path.join(__dirname, '/integration/process/dist.js'),
          },
        },
      },
    );

    let output = await run(b);
    assert.ok(output.toString().indexOf('process.browser') !== -1);
    assert.equal(output(), false);
  });

  it('should not touch process.browser for target electron-main', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/process/index.js'),
      {
        targets: {
          main: {
            context: 'electron-main',
            distDir: path.join(__dirname, '/integration/process/dist.js'),
          },
        },
      },
    );

    let output = await run(b);
    assert.ok(output.toString().indexOf('process.browser') !== -1);
    assert.equal(output(), false);
  });

  it('should replace process.browser for target electron-renderer', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/process/index.js'),
      {
        targets: {
          main: {
            context: 'electron-renderer',
            distDir: path.join(__dirname, '/integration/process/dist.js'),
          },
        },
      },
    );

    let output = await run(b);
    assert.ok(output.toString().indexOf('process.browser') === -1);
    assert.equal(output(), true);
    // Running the bundled code has the side effect of setting process.browser = true, which can mess
    // up the instantiation of typescript.sys within validator-typescript, so we want to reset it.
    process.browser = undefined;
  });

  it.skip('should support adding implicit dependencies', async function() {
    let b = await bundle(path.join(__dirname, '/integration/json/index.js'), {
      delegate: {
        getImplicitDependencies(asset) {
          if (asset.basename === 'index.js') {
            return [{name: '../css/index.css'}];
          }
        },
      },
    });

    assertBundles(b, {
      name: 'index.js',
      assets: ['index.js', 'local.json', 'index.css'],
      childBundles: [
        {
          type: 'css',
          assets: ['index.css'],
        },
        {
          type: 'map',
        },
      ],
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should support requiring YAML files', async function() {
    let b = await bundle(path.join(__dirname, '/integration/yaml/index.js'));

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'local.yaml'],
        childBundles: [
          {
            type: 'map',
          },
        ],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should support requiring TOML files', async function() {
    let b = await bundle(path.join(__dirname, '/integration/toml/index.js'));

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'local.toml'],
        childBundles: [
          {
            type: 'map',
          },
        ],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should support requiring CoffeeScript files', async function() {
    let b = await bundle(path.join(__dirname, '/integration/coffee/index.js'));

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'local.coffee'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should resolve the browser field before main', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/resolve-entries/browser.js'),
    );

    assertBundles(b, [
      {
        name: 'browser.js',
        assets: ['browser.js', 'browser-module.js', 'esmodule-helpers.js'],
      },
    ]);

    let output = await run(b);

    assert.equal(typeof output.test, 'function');
    assert.equal(output.test(), 'pkg-browser');
  });

  it('should exclude resolving specifiers that map to false in the browser field in browser builds', async () => {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/resolve-entries/pkg-ignore-browser/index.js',
      ),
      {
        targets: ['browsers'],
      },
    );

    assert.deepEqual(await run(b), {});
  });

  it('should not exclude resolving specifiers that map to false in the browser field in node builds', async () => {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/resolve-entries/pkg-ignore-browser/index.js',
      ),
      {
        targets: ['node'],
      },
    );

    assert.equal(await run(b), 'this should only exist in non-browser builds');
  });

  it.skip('should not resolve the browser field for --target=node', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/resolve-entries/browser.js'),
      {
        target: 'node',
      },
    );

    assertBundles(b, {
      name: 'browser.js',
      assets: ['browser.js', 'node-module.js'],
      childBundles: [
        {
          type: 'map',
        },
      ],
    });

    let output = await run(b);

    assert.equal(typeof output.test, 'function');
    assert.equal(output.test(), 'pkg-main');
  });

  it.skip('should resolve advanced browser resolution', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/resolve-entries/browser-multiple.js'),
    );

    assertBundles(b, {
      name: 'browser-multiple.js',
      assets: [
        'browser-multiple.js',
        'projected-browser.js',
        'browser-entry.js',
      ],
      childBundles: [
        {
          type: 'map',
        },
      ],
    });

    let {test: output} = await run(b);

    assert.equal(typeof output.projected.test, 'function');
    assert.equal(typeof output.entry.test, 'function');
    assert.equal(output.projected.test(), 'pkg-browser-multiple');
    assert.equal(output.entry.test(), 'pkg-browser-multiple browser-entry');
  });

  it.skip('should not resolve advanced browser resolution with --target=node', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/resolve-entries/browser-multiple.js'),
      {
        target: 'node',
      },
    );

    assertBundles(b, {
      name: 'browser-multiple.js',
      assets: ['browser-multiple.js', 'node-entry.js', 'projected.js'],
      childBundles: [
        {
          type: 'map',
        },
      ],
    });

    let {test: output} = await run(b);

    assert.equal(typeof output.projected.test, 'function');
    assert.equal(typeof output.entry.test, 'function');
    assert.equal(output.projected.test(), 'pkg-main-multiple');
    assert.equal(output.entry.test(), 'pkg-browser-multiple main-entry');
  });

  it.skip('should resolve the module field before main if scope-hoisting is enabled', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/resolve-entries/module-field.js'),
      {
        defaultTargetOptions: {
          shouldScopeHoist: true,
        },
      },
    );

    assertBundles(b, [
      {
        name: 'module-field.js',
        assets: ['module-field.js', 'es6.module.js'],
      },
    ]);

    let output = await run(b);

    assert.equal(typeof output.test, 'function');
    assert.equal(output.test(), 'pkg-es6-module');
  });

  it.skip('should resolve the module field before main if scope-hoisting is enabled', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/resolve-entries/both-fields.js'),
      {
        defaultTargetOptions: {
          shouldScopeHoist: true,
        },
      },
    );

    assertBundles(b, [
      {
        name: 'both-fields.js',
        assets: ['both-fields.js', 'es6.module.js'],
      },
    ]);

    let output = await run(b);

    assert.equal(typeof output.test, 'function');
    assert.equal(output.test(), 'pkg-es6-module');
  });

  it('should resolve the main field', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/resolve-entries/main-field.js'),
    );

    assertBundles(b, [
      {
        name: 'main-field.js',
        assets: ['main-field.js', 'main.js', 'esmodule-helpers.js'],
      },
    ]);

    let output = await run(b);

    assert.equal(typeof output.test, 'function');
    assert.equal(output.test(), 'pkg-main-module');
  });

  it('should minify JSON files', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/uglify-json/index.json'),
      {
        defaultTargetOptions: {
          shouldOptimize: true,
          shouldScopeHoist: false,
        },
      },
    );

    let json = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(json.includes('{"test":"test"}'));

    let output = await run(b);
    assert.deepEqual(output, {test: 'test'});
  });

  it('should minify JSON5 files', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/uglify-json5/index.json5'),
      {
        defaultTargetOptions: {
          shouldOptimize: true,
          shouldScopeHoist: false,
        },
      },
    );

    let json = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(json.includes('{"test":"test"}'));

    let output = await run(b);
    assert.deepEqual(output, {test: 'test'});
  });

  it.skip('should minify YAML for production', async function() {
    let b = await bundle(path.join(__dirname, '/integration/yaml/index.js'), {
      defaultTargetOptions: {
        shouldOptimize: true,
        shouldScopeHoist: false,
      },
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);

    let json = await outputFS.readFile('dist/index.js', 'utf8');
    assert(json.includes('{a:1,b:{c:2}}'));
  });

  it('should minify TOML for production', async function() {
    let b = await bundle(path.join(__dirname, '/integration/toml/index.js'), {
      defaultTargetOptions: {
        shouldOptimize: true,
        shouldScopeHoist: false,
      },
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);

    let json = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(json.includes('{a:1,b:{c:2}}'));
  });

  it('should support optional dependencies in try...catch blocks', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/optional-dep/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js'],
      },
    ]);

    let output = await run(b);

    assert.equal(Object.getPrototypeOf(output).constructor.name, 'Error');
    assert(
      /Cannot find module ['"]optional-dep['"]/.test(output.message),
      'Should set correct error message',
    );
    assert.equal(output.code, 'MODULE_NOT_FOUND');
  });

  it('should support excluding dependencies in falsy branches', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/falsy-dep/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'true-alternate.js', 'true-consequent.js'],
      },
    ]);

    let output = await run(b);
    assert.equal(output, 2);
  });

  it.skip('should not autoinstall if resolve failed on installed module', async function() {
    let error;
    try {
      await bundle(
        path.join(
          __dirname,
          '/integration/dont-autoinstall-resolve-fails/index.js',
        ),
      );
    } catch (err) {
      error = err;
    }
    assert.equal(
      error.message,
      `Cannot resolve dependency 'vue/thisDoesNotExist'`,
    );
    assert.equal(error.code, 'MODULE_NOT_FOUND');
  });

  it.skip('should not autoinstall if resolve failed on aliased module', async function() {
    let error;
    try {
      await bundle(
        path.join(
          __dirname,
          '/integration/dont-autoinstall-resolve-alias-fails/index.js',
        ),
      );
    } catch (err) {
      error = err;
    }
    assert.equal(
      error.message,
      `Cannot resolve dependency 'aliasVue/thisDoesNotExist'`,
    );
    assert.equal(error.code, 'MODULE_NOT_FOUND');
  });

  it('should ignore require if it is defined in the scope', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/require-scope/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js'],
      },
    ]);

    let output = await run(b);

    assert.equal(typeof output.test, 'object');

    let failed = Object.keys(output.test).some(
      key => output.test[key] !== 'test passed',
    );

    assert.equal(failed, false);
  });

  it('should expose to CommonJS entry point', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/entry-point/index.js'),
    );

    let module = {};
    await run(b, {module, exports: {}});
    assert.equal(module.exports(), 'Test!');
  });

  it('should expose to RequireJS entry point', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/entry-point/index.js'),
    );
    let test;
    const mockDefine = function(f) {
      test = f();
    };
    mockDefine.amd = true;

    await run(b, {define: mockDefine, module: undefined});
    assert.equal(test(), 'Test!');
  });

  it.skip('should expose variable with --browser-global', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/entry-point/index.js'),
      {
        global: 'testing',
      },
    );

    const ctx = await run(b, {module: undefined}, {require: false});
    assert.equal(ctx.window.testing(), 'Test!');
  });

  it.skip('should set `define` to undefined so AMD checks in UMD modules do not pass', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/define-amd/index.js'),
    );
    let test;
    const mockDefine = function(f) {
      test = f();
    };
    mockDefine.amd = true;

    await run(b, {define: mockDefine, module: undefined});
    assert.equal(test, 2);
  });

  it('should package successfully with comments on last line', async function() {
    let b = await bundle(
      path.join(__dirname, `/integration/js-comment/index.js`),
    );

    let output = await run(b);
    assert.equal(output, 'Hello World!');
  });

  it('should package successfully with comments on last line and minification', async function() {
    let b = await bundle(
      path.join(__dirname, `/integration/js-comment/index.js`),
    );

    let output = await run(b);
    assert.equal(output, 'Hello World!');
  });

  it('should package successfully with comments on last line and scope hoisting', async function() {
    let b = await bundle(
      path.join(__dirname, `/integration/js-comment/index.js`),
      {
        defaultTargetOptions: {
          shouldScopeHoist: true,
        },
      },
    );

    let output = await run(b);
    assert.equal(output, 'Hello World!');
  });

  it('should package successfully with comments on last line, scope hoisting and minification', async function() {
    let b = await bundle(
      path.join(__dirname, `/integration/js-comment/index.js`),
      {
        defaultTargetOptions: {
          shouldScopeHoist: true,
          shouldOptimize: true,
        },
      },
    );

    let output = await run(b);
    assert.equal(output, 'Hello World!');
  });

  it('should not replace toplevel this with undefined in CommonJS without scope-hoisting', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/js-this-commonjs/a.js'),
    );

    let output;
    function result(v) {
      output = v;
    }
    await run(b, {result});
    assert.deepEqual(output, [{foo: 2}, 1234]);
  });

  it('should not replace toplevel this with undefined in CommonJS when scope-hoisting', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/js-this-commonjs/a.js'),
      {
        defaultTargetOptions: {
          shouldScopeHoist: true,
        },
      },
    );

    let output;
    function result(v) {
      output = v;
    }
    await run(b, {result});
    assert.deepEqual(output, [{foo: 2}, 1234]);
  });

  it('should replace toplevel this with undefined in ESM without scope-hoisting', async function() {
    let b = await bundle(path.join(__dirname, '/integration/js-this-es6/a.js'));

    let output;
    function result(v) {
      output = v;
    }
    await run(b, {result});
    assert.deepEqual(output, [undefined, 1234]);
  });

  it('should replace toplevel this with undefined in ESM when scope-hoisting', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/js-this-es6/a.js'),
      {
        defaultTargetOptions: {
          shouldScopeHoist: true,
        },
      },
    );

    let output;
    function result(v) {
      output = v;
    }
    await run(b, {result});
    assert.deepEqual(output, [undefined, 1234]);
  });

  it.skip('should not dedupe imports with different contents', async function() {
    let b = await bundle(
      path.join(__dirname, `/integration/js-different-contents/index.js`),
      {
        hmr: false, // enable asset dedupe in JSPackager
      },
    );

    let module = await run(b);
    assert.equal(module.default, 'Hello World!');
  });

  it.skip('should not dedupe imports with same content but different absolute dependency paths', async function() {
    let b = await bundle(
      path.join(
        __dirname,
        `/integration/js-same-contents-different-dependencies/index.js`,
      ),
      {
        hmr: false, // enable asset dedupe in JSPackager
      },
    );

    let module = await run(b);
    assert.equal(module.default, 'Hello World!');
  });

  it.skip('should dedupe imports with same content and same dependency paths', async function() {
    let b = await bundle(
      path.join(
        __dirname,
        `/integration/js-same-contents-same-dependencies/index.js`,
      ),
      {
        hmr: false, // enable asset dedupe in JSPackager
      },
    );
    const {rootDir} = b.entryAsset.options;
    const writtenAssets = Array.from(b.offsets.keys()).map(asset => asset.name);
    assert.equal(writtenAssets.length, 2);
    assert(writtenAssets.includes(path.join(rootDir, 'index.js')));
    assert(
      writtenAssets.includes(path.join(rootDir, 'hello1.js')) ||
        writtenAssets.includes(path.join(rootDir, 'hello2.js')),
    );
    assert(
      !(
        writtenAssets.includes(path.join(rootDir, 'hello1.js')) &&
        writtenAssets.includes(path.join(rootDir, 'hello2.js'))
      ),
    );

    let module = await run(b);
    assert.equal(module.default, 'Hello Hello!');
  });

  it.skip('should not dedupe assets that exist in more than one bundle', async function() {
    let b = await bundle(
      path.join(__dirname, `/integration/js-dedup-hoist/index.js`),
      {
        hmr: false, // enable asset dedupe in JSPackager
      },
    );
    const {rootDir} = b.entryAsset.options;
    const writtenAssets = Array.from(b.offsets.keys()).map(asset => asset.name);
    assert(
      writtenAssets.includes(path.join(rootDir, 'hello1.js')) &&
        writtenAssets.includes(path.join(rootDir, 'hello2.js')),
    );

    let module = await run(b);
    assert.equal(await module.default(), 'Hello Hello! Hello');
  });

  it.skip('should support importing HTML from JS async', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/import-html-async/index.js'),
      {
        defaultTargetOptions: {
          sourceMaps: false,
        },
      },
    );

    assertBundles(b, {
      name: 'index.js',
      assets: ['index.js', 'cacheLoader.js', 'html-loader.js'],
      childBundles: [
        {
          type: 'html',
          assets: ['other.html'],
          childBundles: [
            {
              type: 'png',
              assets: ['100x100.png'],
              childBundles: [],
            },
            {
              type: 'css',
              assets: ['index.css'],
            },
          ],
        },
      ],
    });

    let output = await run(b);
    assert.equal(typeof output, 'string');
    assert(output.includes('<html>'));
    assert(output.includes('Other page'));
  });

  it.skip('should support importing HTML from JS async with --target=node', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/import-html-async/index.js'),
      {
        target: 'node',
        defaultTargetOptions: {
          sourceMaps: false,
        },
      },
    );

    assertBundles(b, {
      name: 'index.js',
      assets: ['index.js', 'cacheLoader.js', 'html-loader.js'],
      childBundles: [
        {
          type: 'html',
          assets: ['other.html'],
          childBundles: [
            {
              type: 'png',
              assets: ['100x100.png'],
              childBundles: [],
            },
            {
              type: 'css',
              assets: ['index.css'],
            },
          ],
        },
      ],
    });

    let output = await run(b);
    assert.equal(typeof output, 'string');
    assert(output.includes('<html>'));
    assert(output.includes('Other page'));
  });

  it.skip('should support importing HTML from JS sync', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/import-html-sync/index.js'),
      {
        defaultTargetOptions: {
          sourceMaps: false,
        },
      },
    );

    assertBundles(b, {
      name: 'index.js',
      assets: ['index.js', 'cacheLoader.js', 'html-loader.js'],
      childBundles: [
        {
          type: 'html',
          assets: ['other.html'],
          childBundles: [
            {
              type: 'png',
              assets: ['100x100.png'],
              childBundles: [],
            },
            {
              type: 'css',
              assets: ['index.css'],
            },
          ],
        },
      ],
    });

    let {deferred, promise} = makeDeferredWithPromise();
    await run(b, {output: deferred.resolve}, {require: false});
    let output = await promise;
    assert.equal(typeof output, 'string');
    assert(output.includes('<html>'));
    assert(output.includes('Other page'));
  });

  it.skip('should stub require.cache', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/node_require_cache/main.js'),
      {
        target: 'node',
      },
    );

    await run(b);
  });

  it('should support async importing the same module from different bundles', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/shared-bundlegroup/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'bundle-url.js',
          'cacheLoader.js',
          'esmodule-helpers.js',
          'js-loader.js',
        ],
      },
      {
        assets: ['a.js'],
      },
      {
        assets: ['b.js'],
      },
      {
        assets: ['c.js'],
      },
    ]);

    let {default: promise} = await run(b);
    assert.deepEqual(await promise, ['hello from a test', 'hello from b test']);
  });

  it('should not create shared bundles from contents of entries', async () => {
    let b = await bundle(
      ['a.js', 'b.js'].map(entry =>
        path.join(
          __dirname,
          '/integration/no-shared-bundles-from-entries/',
          entry,
        ),
      ),
    );

    assertBundles(b, [
      {
        name: 'a.js',
        assets: ['a.js', 'esmodule-helpers.js', 'lodash.js'],
      },
      {
        name: 'b.js',
        assets: ['b.js', 'esmodule-helpers.js', 'lodash.js'],
      },
    ]);
  });

  it('should import the same dependency multiple times in the same bundle', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/same-dependency-multiple-times/a1.js'),
    );

    await run(b);
  });

  it("should inline a bundle's compiled text with `bundle-text`", async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/bundle-text/index.js'),
    );

    let cssBundleContent = (await run(b)).default;

    assert(
      cssBundleContent.startsWith(
        `body {
  background-color: #000000;
}

.svg-img {
  background-image: url("data:image/svg+xml,%3Csvg%3E%0A%0A%3C%2Fsvg%3E%0A");
}`,
      ),
    );

    assert(!cssBundleContent.includes('sourceMappingURL'));
  });

  it('should not include the runtime manifest for `bundle-text`', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/bundle-text/index.js'),
      {
        mode: 'production',
        defaultTargetOptions: {shouldScopeHoist: false, shouldOptimize: false},
      },
    );

    assertBundles(b, [
      {
        name: 'index.js',
        type: 'js',
        assets: ['esmodule-helpers.js', 'index.js'],
      },
      {
        type: 'svg',
        assets: ['img.svg'],
      },
      {
        type: 'css',
        assets: ['text.scss'],
      },
    ]);

    let cssBundleContent = (await run(b)).default;

    assert(
      cssBundleContent.startsWith(
        `body {
  background-color: #000000;
}

.svg-img {
  background-image: url("data:image/svg+xml,%3Csvg%3E%0A%0A%3C%2Fsvg%3E%0A");
}`,
      ),
    );

    assert(!cssBundleContent.includes('sourceMappingURL'));
  });

  it("should inline an HTML bundle's compiled text with `bundle-text`", async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/bundle-text/index.html'),
    );

    let res = await run(b);
    assert.equal(res.default, '<p>test</p>\n');
  });

  it('should inline an HTML bundle and inline scripts with `bundle-text`', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/bundle-text/inline.js'),
    );

    let res = await run(b);
    assert.equal(
      res.default,
      "<p>test</p>\n<script>console.log('hi');\n\n</script>\n",
    );
  });

  it("should inline a JS bundle's compiled text with `bundle-text` and HMR enabled", async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/bundle-text/javascript.js'),
      {
        hmrOptions: {},
      },
    );

    let res = await run(b);
    let log;
    let ctx = vm.createContext({
      console: {
        log(x) {
          log = x;
        },
      },
    });
    vm.runInContext(res.default, ctx);
    assert.equal(log, 'hi');
  });

  it("should inline a JS bundle's compiled text with `bundle-text` with symbol propagation", async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/bundle-text/javascript.js'),
      {
        mode: 'production',
      },
    );

    let res = await run(b);
    let log;
    let ctx = vm.createContext({
      console: {
        log(x) {
          log = x;
        },
      },
    });
    vm.runInContext(res, ctx);
    assert.equal(log, 'hi');
  });

  it("should inline a bundle's compiled text with `bundle-text` asynchronously", async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/bundle-text/async.js'),
    );

    let promise = (await run(b)).default;
    assert.equal(typeof promise.then, 'function');

    let cssBundleContent = await promise;

    assert(
      cssBundleContent.startsWith(
        `body {
  background-color: #000000;
}

.svg-img {
  background-image: url("data:image/svg+xml,%3Csvg%3E%0A%0A%3C%2Fsvg%3E%0A");
}`,
      ),
    );

    assert(!cssBundleContent.includes('sourceMappingURL'));
  });

  it('should inline text content as url-encoded text and mime type with `data-url:*` imports', async () => {
    let b = await bundle(path.join(__dirname, '/integration/data-url/text.js'));

    assert.equal(
      (await run(b)).default,
      'data:image/svg+xml,%3Csvg%20width%3D%22120%22%20height%3D%22120%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%0A%20%20%3Cfilter%20id%3D%22blur-_.%21~%2a%22%3E%0A%20%20%20%20%3CfeGaussianBlur%20stdDeviation%3D%225%22%3E%3C%2FfeGaussianBlur%3E%0A%20%20%3C%2Ffilter%3E%0A%20%20%3Ccircle%20cx%3D%2260%22%20cy%3D%2260%22%20r%3D%2250%22%20fill%3D%22green%22%20filter%3D%22url%28%27%23blur-_.%21~%2a%27%29%22%3E%3C%2Fcircle%3E%0A%3C%2Fsvg%3E%0A',
    );
  });

  it('should inline binary content as url-encoded base64 and mime type with `data-url:*` imports', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/data-url/binary.js'),
    );
    ``;

    assert((await run(b)).default.startsWith('data:image/webp;base64,UklGR'));
  });

  it('should support both pipeline and non-pipeline imports', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/multi-pipeline/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'esmodule-helpers.js'],
      },
      {
        name: 'index.css',
        assets: ['style.css'],
      },
      {
        type: 'css',
        assets: ['style.css'],
      },
    ]);

    assert((await run(b)).default.startsWith('.test'));
  });

  it('should detect typescript style async requires in commonjs', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/require-async/ts.js'),
    );

    assertBundles(b, [
      {
        name: 'ts.js',
        assets: ['ts.js', 'bundle-url.js', 'cacheLoader.js', 'js-loader.js'],
      },
      {
        assets: ['async.js'],
      },
    ]);

    assert.equal(await run(b), 2);
  });

  it('should detect typescript style async requires in commonjs with esModuleInterop flag', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/require-async/ts-interop.js'),
    );

    assertBundles(b, [
      {
        name: 'ts-interop.js',
        assets: [
          'ts-interop.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
        ],
      },
      {
        assets: ['async.js'],
      },
    ]);

    assert.deepEqual(await run(b), {default: 2});

    let jsBundle = b.getBundles()[0];
    let contents = await outputFS.readFile(jsBundle.filePath, 'utf8');
    assert(
      /.then\(function\(res\) {\n.*return __importStar\(res\)/.test(contents),
    );
  });

  it('should detect typescript style async requires in commonjs with esModuleInterop flag and arrow functions', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/require-async/ts-interop-arrow.js'),
    );

    assertBundles(b, [
      {
        name: 'ts-interop-arrow.js',
        assets: [
          'ts-interop-arrow.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
        ],
      },
      {
        assets: ['async.js'],
      },
    ]);

    assert.deepEqual(await run(b), {default: 2});

    let jsBundle = b.getBundles()[0];
    let contents = await outputFS.readFile(jsBundle.filePath, 'utf8');
    assert(/.then\(\(res\)=>__importStar\(res\)/.test(contents));
  });

  it('should detect rollup style async requires in commonjs', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/require-async/rollup.js'),
    );

    assertBundles(b, [
      {
        name: 'rollup.js',
        assets: [
          'rollup.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
        ],
      },
      {
        assets: ['async.js'],
      },
    ]);

    assert.equal(await run(b), 2);
  });

  it('should only detect requires that are returned from the promise', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/require-async/sync.js'),
    );

    assertBundles(b, [
      {
        name: 'sync.js',
        assets: ['sync.js', 'async.js'],
      },
    ]);

    assert.equal(await run(b), 5);
  });

  it('should detect parcel style async requires in commonjs', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/require-async/parcel.js'),
    );

    assertBundles(b, [
      {
        name: 'parcel.js',
        assets: [
          'parcel.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
        ],
      },
      {
        assets: ['async.js'],
      },
    ]);

    assert.equal(await run(b), 2);
  });

  it('only updates bundle names of changed bundles for browsers', async () => {
    let fixtureDir = path.join(__dirname, '/integration/name-invalidation');
    let _bundle = () =>
      bundle(path.join(fixtureDir, 'index.js'), {
        inputFS: overlayFS,
        mode: 'production',
        defaultTargetOptions: {
          shouldScopeHoist: false,
          shouldOptimize: false,
        },
      });

    let first = await _bundle();
    assert.equal(await (await run(first)).default, 42);

    let bPath = path.join(fixtureDir, 'b.js');
    await overlayFS.mkdirp(fixtureDir);
    overlayFS.writeFile(
      bPath,
      (await overlayFS.readFile(bPath, 'utf8')).replace('42', '43'),
    );

    let second = await _bundle();
    assert.equal(await (await run(second)).default, 43);

    let getBundleNameWithPrefix = (b, prefix) =>
      b
        .getBundles()
        .map(bundle => path.basename(bundle.filePath))
        .find(name => name.startsWith(prefix));

    assert.equal(
      getBundleNameWithPrefix(first, 'a'),
      getBundleNameWithPrefix(second, 'a'),
    );
    assert.notEqual(
      getBundleNameWithPrefix(first, 'b'),
      getBundleNameWithPrefix(second, 'b'),
    );
  });

  it('can load the same resource when referenced in multiple bundles', async () => {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/same-resource-multiple-bundles/index.js',
      ),
    );

    let res = await run(b);
    assert(url.parse(await res.default()).pathname.startsWith('/resource'));
  });

  it('can static import and dynamic import in the same bundle without creating a new bundle', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/sync-async/same-bundle.js'),
      {mode: 'production', defaultTargetOptions: {shouldScopeHoist: false}},
    );

    assertBundles(b, [
      {
        name: 'same-bundle.js',
        assets: [
          'same-bundle.js',
          'get-dep.js',
          'get-dep-2.js',
          'dep.js',
          'esmodule-helpers.js',
        ],
      },
    ]);

    assert.deepEqual(await (await run(b)).default, [42, 42, 42]);
  });

  it('can static import and dynamic import in the same bundle ancestry without creating a new bundle', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/sync-async/same-ancestry.js'),
      {mode: 'production', defaultTargetOptions: {shouldScopeHoist: false}},
    );

    assertBundles(b, [
      {
        name: 'same-ancestry.js',
        assets: [
          'bundle-manifest.js',
          'bundle-url.js',
          'cacheLoader.js',
          'dep.js',
          'js-loader.js',
          'same-ancestry.js',
          'esmodule-helpers.js',
        ],
      },
      {
        assets: ['get-dep.js'],
      },
    ]);

    assert.deepEqual(await (await run(b)).default, [42, 42]);
  });

  it('can static import and dynamic import in the same bundle when another bundle requires async', async () => {
    let b = await bundle(
      ['same-bundle.js', 'get-dep.js'].map(entry =>
        path.join(__dirname, '/integration/sync-async/', entry),
      ),
      {
        mode: 'production',
        defaultTargetOptions: {
          shouldScopeHoist: false,
        },
      },
    );

    assertBundles(b, [
      {
        assets: ['dep.js'],
      },
      {
        name: 'same-bundle.js',
        assets: [
          'same-bundle.js',
          'get-dep.js',
          'get-dep-2.js',
          'dep.js',
          'esmodule-helpers.js',
        ],
      },
      {
        name: 'get-dep.js',
        assets: [
          'bundle-manifest.js',
          'bundle-url.js',
          'cacheLoader.js',
          'get-dep.js',
          'js-loader.js',
          'esmodule-helpers.js',
        ],
      },
    ]);

    let bundles = b.getBundles();
    let sameBundle = bundles.find(b => b.name === 'same-bundle.js');
    let getDep = bundles.find(b => b.name === 'get-dep.js');

    assert.deepEqual(await (await runBundle(b, sameBundle)).default, [
      42,
      42,
      42,
    ]);
    assert.deepEqual(await (await runBundle(b, getDep)).default, 42);
  });

  it("can share dependencies between a shared bundle and its sibling's descendants", async () => {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/shared-exports-for-sibling-descendant/index.js',
      ),
      {
        mode: 'production',
        defaultTargetOptions: {
          shouldScopeHoist: false,
        },
      },
    );

    assertBundles(b, [
      {
        assets: ['wraps.js', 'lodash.js'],
      },
      {
        assets: ['a.js'],
      },
      {
        assets: ['child.js'],
      },
      {
        assets: ['grandchild.js'],
      },
      {
        assets: ['b.js'],
      },
      {
        name: 'index.js',
        assets: [
          'bundle-manifest.js',
          'bundle-url.js',
          'cacheLoader.js',
          'index.js',
          'js-loader.js',
          'esmodule-helpers.js',
        ],
      },
    ]);

    assert.deepEqual(await (await run(b)).default, [3, 5]);
  });

  it('can run an entry bundle whose entry asset is present in another bundle', async () => {
    let b = await bundle(
      ['index.js', 'value.js'].map(basename =>
        path.join(__dirname, '/integration/sync-entry-shared', basename),
      ),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
          'esmodule-helpers.js',
        ],
      },
      {name: 'value.js', assets: ['value.js', 'esmodule-helpers.js']},
      {assets: ['async.js']},
    ]);

    assert.equal(await (await run(b)).default, 43);
  });

  it('can run an async bundle whose entry asset is present in another bundle', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/async-entry-shared/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
          'esmodule-helpers.js',
        ],
      },
      {assets: ['value.js']},
      {assets: ['async.js']},
    ]);

    assert.deepEqual(await (await run(b)).default, [42, 43]);
  });

  it('should display a codeframe on a Terser parse error', async () => {
    let fixture = path.join(__dirname, 'integration/terser-codeframe/index.js');
    let code = await inputFS.readFileSync(fixture, 'utf8');
    await assert.rejects(
      () =>
        bundle(fixture, {
          defaultTargetOptions: {
            shouldOptimize: true,
          },
        }),
      {
        name: 'BuildError',
        diagnostics: [
          {
            message: 'Name expected',
            origin: '@parcel/optimizer-terser',
            codeFrames: [
              {
                filePath: undefined,
                language: 'js',
                code,
                codeHighlights: [
                  {
                    message: 'Name expected',
                    start: {
                      column: 4,
                      line: 1,
                    },
                    end: {
                      column: 4,
                      line: 1,
                    },
                  },
                ],
              },
            ],
            hints: ["It's likely that Terser doesn't support this syntax yet."],
          },
        ],
      },
    );
  });

  it('can run an async bundle that depends on a nonentry asset in a sibling', async () => {
    let b = await bundle(
      ['index.js', 'other-entry.js'].map(basename =>
        path.join(
          __dirname,
          '/integration/async-entry-shared-sibling',
          basename,
        ),
      ),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
          'esmodule-helpers.js',
        ],
      },
      {
        name: 'other-entry.js',
        assets: [
          'other-entry.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
        ],
      },
      {assets: ['a.js', 'value.js', 'esmodule-helpers.js']},
      {assets: ['b.js']},
    ]);

    assert.deepEqual(await (await run(b)).default, 43);
  });

  it('can share sibling bundles reachable from a common dependency', async () => {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/shared-sibling-common-dependency/index.js',
      ),
    );

    let bundles = b.getBundles();
    let asyncJsBundles = bundles.filter(
      b => !b.needsStableName && b.type === 'js',
    );
    assert.equal(asyncJsBundles.length, 2);

    // Every bundlegroup with an async js bundle should have the corresponding css
    for (let bundle of asyncJsBundles) {
      for (let bundleGroup of b.getBundleGroupsContainingBundle(bundle)) {
        let bundlesInGroup = b.getBundlesInBundleGroup(bundleGroup);
        assert(bundlesInGroup.find(s => s.type === 'css'));
      }
    }
  });

  it('should throw a diagnostic for unkown pipelines', async function() {
    let fixture = path.join(__dirname, 'integration/pipeline-unknown/a.js');
    let code = await inputFS.readFileSync(fixture, 'utf8');
    await assert.rejects(() => bundle(fixture), {
      name: 'BuildError',
      diagnostics: [
        {
          message: "Failed to resolve 'strange-pipeline:./b.js' from './a.js'",
          origin: '@parcel/core',
          codeFrames: [
            {
              filePath: fixture,
              code,
              codeHighlights: [
                {
                  start: {
                    column: 19,
                    line: 1,
                  },
                  end: {
                    column: 43,
                    line: 1,
                  },
                },
              ],
            },
          ],
        },
        {
          message: "Unknown url scheme or pipeline 'strange-pipeline:'",
          origin: '@parcel/resolver-default',
        },
      ],
    });
  });

  it('can create a bundle starting with a dot', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/dotfile-bundle/index.js'),
    );

    assertBundles(b, [
      {
        name: '.output.js',
        assets: ['index.js'],
      },
    ]);
  });

  it('should not automatically name bundle files starting with a dot', async function() {
    await bundle(
      path.join(__dirname, '/integration/bundle-naming/.invisible/index.js'),
    );
    let bundleFiles = await outputFS.readdir(distDir);
    let renamedSomeFiles = bundleFiles.some(currFile =>
      currFile.startsWith('invisible.'),
    );
    let namedWithDot = bundleFiles.some(currFile =>
      currFile.startsWith('.invisible.'),
    );
    assert.equal(renamedSomeFiles, true);
    assert.equal(namedWithDot, false);
  });

  it('should support duplicate re-exports without scope hoisting', async function() {
    let b = await bundle(
      path.join(__dirname, 'integration/js-duplicate-re-exports/index.js'),
    );
    let res = await run(b);
    assert.equal(res.a, 'a');
    assert.equal(res.b, 'b');
    assert.equal(typeof res.c, 'function');
  });

  it('should prioritize named exports before re-exports withput scope hoisting (before)', async () => {
    let b = await bundle(
      path.join(
        __dirname,
        'integration/scope-hoisting/es6/re-export-priority/entry-a.mjs',
      ),
    );

    let res = await run(b, null, {require: false});
    assert.equal(res.output, 2);
  });

  it('should prioritize named exports before re-exports without scope hoisting (after)', async () => {
    let b = await bundle(
      path.join(
        __dirname,
        'integration/scope-hoisting/es6/re-export-priority/entry-b.mjs',
      ),
    );

    let res = await run(b, null, {require: false});
    assert.equal(res.output, 2);
  });

  it('should exclude default from export all declaration', async function() {
    let b = await bundle(
      path.join(__dirname, 'integration/js-export-all/index.js'),
    );
    let res = await run(b);
    assert.deepEqual(res, {a: 4});
  });

  it('should support import namespace declarations of other ES modules', async function() {
    let b = await bundle(
      path.join(__dirname, 'integration/js-import-namespace/a.js'),
    );
    let res = await run(b);
    assert.deepEqual(res, {a: 4, default: 1});
  });

  it('should support import namespace declarations of class from CJS', async function() {
    let b = await bundle(
      path.join(__dirname, 'integration/js-import-namespace/b.js'),
    );
    let res = await run(b);
    assert.equal(typeof res, 'function');
  });

  it('should support import namespace declarations of object from CJS', async function() {
    let b = await bundle(
      path.join(__dirname, 'integration/js-import-namespace/c.js'),
    );
    let res = await run(b);
    assert.deepEqual(res, {foo: 2, default: 3});
  });

  it('should support export namespace declarations', async function() {
    let b = await bundle(
      path.join(__dirname, 'integration/js-export-namespace/index.js'),
    );
    let res = await run(b);
    assert.deepEqual(res, {ns: {a: 4, default: 1}});
  });

  it('should support export default declarations', async function() {
    let b = await bundle(
      path.join(__dirname, 'integration/js-export-default/index.js'),
    );
    let res = await run(b);
    assert.deepEqual(res, {other: 1});
  });

  it('should work with many different types of exports', async function() {
    let b = await bundle(
      path.join(__dirname, 'integration/js-export-many/index.js'),
    );
    let res = await run(b);
    assert.deepEqual(res, {
      foo: 'foo',
      bar: 'bar',
      default: 'baz',
      boo: 'boo',
      foobar: 'foobar',
      type1: 'type1',
      type2: 'type2',
    });
  });

  it('should correctly export functions', async function() {
    let b = await bundle(
      path.join(__dirname, 'integration/js-export-functions/index.js'),
    );
    let res = await run(b);
    assert.deepEqual(Object.keys(res), ['foo', 'bar']);
    assert.strictEqual(res.foo('test'), 'foo:test');
    assert.strictEqual(res.bar('test'), 'bar:test');
  });

  it('should handle exports of imports', async function() {
    let b = await bundle(
      path.join(__dirname, 'integration/js-export-import/index.js'),
    );
    let res = await run(b);
    assert.deepEqual(res, {other: 2});
  });

  it('should handle simultaneous import and reexports of the same identifier', async function() {
    let b = await bundle(
      path.join(__dirname, 'integration/js-export-import-same/index.js'),
    );
    let res = await run(b);
    assert.deepEqual(res, {foo: '123', bar: '1234'});
  });

  it('should generate a unique variable name for imports', async function() {
    let b = await bundle(
      path.join(__dirname, 'integration/js-import-shadow/index.js'),
    );
    let res = await run(b);
    assert.strictEqual(res.baz(), 'foo');
  });

  it('should not replace identifier with a var declaration inside a for loop', async function() {
    let b = await bundle(
      path.join(__dirname, 'integration/js-import-shadow-for-var/index.js'),
    );
    let res = await run(b);
    assert.deepEqual(res.baz(), [0, 1, 2, 3]);
  });

  it('should replace an imported identifier with function locals of the same name', async function() {
    let b = await bundle(
      path.join(__dirname, 'integration/js-import-shadow-func-var/index.js'),
    );
    let res = await run(b);
    assert.deepEqual(res.default, 123);
  });

  it('should not freeze live default imports', async function() {
    let b = await bundle(
      path.join(__dirname, 'integration/js-import-default-live/index.js'),
    );
    let res = await run(b);
    assert.deepEqual(res.default, [123, 789]);
  });

  it('should not rewrite this in arrow function class properties', async function() {
    let b = await bundle(
      path.join(__dirname, 'integration/js-class-this-esm/a.js'),
    );
    let res = await run(b);
    assert.deepEqual(res.default, 'x: 123');
  });

  it('should only replace free references to require', async () => {
    let b = await bundle(
      path.join(__dirname, 'integration/js-require-free/index.js'),
    );
    let output;
    await run(b, {
      output(v) {
        output = v;
      },
    });
    assert.strictEqual(output, 'a');
  });

  it('should only replace free references to require with scope hoisting', async () => {
    let b = await bundle(
      path.join(__dirname, 'integration/js-require-free/index.js'),
      {
        mode: 'production',
      },
    );
    let output;
    await run(b, {
      output(v) {
        output = v;
      },
    });
    assert.strictEqual(output, 'a');
  });

  it('should support runtime module deduplication', async function() {
    let b = await bundle(
      path.join(__dirname, 'integration/js-runtime-dedup/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'bundle-url.js', 'cacheLoader.js', 'js-loader.js'],
      },
      {
        assets: ['async1.js', 'shared.js', 'esmodule-helpers.js'],
      },
      {
        assets: ['async2.js', 'shared.js', 'esmodule-helpers.js'],
      },
    ]);

    let res = await run(b);
    assert.equal(await res, true);
  });

  it('should support runtime module deduplication with scope hoisting', async function() {
    let b = await bundle(
      path.join(__dirname, 'integration/js-runtime-dedup/index.js'),
      {
        mode: 'production',
      },
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
          'bundle-manifest.js',
        ],
      },
      {
        assets: ['async1.js', 'shared.js'],
      },
      {
        assets: ['async2.js', 'shared.js'],
      },
    ]);

    let res = await run(b);
    assert.equal(await res, true);
  });

  it('should remap locations in diagnostics using the input source map', async () => {
    let fixture = path.join(
      __dirname,
      'integration/diagnostic-sourcemap/index.js',
    );
    let code = await inputFS.readFileSync(fixture, 'utf8');
    await assert.rejects(
      () =>
        bundle(fixture, {
          defaultTargetOptions: {
            shouldOptimize: true,
          },
        }),
      {
        name: 'BuildError',
        diagnostics: [
          {
            message: "Failed to resolve 'foo' from './index.js'",
            origin: '@parcel/core',
            codeFrames: [
              {
                filePath: fixture,
                code,
                codeHighlights: [
                  {
                    start: {
                      line: 11,
                      column: 17,
                    },
                    end: {
                      line: 11,
                      column: 21,
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    );
  });

  it('should create a shared bundle from a minimum of 2 source bundles', async function() {
    let b = await bundle(
      path.join(__dirname, 'integration/shared-bundle-single-source/index.js'),
      {
        mode: 'production',
        defaultTargetOptions: {
          shouldScopeHoist: false,
        },
      },
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'bundle-url.js',
          'cacheLoader.js',
          'css-loader.js',
          'esmodule-helpers.js',
          'js-loader.js',
          'bundle-manifest.js',
        ],
      },
      {
        assets: ['bar.js'],
      },
      {
        assets: ['a.js', 'b.js', 'foo.js'],
      },
      {
        assets: ['styles.css'],
      },
      {
        assets: ['local.html'],
      },
    ]);
  });

  it('should error on undeclared external dependencies for libraries', async function() {
    let fixture = path.join(
      __dirname,
      'integration/undeclared-external/index.js',
    );
    let pkg = path.join(
      __dirname,
      'integration/undeclared-external/package.json',
    );
    await assert.rejects(
      () =>
        bundle(fixture, {
          mode: 'production',
          defaultTargetOptions: {
            shouldOptimize: false,
          },
        }),
      {
        name: 'BuildError',
        diagnostics: [
          {
            message: "Failed to resolve 'lodash' from './index.js'",
            origin: '@parcel/core',
            codeFrames: [
              {
                code: await inputFS.readFile(fixture, 'utf8'),
                filePath: fixture,
                codeHighlights: [
                  {
                    start: {
                      line: 1,
                      column: 19,
                    },
                    end: {
                      line: 1,
                      column: 26,
                    },
                  },
                ],
              },
            ],
          },
          {
            message:
              'External dependency "lodash" is not declared in package.json.',
            origin: '@parcel/resolver-default',
            codeFrames: [
              {
                code: await inputFS.readFile(pkg, 'utf8'),
                filePath: pkg,
                language: 'json',
                codeHighlights: [
                  {
                    message: undefined,
                    start: {
                      line: 5,
                      column: 3,
                    },
                    end: {
                      line: 5,
                      column: 16,
                    },
                  },
                ],
              },
            ],
            hints: ['Add "lodash" as a dependency.'],
          },
        ],
      },
    );
  });

  it('should error on undeclared helpers dependency for libraries', async function() {
    let fixture = path.join(
      __dirname,
      'integration/undeclared-external/helpers.js',
    );
    let pkg = path.join(
      __dirname,
      'integration/undeclared-external/package.json',
    );
    await assert.rejects(
      () =>
        bundle(fixture, {
          mode: 'production',
          defaultTargetOptions: {
            shouldOptimize: false,
          },
        }),
      {
        name: 'BuildError',
        diagnostics: [
          {
            message: `Failed to resolve '@swc/helpers' from '${normalizePath(
              require.resolve('@parcel/transformer-js/src/JSTransformer.js'),
            )}'`,
            origin: '@parcel/core',
            codeFrames: [
              {
                code: await inputFS.readFile(fixture, 'utf8'),
                filePath: fixture,
                codeHighlights: [
                  {
                    start: {
                      line: 1,
                      column: 1,
                    },
                    end: {
                      line: 1,
                      column: 0,
                    },
                  },
                ],
              },
            ],
          },
          {
            message:
              'External dependency "@swc/helpers" is not declared in package.json.',
            origin: '@parcel/resolver-default',
            codeFrames: [
              {
                code: await inputFS.readFile(pkg, 'utf8'),
                filePath: pkg,
                language: 'json',
                codeHighlights: [
                  {
                    message: undefined,
                    start: {
                      line: 5,
                      column: 3,
                    },
                    end: {
                      line: 5,
                      column: 16,
                    },
                  },
                ],
              },
            ],
            hints: ['Add "@swc/helpers" as a dependency.'],
          },
        ],
      },
    );
  });

  describe('multiple import types', function() {
    it('supports both static and dynamic imports to the same specifier in the same file', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          'integration/multiple-import-types/static-dynamic.js',
        ),
      );

      assertBundles(b, [
        {
          type: 'js',
          assets: ['static-dynamic.js', 'other.js', 'esmodule-helpers.js'],
        },
      ]);

      let res = await run(b);
      assert.equal(typeof res.Foo, 'function');
      assert.equal(typeof res.LazyFoo, 'object');
      assert.equal(res.Foo, await res.LazyFoo);
    });

    it('supports both static and dynamic imports to the same specifier in the same file with scope hoisting', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          'integration/multiple-import-types/static-dynamic.js',
        ),
        {
          defaultTargetOptions: {
            outputFormat: 'esmodule',
            isLibrary: true,
            shouldScopeHoist: true,
          },
        },
      );

      assertBundles(b, [
        {
          type: 'js',
          assets: ['static-dynamic.js', 'other.js'],
        },
      ]);

      let res = await run(b);
      assert.equal(typeof res.Foo, 'function');
      assert.equal(typeof res.LazyFoo, 'object');
      assert.equal(res.Foo, await res.LazyFoo);
    });

    it('supports static, dynamic, and url to the same specifier in the same file', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          'integration/multiple-import-types/static-dynamic-url.js',
        ),
      );

      assertBundles(b, [
        {
          type: 'js',
          assets: [
            'static-dynamic-url.js',
            'other.js',
            'esmodule-helpers.js',
            'bundle-url.js',
          ],
        },
        {
          type: 'js',
          assets: ['other.js', 'esmodule-helpers.js'],
        },
      ]);

      let res = await run(b);
      assert.equal(typeof res.Foo, 'function');
      assert.equal(typeof res.LazyFoo, 'object');
      assert.equal(res.Foo, await res.LazyFoo);
      assert.equal(
        res.url,
        'http://localhost/' + path.basename(b.getBundles()[1].filePath),
      );
    });

    it('supports static, dynamic, and url to the same specifier in the same file with scope hoisting', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          'integration/multiple-import-types/static-dynamic-url.js',
        ),
        {
          defaultTargetOptions: {
            outputFormat: 'esmodule',
            isLibrary: true,
            shouldScopeHoist: true,
          },
        },
      );

      assertBundles(b, [
        {
          type: 'js',
          assets: ['static-dynamic-url.js', 'other.js'],
        },
        {
          type: 'js',
          assets: ['other.js'],
        },
      ]);

      let res = await run(b);
      assert.equal(typeof res.Foo, 'function');
      assert.equal(typeof res.LazyFoo, 'object');
      assert.equal(res.Foo, await res.LazyFoo);
      assert.equal(
        res.url,
        'http://localhost/' + path.basename(b.getBundles()[1].filePath),
      );
    });

    it('supports dynamic import and url to the same specifier in the same file', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          'integration/multiple-import-types/dynamic-url.js',
        ),
      );

      assertBundles(b, [
        {
          type: 'js',
          assets: [
            'dynamic-url.js',
            'esmodule-helpers.js',
            'bundle-url.js',
            'cacheLoader.js',
            'js-loader.js',
          ],
        },
        {
          type: 'js',
          assets: ['other.js'],
        },
        {
          type: 'js',
          assets: ['other.js', 'esmodule-helpers.js'],
        },
      ]);

      let res = await run(b);
      assert.equal(typeof res.lazy, 'object');
      assert.equal(typeof (await res.lazy), 'function');
      assert.equal(
        res.url,
        'http://localhost/' + path.basename(b.getBundles()[1].filePath),
      );
    });

    it('supports dynamic import and url to the same specifier in the same file with scope hoisting', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          'integration/multiple-import-types/dynamic-url.js',
        ),
        {
          defaultTargetOptions: {
            outputFormat: 'esmodule',
            isLibrary: true,
            shouldScopeHoist: true,
          },
        },
      );

      assertBundles(b, [
        {
          type: 'js',
          assets: ['dynamic-url.js'],
        },
        {
          type: 'js',
          assets: ['other.js'],
        },
        {
          type: 'js',
          assets: ['other.js'],
        },
      ]);

      let res = await run(b);
      assert.equal(typeof res.lazy, 'object');
      assert.equal(typeof (await res.lazy), 'function');
      assert.equal(
        res.url,
        'http://localhost/' + path.basename(b.getBundles()[1].filePath),
      );
    });

    it('supports static import and inline bundle for the same asset', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          'integration/multiple-import-types/static-inline.js',
        ),
      );

      assertBundles(b, [
        {
          type: 'js',
          assets: ['static-inline.js', 'other.js', 'esmodule-helpers.js'],
        },
        {
          type: 'js',
          assets: ['other.js', 'esmodule-helpers.js'],
        },
      ]);

      let res = await run(b);
      assert.equal(typeof res.Foo, 'function');
      assert.equal(typeof res.text, 'string');
    });

    it('supports static import and inline bundle for the same asset with scope hoisting', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          'integration/multiple-import-types/static-inline.js',
        ),
        {
          defaultTargetOptions: {
            outputFormat: 'esmodule',
            isLibrary: true,
            shouldScopeHoist: true,
          },
        },
      );

      assertBundles(b, [
        {
          type: 'js',
          assets: ['static-inline.js', 'other.js'],
        },
        {
          type: 'js',
          assets: ['other.js'],
        },
      ]);

      let res = await run(b);
      assert.equal(typeof res.Foo, 'function');
      assert.equal(typeof res.text, 'string');
    });

    it('supports dynamic import and inline bundle for the same asset', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          'integration/multiple-import-types/dynamic-inline.js',
        ),
      );

      assertBundles(b, [
        {
          type: 'js',
          assets: [
            'dynamic-inline.js',
            'esmodule-helpers.js',
            'bundle-url.js',
            'cacheLoader.js',
            'js-loader.js',
          ],
        },
        {
          type: 'js',
          assets: ['other.js'],
        },
        {
          type: 'js',
          assets: ['other.js', 'esmodule-helpers.js'],
        },
      ]);

      let res = await run(b);
      assert.equal(typeof res.lazy, 'object');
      assert.equal(typeof (await res.lazy), 'function');
      assert.equal(typeof res.text, 'string');
    });

    it('supports dynamic import and inline bundle for the same asset with scope hoisting', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          'integration/multiple-import-types/dynamic-inline.js',
        ),
        {
          defaultTargetOptions: {
            outputFormat: 'esmodule',
            isLibrary: true,
            shouldScopeHoist: true,
          },
        },
      );

      assertBundles(b, [
        {
          type: 'js',
          assets: ['dynamic-inline.js'],
        },
        {
          type: 'js',
          assets: ['other.js'],
        },
        {
          type: 'js',
          assets: ['other.js'],
        },
      ]);

      let res = await run(b);
      assert.equal(typeof res.lazy, 'object');
      assert.equal(typeof (await res.lazy), 'function');
      assert.equal(typeof res.text, 'string');
    });
  });

  it('should avoid creating a bundle for lazy dependencies already available in a shared bundle', async function() {
    let b = await bundle(
      path.join(
        __dirname,
        'integration/shared-bundle-internalization/index.mjs',
      ),
      {
        mode: 'production',
        defaultTargetOptions: {
          shouldScopeHoist: false,
        },
      },
    );

    assert.deepEqual(await (await run(b)).default, [42, 42]);
  });

  it('should support standalone import.meta', async function() {
    let b = await bundle(
      path.join(__dirname, 'integration/import-meta/index.js'),
    );
    let res = await run(b);
    assert.deepEqual(res.default, {
      meta: {url: 'file:///integration/import-meta/index.js'},
      url: 'file:///integration/import-meta/index.js',
      equal: true,
    });

    assert.equal(Object.getPrototypeOf(res.default.meta), null);
    assert.equal(Object.isExtensible(res.default.meta), true);
    assert.deepEqual(Object.getOwnPropertyDescriptors(res.default.meta), {
      url: {
        writable: true,
        configurable: true,
        enumerable: true,
        value: 'file:///integration/import-meta/index.js',
      },
    });
  });

  it('should support importing async bundles from bundles with different dist paths', async function() {
    let bundleGraph = await bundle(
      ['bar/entry/entry-a.js', 'foo/entry-b.js'].map(f =>
        path.join(__dirname, 'integration/differing-bundle-urls', f),
      ),
      {
        mode: 'production',
        defaultTargetOptions: {
          shouldOptimize: false,
        },
      },
    );
    assertBundles(bundleGraph, [
      {
        name: 'entry-a.js',
        assets: [
          'bundle-manifest.js',
          'bundle-url.js',
          'cacheLoader.js',
          'entry-a.js',
          'js-loader.js',
        ],
      },
      {
        name: 'entry-b.js',
        assets: [
          'bundle-manifest.js',
          'bundle-url.js',
          'cacheLoader.js',
          'entry-b.js',
          'js-loader.js',
        ],
      },
      {name: /deep\.[a-f0-9]+\.js/, assets: ['deep.js']},
      {name: /common\.[a-f0-9]+\.js/, assets: ['index.js']},
    ]);

    let [a, b] = bundleGraph.getBundles().filter(b => b.needsStableName);
    let calls = [];

    let bundles = [
      [await outputFS.readFile(a.filePath, 'utf8'), a],
      [await outputFS.readFile(b.filePath, 'utf8'), b],
    ];

    await runBundles(bundleGraph, a, bundles, {
      sideEffect: v => {
        calls.push(v);
      },
    });

    assert.deepEqual(calls, ['common', 'deep']);
  });
});
