var app, fs, handleStartupEventWithSquirrel, normalizeDriveLetterName, optimist, parseCommandLine, path, setupCompileCache, setupCrashReporter, setupErrorLogger, setupNylasHome, start;

global.shellStartTime = Date.now();

process.on('uncaughtException', function(error) {
  if (error == null) {
    error = {};
  }
  if (error.message != null) {
    console.log(error.message);
  }
  if (error.stack != null) {
    return console.log(error.stack);
  }
});

app = require('app');

fs = require('fs-plus');

path = require('path');

optimist = require('optimist');

start = function() {
  var addPathToOpen, addUrlToOpen, args;
  args = parseCommandLine();
  global.errorLogger = setupErrorLogger(args);
  setupNylasHome(args);
  setupCompileCache();
  if (handleStartupEventWithSquirrel()) {
    return;
  }
  app.setAppUserModelId('com.squirrel.nylas.nylas');
  addPathToOpen = function(event, pathToOpen) {
    event.preventDefault();
    return args.pathsToOpen.push(pathToOpen);
  };
  addUrlToOpen = function(event, urlToOpen) {
    event.preventDefault();
    return args.urlsToOpen.push(urlToOpen);
  };
  app.on('open-file', addPathToOpen);
  app.on('open-url', addUrlToOpen);
  app.on('will-finish-launching', function() {
    return setupCrashReporter();
  });
  return app.on('ready', function() {
    var Application;
    app.removeListener('open-file', addPathToOpen);
    app.removeListener('open-url', addUrlToOpen);
    Application = require(path.join(args.resourcePath, 'src', 'browser', 'application'));
    Application.open(args);
    if (!args.test) {
      return console.log("App load time: " + (Date.now() - global.shellStartTime) + "ms");
    }
  });
};

setupNylasHome = function() {
  var atomHome;
  if (process.env.NYLAS_HOME) {
    return;
  }
  atomHome = path.join(app.getHomeDir(), '.nylas');
  return process.env.NYLAS_HOME = atomHome;
};

normalizeDriveLetterName = function(filePath) {
  if (process.platform === 'win32') {
    return filePath.replace(/^([a-z]):/, function(arg) {
      var driveLetter;
      driveLetter = arg[0];
      return driveLetter.toUpperCase() + ":";
    });
  } else {
    return filePath;
  }
};

handleStartupEventWithSquirrel = function() {
  var SquirrelUpdate, squirrelCommand;
  if (process.platform !== 'win32') {
    return false;
  }
  SquirrelUpdate = require('./squirrel-update');
  squirrelCommand = process.argv[1];
  return SquirrelUpdate.handleStartupEvent(app, squirrelCommand);
};

setupCompileCache = function() {
  var compileCache;
  compileCache = require('../compile-cache');
  return compileCache.setHomeDirectory(process.env.NYLAS_HOME);
};

setupErrorLogger = function(args) {
  var ErrorLogger;
  if (args == null) {
    args = {};
  }
  ErrorLogger = require('../error-logger');
  return new ErrorLogger({
    inSpecMode: args.test,
    inDevMode: args.devMode,
    resourcePath: args.resourcePath
  });
};

setupCrashReporter = function() {};

parseCommandLine = function() {
  var args, devMode, devResourcePath, executedFrom, logFile, newWindow, options, packageDirectoryPath, packageManifest, packageManifestPath, pathsToOpen, pidToKillWhenClosed, ref, ref1, ref2, resourcePath, safeMode, specDirectory, specFilePattern, specsOnCommandLine, test, urlsToOpen, version;
  version = app.getVersion();
  options = optimist(process.argv.slice(1));
  options.usage("N1 v" + version + "\n\nUsage: n1 [options] [path ...]\n\nOne or more paths to files or folders to open may be specified.\n\nFile paths will open in the current window.\n\nFolder paths will open in an existing window if that folder has already been\nopened or a new window if it hasn't.\n\nEnvironment Variables:\nN1_PATH  The path from which N1 loads source code in dev mode.\n         Defaults to `cwd`.");
  options.alias('d', 'dev').boolean('d').describe('d', 'Run in development mode.');
  options.alias('f', 'foreground').boolean('f').describe('f', 'Keep the browser process in the foreground.');
  options.alias('h', 'help').boolean('h').describe('h', 'Print this usage message.');
  options.alias('l', 'log-file').string('l').describe('l', 'Log all output to file.');
  options.alias('n', 'new-window').boolean('n').describe('n', 'Open a new window.');
  options.alias('r', 'resource-path').string('r').describe('r', 'Set the path to the N1 source directory and enable dev-mode.');
  options.alias('s', 'spec-directory').string('s').describe('s', 'Set the directory from which to run package specs (default: N1\'s spec directory).');
  options.boolean('safe').describe('safe', 'Do not load packages from ~/.nylas/packages or ~/.nylas/dev/packages.');
  options.alias('t', 'test').boolean('t').describe('t', 'Run the specified specs and exit with error code on failures.');
  options.alias('v', 'version').boolean('v').describe('v', 'Print the version.');
  options.alias('w', 'wait').boolean('w').describe('w', 'Wait for window to be closed before returning.');
  args = options.argv;
  if (args.help) {
    process.stdout.write(options.help());
    process.exit(0);
  }
  if (args.version) {
    process.stdout.write(version + "\n");
    process.exit(0);
  }
  executedFrom = (ref = (ref1 = args['executed-from']) != null ? ref1.toString() : void 0) != null ? ref : process.cwd();
  devMode = args['dev'];
  safeMode = args['safe'];
  pathsToOpen = args._;
  if (executedFrom && pathsToOpen.length === 0) {
    pathsToOpen = [executedFrom];
  }
  urlsToOpen = [];
  test = args['test'];
  specDirectory = args['spec-directory'];
  newWindow = args['new-window'];
  if (args['wait']) {
    pidToKillWhenClosed = args['pid'];
  }
  logFile = args['log-file'];
  specFilePattern = args['file-pattern'];
  devResourcePath = (ref2 = process.env.N1_PATH) != null ? ref2 : process.cwd();
  if (args['resource-path']) {
    devMode = true;
    resourcePath = args['resource-path'];
  } else {
    specsOnCommandLine = true;
    if (specDirectory != null) {
      packageDirectoryPath = path.resolve(specDirectory, '..');
      packageManifestPath = path.join(packageDirectoryPath, 'package.json');
      if (fs.statSyncNoException(packageManifestPath)) {
        try {
          packageManifest = JSON.parse(fs.readFileSync(packageManifestPath));
          if (packageManifest.name === 'edgehill') {
            resourcePath = packageDirectoryPath;
          }
        } catch (_error) {}
      }
    } else {
      if (test && toString.call(test) === "[object String]") {
        if (test === "core") {
          specDirectory = path.join(global.devResourcePath, "spec");
        } else if (test === "window") {
          specDirectory = path.join(global.devResourcePath, "spec");
          specsOnCommandLine = false;
        } else {
          specDirectory = path.resolve(path.join(global.devResourcePath, "internal_packages", test));
        }
      }
    }
  }
  if (test) {
    devMode = true;
  }
  if (devMode) {
    if (resourcePath == null) {
      resourcePath = devResourcePath;
    }
  }
  if (!fs.statSyncNoException(resourcePath)) {
    resourcePath = path.dirname(path.dirname(__dirname));
  }
  if (args['path-environment']) {
    process.env.PATH = args['path-environment'];
  }
  resourcePath = normalizeDriveLetterName(resourcePath);
  devResourcePath = normalizeDriveLetterName(devResourcePath);
  return {
    resourcePath: resourcePath,
    pathsToOpen: pathsToOpen,
    urlsToOpen: urlsToOpen,
    executedFrom: executedFrom,
    test: test,
    version: version,
    pidToKillWhenClosed: pidToKillWhenClosed,
    devMode: devMode,
    safeMode: safeMode,
    newWindow: newWindow,
    specDirectory: specDirectory,
    specsOnCommandLine: specsOnCommandLine,
    logFile: logFile,
    specFilePattern: specFilePattern
  };
};

start();

// ---
// generated by coffee-script 1.9.2
