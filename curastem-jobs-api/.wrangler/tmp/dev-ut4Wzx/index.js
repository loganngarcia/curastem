var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// node_modules/unenv/dist/runtime/_internal/utils.mjs
// @__NO_SIDE_EFFECTS__
function createNotImplementedError(name) {
  return new Error(`[unenv] ${name} is not implemented yet!`);
}
__name(createNotImplementedError, "createNotImplementedError");
// @__NO_SIDE_EFFECTS__
function notImplemented(name) {
  const fn = /* @__PURE__ */ __name(() => {
    throw /* @__PURE__ */ createNotImplementedError(name);
  }, "fn");
  return Object.assign(fn, { __unenv__: true });
}
__name(notImplemented, "notImplemented");
// @__NO_SIDE_EFFECTS__
function notImplementedClass(name) {
  return class {
    __unenv__ = true;
    constructor() {
      throw new Error(`[unenv] ${name} is not implemented yet!`);
    }
  };
}
__name(notImplementedClass, "notImplementedClass");

// node_modules/unenv/dist/runtime/node/internal/perf_hooks/performance.mjs
var _timeOrigin = globalThis.performance?.timeOrigin ?? Date.now();
var _performanceNow = globalThis.performance?.now ? globalThis.performance.now.bind(globalThis.performance) : () => Date.now() - _timeOrigin;
var nodeTiming = {
  name: "node",
  entryType: "node",
  startTime: 0,
  duration: 0,
  nodeStart: 0,
  v8Start: 0,
  bootstrapComplete: 0,
  environment: 0,
  loopStart: 0,
  loopExit: 0,
  idleTime: 0,
  uvMetricsInfo: {
    loopCount: 0,
    events: 0,
    eventsWaiting: 0
  },
  detail: void 0,
  toJSON() {
    return this;
  }
};
var PerformanceEntry = class {
  static {
    __name(this, "PerformanceEntry");
  }
  __unenv__ = true;
  detail;
  entryType = "event";
  name;
  startTime;
  constructor(name, options) {
    this.name = name;
    this.startTime = options?.startTime || _performanceNow();
    this.detail = options?.detail;
  }
  get duration() {
    return _performanceNow() - this.startTime;
  }
  toJSON() {
    return {
      name: this.name,
      entryType: this.entryType,
      startTime: this.startTime,
      duration: this.duration,
      detail: this.detail
    };
  }
};
var PerformanceMark = class PerformanceMark2 extends PerformanceEntry {
  static {
    __name(this, "PerformanceMark");
  }
  entryType = "mark";
  constructor() {
    super(...arguments);
  }
  get duration() {
    return 0;
  }
};
var PerformanceMeasure = class extends PerformanceEntry {
  static {
    __name(this, "PerformanceMeasure");
  }
  entryType = "measure";
};
var PerformanceResourceTiming = class extends PerformanceEntry {
  static {
    __name(this, "PerformanceResourceTiming");
  }
  entryType = "resource";
  serverTiming = [];
  connectEnd = 0;
  connectStart = 0;
  decodedBodySize = 0;
  domainLookupEnd = 0;
  domainLookupStart = 0;
  encodedBodySize = 0;
  fetchStart = 0;
  initiatorType = "";
  name = "";
  nextHopProtocol = "";
  redirectEnd = 0;
  redirectStart = 0;
  requestStart = 0;
  responseEnd = 0;
  responseStart = 0;
  secureConnectionStart = 0;
  startTime = 0;
  transferSize = 0;
  workerStart = 0;
  responseStatus = 0;
};
var PerformanceObserverEntryList = class {
  static {
    __name(this, "PerformanceObserverEntryList");
  }
  __unenv__ = true;
  getEntries() {
    return [];
  }
  getEntriesByName(_name, _type) {
    return [];
  }
  getEntriesByType(type) {
    return [];
  }
};
var Performance = class {
  static {
    __name(this, "Performance");
  }
  __unenv__ = true;
  timeOrigin = _timeOrigin;
  eventCounts = /* @__PURE__ */ new Map();
  _entries = [];
  _resourceTimingBufferSize = 0;
  navigation = void 0;
  timing = void 0;
  timerify(_fn, _options) {
    throw createNotImplementedError("Performance.timerify");
  }
  get nodeTiming() {
    return nodeTiming;
  }
  eventLoopUtilization() {
    return {};
  }
  markResourceTiming() {
    return new PerformanceResourceTiming("");
  }
  onresourcetimingbufferfull = null;
  now() {
    if (this.timeOrigin === _timeOrigin) {
      return _performanceNow();
    }
    return Date.now() - this.timeOrigin;
  }
  clearMarks(markName) {
    this._entries = markName ? this._entries.filter((e) => e.name !== markName) : this._entries.filter((e) => e.entryType !== "mark");
  }
  clearMeasures(measureName) {
    this._entries = measureName ? this._entries.filter((e) => e.name !== measureName) : this._entries.filter((e) => e.entryType !== "measure");
  }
  clearResourceTimings() {
    this._entries = this._entries.filter((e) => e.entryType !== "resource" || e.entryType !== "navigation");
  }
  getEntries() {
    return this._entries;
  }
  getEntriesByName(name, type) {
    return this._entries.filter((e) => e.name === name && (!type || e.entryType === type));
  }
  getEntriesByType(type) {
    return this._entries.filter((e) => e.entryType === type);
  }
  mark(name, options) {
    const entry = new PerformanceMark(name, options);
    this._entries.push(entry);
    return entry;
  }
  measure(measureName, startOrMeasureOptions, endMark) {
    let start;
    let end;
    if (typeof startOrMeasureOptions === "string") {
      start = this.getEntriesByName(startOrMeasureOptions, "mark")[0]?.startTime;
      end = this.getEntriesByName(endMark, "mark")[0]?.startTime;
    } else {
      start = Number.parseFloat(startOrMeasureOptions?.start) || this.now();
      end = Number.parseFloat(startOrMeasureOptions?.end) || this.now();
    }
    const entry = new PerformanceMeasure(measureName, {
      startTime: start,
      detail: {
        start,
        end
      }
    });
    this._entries.push(entry);
    return entry;
  }
  setResourceTimingBufferSize(maxSize) {
    this._resourceTimingBufferSize = maxSize;
  }
  addEventListener(type, listener, options) {
    throw createNotImplementedError("Performance.addEventListener");
  }
  removeEventListener(type, listener, options) {
    throw createNotImplementedError("Performance.removeEventListener");
  }
  dispatchEvent(event) {
    throw createNotImplementedError("Performance.dispatchEvent");
  }
  toJSON() {
    return this;
  }
};
var PerformanceObserver = class {
  static {
    __name(this, "PerformanceObserver");
  }
  __unenv__ = true;
  static supportedEntryTypes = [];
  _callback = null;
  constructor(callback) {
    this._callback = callback;
  }
  takeRecords() {
    return [];
  }
  disconnect() {
    throw createNotImplementedError("PerformanceObserver.disconnect");
  }
  observe(options) {
    throw createNotImplementedError("PerformanceObserver.observe");
  }
  bind(fn) {
    return fn;
  }
  runInAsyncScope(fn, thisArg, ...args) {
    return fn.call(thisArg, ...args);
  }
  asyncId() {
    return 0;
  }
  triggerAsyncId() {
    return 0;
  }
  emitDestroy() {
    return this;
  }
};
var performance = globalThis.performance && "addEventListener" in globalThis.performance ? globalThis.performance : new Performance();

// node_modules/@cloudflare/unenv-preset/dist/runtime/polyfill/performance.mjs
globalThis.performance = performance;
globalThis.Performance = Performance;
globalThis.PerformanceEntry = PerformanceEntry;
globalThis.PerformanceMark = PerformanceMark;
globalThis.PerformanceMeasure = PerformanceMeasure;
globalThis.PerformanceObserver = PerformanceObserver;
globalThis.PerformanceObserverEntryList = PerformanceObserverEntryList;
globalThis.PerformanceResourceTiming = PerformanceResourceTiming;

// node_modules/unenv/dist/runtime/node/console.mjs
import { Writable } from "node:stream";

// node_modules/unenv/dist/runtime/mock/noop.mjs
var noop_default = Object.assign(() => {
}, { __unenv__: true });

// node_modules/unenv/dist/runtime/node/console.mjs
var _console = globalThis.console;
var _ignoreErrors = true;
var _stderr = new Writable();
var _stdout = new Writable();
var log = _console?.log ?? noop_default;
var info = _console?.info ?? log;
var trace = _console?.trace ?? info;
var debug = _console?.debug ?? log;
var table = _console?.table ?? log;
var error = _console?.error ?? log;
var warn = _console?.warn ?? error;
var createTask = _console?.createTask ?? /* @__PURE__ */ notImplemented("console.createTask");
var clear = _console?.clear ?? noop_default;
var count = _console?.count ?? noop_default;
var countReset = _console?.countReset ?? noop_default;
var dir = _console?.dir ?? noop_default;
var dirxml = _console?.dirxml ?? noop_default;
var group = _console?.group ?? noop_default;
var groupEnd = _console?.groupEnd ?? noop_default;
var groupCollapsed = _console?.groupCollapsed ?? noop_default;
var profile = _console?.profile ?? noop_default;
var profileEnd = _console?.profileEnd ?? noop_default;
var time = _console?.time ?? noop_default;
var timeEnd = _console?.timeEnd ?? noop_default;
var timeLog = _console?.timeLog ?? noop_default;
var timeStamp = _console?.timeStamp ?? noop_default;
var Console = _console?.Console ?? /* @__PURE__ */ notImplementedClass("console.Console");
var _times = /* @__PURE__ */ new Map();
var _stdoutErrorHandler = noop_default;
var _stderrErrorHandler = noop_default;

// node_modules/@cloudflare/unenv-preset/dist/runtime/node/console.mjs
var workerdConsole = globalThis["console"];
var {
  assert,
  clear: clear2,
  // @ts-expect-error undocumented public API
  context,
  count: count2,
  countReset: countReset2,
  // @ts-expect-error undocumented public API
  createTask: createTask2,
  debug: debug2,
  dir: dir2,
  dirxml: dirxml2,
  error: error2,
  group: group2,
  groupCollapsed: groupCollapsed2,
  groupEnd: groupEnd2,
  info: info2,
  log: log2,
  profile: profile2,
  profileEnd: profileEnd2,
  table: table2,
  time: time2,
  timeEnd: timeEnd2,
  timeLog: timeLog2,
  timeStamp: timeStamp2,
  trace: trace2,
  warn: warn2
} = workerdConsole;
Object.assign(workerdConsole, {
  Console,
  _ignoreErrors,
  _stderr,
  _stderrErrorHandler,
  _stdout,
  _stdoutErrorHandler,
  _times
});
var console_default = workerdConsole;

// node_modules/wrangler/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-console
globalThis.console = console_default;

// node_modules/unenv/dist/runtime/node/internal/process/hrtime.mjs
var hrtime = /* @__PURE__ */ Object.assign(/* @__PURE__ */ __name(function hrtime2(startTime) {
  const now = Date.now();
  const seconds = Math.trunc(now / 1e3);
  const nanos = now % 1e3 * 1e6;
  if (startTime) {
    let diffSeconds = seconds - startTime[0];
    let diffNanos = nanos - startTime[0];
    if (diffNanos < 0) {
      diffSeconds = diffSeconds - 1;
      diffNanos = 1e9 + diffNanos;
    }
    return [diffSeconds, diffNanos];
  }
  return [seconds, nanos];
}, "hrtime"), { bigint: /* @__PURE__ */ __name(function bigint() {
  return BigInt(Date.now() * 1e6);
}, "bigint") });

// node_modules/unenv/dist/runtime/node/internal/process/process.mjs
import { EventEmitter } from "node:events";

// node_modules/unenv/dist/runtime/node/internal/tty/read-stream.mjs
var ReadStream = class {
  static {
    __name(this, "ReadStream");
  }
  fd;
  isRaw = false;
  isTTY = false;
  constructor(fd) {
    this.fd = fd;
  }
  setRawMode(mode) {
    this.isRaw = mode;
    return this;
  }
};

// node_modules/unenv/dist/runtime/node/internal/tty/write-stream.mjs
var WriteStream = class {
  static {
    __name(this, "WriteStream");
  }
  fd;
  columns = 80;
  rows = 24;
  isTTY = false;
  constructor(fd) {
    this.fd = fd;
  }
  clearLine(dir3, callback) {
    callback && callback();
    return false;
  }
  clearScreenDown(callback) {
    callback && callback();
    return false;
  }
  cursorTo(x, y, callback) {
    callback && typeof callback === "function" && callback();
    return false;
  }
  moveCursor(dx, dy, callback) {
    callback && callback();
    return false;
  }
  getColorDepth(env2) {
    return 1;
  }
  hasColors(count3, env2) {
    return false;
  }
  getWindowSize() {
    return [this.columns, this.rows];
  }
  write(str, encoding, cb) {
    if (str instanceof Uint8Array) {
      str = new TextDecoder().decode(str);
    }
    try {
      console.log(str);
    } catch {
    }
    cb && typeof cb === "function" && cb();
    return false;
  }
};

// node_modules/unenv/dist/runtime/node/internal/process/node-version.mjs
var NODE_VERSION = "22.14.0";

// node_modules/unenv/dist/runtime/node/internal/process/process.mjs
var Process = class _Process extends EventEmitter {
  static {
    __name(this, "Process");
  }
  env;
  hrtime;
  nextTick;
  constructor(impl) {
    super();
    this.env = impl.env;
    this.hrtime = impl.hrtime;
    this.nextTick = impl.nextTick;
    for (const prop of [...Object.getOwnPropertyNames(_Process.prototype), ...Object.getOwnPropertyNames(EventEmitter.prototype)]) {
      const value = this[prop];
      if (typeof value === "function") {
        this[prop] = value.bind(this);
      }
    }
  }
  // --- event emitter ---
  emitWarning(warning, type, code) {
    console.warn(`${code ? `[${code}] ` : ""}${type ? `${type}: ` : ""}${warning}`);
  }
  emit(...args) {
    return super.emit(...args);
  }
  listeners(eventName) {
    return super.listeners(eventName);
  }
  // --- stdio (lazy initializers) ---
  #stdin;
  #stdout;
  #stderr;
  get stdin() {
    return this.#stdin ??= new ReadStream(0);
  }
  get stdout() {
    return this.#stdout ??= new WriteStream(1);
  }
  get stderr() {
    return this.#stderr ??= new WriteStream(2);
  }
  // --- cwd ---
  #cwd = "/";
  chdir(cwd2) {
    this.#cwd = cwd2;
  }
  cwd() {
    return this.#cwd;
  }
  // --- dummy props and getters ---
  arch = "";
  platform = "";
  argv = [];
  argv0 = "";
  execArgv = [];
  execPath = "";
  title = "";
  pid = 200;
  ppid = 100;
  get version() {
    return `v${NODE_VERSION}`;
  }
  get versions() {
    return { node: NODE_VERSION };
  }
  get allowedNodeEnvironmentFlags() {
    return /* @__PURE__ */ new Set();
  }
  get sourceMapsEnabled() {
    return false;
  }
  get debugPort() {
    return 0;
  }
  get throwDeprecation() {
    return false;
  }
  get traceDeprecation() {
    return false;
  }
  get features() {
    return {};
  }
  get release() {
    return {};
  }
  get connected() {
    return false;
  }
  get config() {
    return {};
  }
  get moduleLoadList() {
    return [];
  }
  constrainedMemory() {
    return 0;
  }
  availableMemory() {
    return 0;
  }
  uptime() {
    return 0;
  }
  resourceUsage() {
    return {};
  }
  // --- noop methods ---
  ref() {
  }
  unref() {
  }
  // --- unimplemented methods ---
  umask() {
    throw createNotImplementedError("process.umask");
  }
  getBuiltinModule() {
    return void 0;
  }
  getActiveResourcesInfo() {
    throw createNotImplementedError("process.getActiveResourcesInfo");
  }
  exit() {
    throw createNotImplementedError("process.exit");
  }
  reallyExit() {
    throw createNotImplementedError("process.reallyExit");
  }
  kill() {
    throw createNotImplementedError("process.kill");
  }
  abort() {
    throw createNotImplementedError("process.abort");
  }
  dlopen() {
    throw createNotImplementedError("process.dlopen");
  }
  setSourceMapsEnabled() {
    throw createNotImplementedError("process.setSourceMapsEnabled");
  }
  loadEnvFile() {
    throw createNotImplementedError("process.loadEnvFile");
  }
  disconnect() {
    throw createNotImplementedError("process.disconnect");
  }
  cpuUsage() {
    throw createNotImplementedError("process.cpuUsage");
  }
  setUncaughtExceptionCaptureCallback() {
    throw createNotImplementedError("process.setUncaughtExceptionCaptureCallback");
  }
  hasUncaughtExceptionCaptureCallback() {
    throw createNotImplementedError("process.hasUncaughtExceptionCaptureCallback");
  }
  initgroups() {
    throw createNotImplementedError("process.initgroups");
  }
  openStdin() {
    throw createNotImplementedError("process.openStdin");
  }
  assert() {
    throw createNotImplementedError("process.assert");
  }
  binding() {
    throw createNotImplementedError("process.binding");
  }
  // --- attached interfaces ---
  permission = { has: /* @__PURE__ */ notImplemented("process.permission.has") };
  report = {
    directory: "",
    filename: "",
    signal: "SIGUSR2",
    compact: false,
    reportOnFatalError: false,
    reportOnSignal: false,
    reportOnUncaughtException: false,
    getReport: /* @__PURE__ */ notImplemented("process.report.getReport"),
    writeReport: /* @__PURE__ */ notImplemented("process.report.writeReport")
  };
  finalization = {
    register: /* @__PURE__ */ notImplemented("process.finalization.register"),
    unregister: /* @__PURE__ */ notImplemented("process.finalization.unregister"),
    registerBeforeExit: /* @__PURE__ */ notImplemented("process.finalization.registerBeforeExit")
  };
  memoryUsage = Object.assign(() => ({
    arrayBuffers: 0,
    rss: 0,
    external: 0,
    heapTotal: 0,
    heapUsed: 0
  }), { rss: /* @__PURE__ */ __name(() => 0, "rss") });
  // --- undefined props ---
  mainModule = void 0;
  domain = void 0;
  // optional
  send = void 0;
  exitCode = void 0;
  channel = void 0;
  getegid = void 0;
  geteuid = void 0;
  getgid = void 0;
  getgroups = void 0;
  getuid = void 0;
  setegid = void 0;
  seteuid = void 0;
  setgid = void 0;
  setgroups = void 0;
  setuid = void 0;
  // internals
  _events = void 0;
  _eventsCount = void 0;
  _exiting = void 0;
  _maxListeners = void 0;
  _debugEnd = void 0;
  _debugProcess = void 0;
  _fatalException = void 0;
  _getActiveHandles = void 0;
  _getActiveRequests = void 0;
  _kill = void 0;
  _preload_modules = void 0;
  _rawDebug = void 0;
  _startProfilerIdleNotifier = void 0;
  _stopProfilerIdleNotifier = void 0;
  _tickCallback = void 0;
  _disconnect = void 0;
  _handleQueue = void 0;
  _pendingMessage = void 0;
  _channel = void 0;
  _send = void 0;
  _linkedBinding = void 0;
};

// node_modules/@cloudflare/unenv-preset/dist/runtime/node/process.mjs
var globalProcess = globalThis["process"];
var getBuiltinModule = globalProcess.getBuiltinModule;
var workerdProcess = getBuiltinModule("node:process");
var unenvProcess = new Process({
  env: globalProcess.env,
  hrtime,
  // `nextTick` is available from workerd process v1
  nextTick: workerdProcess.nextTick
});
var { exit, features, platform } = workerdProcess;
var {
  _channel,
  _debugEnd,
  _debugProcess,
  _disconnect,
  _events,
  _eventsCount,
  _exiting,
  _fatalException,
  _getActiveHandles,
  _getActiveRequests,
  _handleQueue,
  _kill,
  _linkedBinding,
  _maxListeners,
  _pendingMessage,
  _preload_modules,
  _rawDebug,
  _send,
  _startProfilerIdleNotifier,
  _stopProfilerIdleNotifier,
  _tickCallback,
  abort,
  addListener,
  allowedNodeEnvironmentFlags,
  arch,
  argv,
  argv0,
  assert: assert2,
  availableMemory,
  binding,
  channel,
  chdir,
  config,
  connected,
  constrainedMemory,
  cpuUsage,
  cwd,
  debugPort,
  disconnect,
  dlopen,
  domain,
  emit,
  emitWarning,
  env,
  eventNames,
  execArgv,
  execPath,
  exitCode,
  finalization,
  getActiveResourcesInfo,
  getegid,
  geteuid,
  getgid,
  getgroups,
  getMaxListeners,
  getuid,
  hasUncaughtExceptionCaptureCallback,
  hrtime: hrtime3,
  initgroups,
  kill,
  listenerCount,
  listeners,
  loadEnvFile,
  mainModule,
  memoryUsage,
  moduleLoadList,
  nextTick,
  off,
  on,
  once,
  openStdin,
  permission,
  pid,
  ppid,
  prependListener,
  prependOnceListener,
  rawListeners,
  reallyExit,
  ref,
  release,
  removeAllListeners,
  removeListener,
  report,
  resourceUsage,
  send,
  setegid,
  seteuid,
  setgid,
  setgroups,
  setMaxListeners,
  setSourceMapsEnabled,
  setuid,
  setUncaughtExceptionCaptureCallback,
  sourceMapsEnabled,
  stderr,
  stdin,
  stdout,
  throwDeprecation,
  title,
  traceDeprecation,
  umask,
  unref,
  uptime,
  version,
  versions
} = unenvProcess;
var _process = {
  abort,
  addListener,
  allowedNodeEnvironmentFlags,
  hasUncaughtExceptionCaptureCallback,
  setUncaughtExceptionCaptureCallback,
  loadEnvFile,
  sourceMapsEnabled,
  arch,
  argv,
  argv0,
  chdir,
  config,
  connected,
  constrainedMemory,
  availableMemory,
  cpuUsage,
  cwd,
  debugPort,
  dlopen,
  disconnect,
  emit,
  emitWarning,
  env,
  eventNames,
  execArgv,
  execPath,
  exit,
  finalization,
  features,
  getBuiltinModule,
  getActiveResourcesInfo,
  getMaxListeners,
  hrtime: hrtime3,
  kill,
  listeners,
  listenerCount,
  memoryUsage,
  nextTick,
  on,
  off,
  once,
  pid,
  platform,
  ppid,
  prependListener,
  prependOnceListener,
  rawListeners,
  release,
  removeAllListeners,
  removeListener,
  report,
  resourceUsage,
  setMaxListeners,
  setSourceMapsEnabled,
  stderr,
  stdin,
  stdout,
  title,
  throwDeprecation,
  traceDeprecation,
  umask,
  uptime,
  version,
  versions,
  // @ts-expect-error old API
  domain,
  initgroups,
  moduleLoadList,
  reallyExit,
  openStdin,
  assert: assert2,
  binding,
  send,
  exitCode,
  channel,
  getegid,
  geteuid,
  getgid,
  getgroups,
  getuid,
  setegid,
  seteuid,
  setgid,
  setgroups,
  setuid,
  permission,
  mainModule,
  _events,
  _eventsCount,
  _exiting,
  _maxListeners,
  _debugEnd,
  _debugProcess,
  _fatalException,
  _getActiveHandles,
  _getActiveRequests,
  _kill,
  _preload_modules,
  _rawDebug,
  _startProfilerIdleNotifier,
  _stopProfilerIdleNotifier,
  _tickCallback,
  _disconnect,
  _handleQueue,
  _pendingMessage,
  _channel,
  _send,
  _linkedBinding
};
var process_default = _process;

// node_modules/wrangler/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-process
globalThis.process = process_default;

// src/db/queries.ts
async function upsertCompany(db, id, name, slug, now) {
  await db.prepare(
    `INSERT INTO companies (id, name, slug, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (slug) DO UPDATE SET
         name       = excluded.name,
         updated_at = excluded.updated_at`
  ).bind(id, name, slug, now, now).run();
  const row = await db.prepare("SELECT id FROM companies WHERE slug = ?").bind(slug).first();
  return row.id;
}
__name(upsertCompany, "upsertCompany");
async function updateCompanyEnrichment(db, id, fields) {
  const sets = [];
  const bindings = [];
  const now = Math.floor(Date.now() / 1e3);
  for (const [key, val] of Object.entries(fields)) {
    if (val !== void 0) {
      sets.push(`${key} = ?`);
      bindings.push(val);
    }
  }
  if (sets.length === 0) return;
  sets.push("updated_at = ?");
  bindings.push(now);
  bindings.push(id);
  await db.prepare(`UPDATE companies SET ${sets.join(", ")} WHERE id = ?`).bind(...bindings).run();
}
__name(updateCompanyEnrichment, "updateCompanyEnrichment");
async function listUnenrichedCompanies(db, staleBefore) {
  const result = await db.prepare(
    `SELECT * FROM companies
       WHERE description_enriched_at IS NULL
          OR description_enriched_at < ?
       LIMIT 50`
  ).bind(staleBefore).all();
  return result.results ?? [];
}
__name(listUnenrichedCompanies, "listUnenrichedCompanies");
async function listEnabledSources(db) {
  const result = await db.prepare("SELECT * FROM sources WHERE enabled = 1").all();
  return result.results ?? [];
}
__name(listEnabledSources, "listEnabledSources");
async function updateSourceFetchResult(db, id, lastFetchedAt, jobCount, error3) {
  await db.prepare(
    `UPDATE sources
       SET last_fetched_at = ?, last_job_count = ?, last_error = ?
       WHERE id = ?`
  ).bind(lastFetchedAt, jobCount, error3, id).run();
}
__name(updateSourceFetchResult, "updateSourceFetchResult");
async function upsertJob(db, input) {
  const { id, company_id, source_id, external_id, source_name, dedup_key, normalized, now } = input;
  const {
    title: title2,
    location,
    employment_type,
    workplace_type,
    apply_url,
    source_url,
    description_raw,
    salary_min,
    salary_max,
    salary_currency,
    salary_period,
    posted_at
  } = normalized;
  const existing = await db.prepare("SELECT id, description_raw FROM jobs WHERE source_id = ? AND external_id = ?").bind(source_id, external_id).first();
  if (!existing) {
    await db.prepare(
      `INSERT INTO jobs (
          id, company_id, source_id, external_id, title, location,
          employment_type, workplace_type, apply_url, source_url, source_name,
          description_raw, salary_min, salary_max, salary_currency, salary_period,
          posted_at, first_seen_at, dedup_key, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?
        )`
    ).bind(
      id,
      company_id,
      source_id,
      external_id,
      title2,
      location,
      employment_type,
      workplace_type,
      apply_url,
      source_url,
      source_name,
      description_raw,
      salary_min,
      salary_max,
      salary_currency,
      salary_period,
      posted_at,
      now,
      dedup_key,
      now,
      now
    ).run();
    return { inserted: true, needsEmbedding: true };
  }
  const descriptionChanged = description_raw !== null && existing.description_raw !== description_raw;
  await db.prepare(
    `UPDATE jobs SET
        company_id             = ?,
        title                  = ?,
        location               = ?,
        employment_type        = ?,
        workplace_type         = ?,
        apply_url              = ?,
        source_url             = ?,
        salary_min             = ?,
        salary_max             = ?,
        salary_currency        = ?,
        salary_period          = ?,
        posted_at              = ?,
        dedup_key              = ?,
        updated_at             = ?,
        -- Only update description_raw if it has actually changed
        description_raw        = CASE WHEN ? = 1 THEN ? ELSE description_raw END,
        -- Invalidate AI cache and embedding when description changed
        ai_generated_at        = CASE WHEN ? = 1 THEN NULL ELSE ai_generated_at END,
        embedding_generated_at = CASE WHEN ? = 1 THEN NULL ELSE embedding_generated_at END
      WHERE source_id = ? AND external_id = ?`
  ).bind(
    company_id,
    title2,
    location,
    employment_type,
    workplace_type,
    apply_url,
    source_url,
    salary_min,
    salary_max,
    salary_currency,
    salary_period,
    posted_at,
    dedup_key,
    now,
    descriptionChanged ? 1 : 0,
    description_raw,
    descriptionChanged ? 1 : 0,
    descriptionChanged ? 1 : 0,
    source_id,
    external_id
  ).run();
  return { inserted: false, needsEmbedding: descriptionChanged };
}
__name(upsertJob, "upsertJob");
async function getJobsNeedingEmbedding(db, limit) {
  const { results } = await db.prepare(`
      SELECT j.id, j.title, c.name AS company_name, j.location, j.description_raw
      FROM jobs j
      JOIN companies c ON j.company_id = c.id
      WHERE j.embedding_generated_at IS NULL
      ORDER BY j.first_seen_at DESC
      LIMIT ?
    `).bind(limit).all();
  return results ?? [];
}
__name(getJobsNeedingEmbedding, "getJobsNeedingEmbedding");
async function markJobEmbedded(db, jobId, now) {
  await db.prepare("UPDATE jobs SET embedding_generated_at = ? WHERE id = ?").bind(now, jobId).run();
}
__name(markJobEmbedded, "markJobEmbedded");
async function listJobsByIds(db, ids, filter) {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const conditions = [`j.id IN (${placeholders})`];
  const bindings = [...ids];
  if (filter.location) {
    conditions.push("j.location LIKE ?");
    bindings.push(`%${filter.location}%`);
  }
  if (filter.employment_type) {
    conditions.push("j.employment_type = ?");
    bindings.push(filter.employment_type);
  }
  if (filter.workplace_type) {
    conditions.push("j.workplace_type = ?");
    bindings.push(filter.workplace_type);
  }
  if (filter.company) {
    conditions.push("c.slug = ?");
    bindings.push(filter.company);
  }
  const where = conditions.join(" AND ");
  const sql = `
    SELECT
      j.*,
      c.name        AS company_name,
      c.logo_url    AS company_logo_url,
      c.description AS company_description,
      c.website_url AS company_website_url,
      c.linkedin_url AS company_linkedin_url,
      c.glassdoor_url AS company_glassdoor_url,
      c.x_url       AS company_x_url
    FROM jobs j
    JOIN companies c ON j.company_id = c.id
    WHERE ${where}
  `;
  const { results } = await db.prepare(sql).bind(...bindings).all();
  const rows = results ?? [];
  const idOrder = new Map(ids.map((id, i) => [id, i]));
  return rows.sort((a, b) => (idOrder.get(a.id) ?? 999) - (idOrder.get(b.id) ?? 999));
}
__name(listJobsByIds, "listJobsByIds");
async function listJobs(db, filter) {
  const conditions = [];
  const bindings = [];
  if (filter.q) {
    conditions.push("(j.title LIKE ? OR c.name LIKE ?)");
    const pattern = `%${filter.q}%`;
    bindings.push(pattern, pattern);
  }
  if (filter.location) {
    conditions.push("j.location LIKE ?");
    bindings.push(`%${filter.location}%`);
  }
  if (filter.employment_type) {
    conditions.push("j.employment_type = ?");
    bindings.push(filter.employment_type);
  }
  if (filter.workplace_type) {
    conditions.push("j.workplace_type = ?");
    bindings.push(filter.workplace_type);
  }
  if (filter.company) {
    conditions.push("c.slug = ?");
    bindings.push(filter.company);
  }
  if (filter.cursor) {
    try {
      const decoded = atob(filter.cursor);
      const [ts, id] = decoded.split(":");
      conditions.push("(j.posted_at < ? OR (j.posted_at = ? AND j.id < ?))");
      bindings.push(Number(ts), Number(ts), id);
    } catch {
    }
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const selectJoined = `
    SELECT
      j.*,
      c.name        AS company_name,
      c.logo_url    AS company_logo_url,
      c.description AS company_description,
      c.website_url AS company_website_url,
      c.linkedin_url AS company_linkedin_url,
      c.glassdoor_url AS company_glassdoor_url,
      c.x_url       AS company_x_url
    FROM jobs j
    JOIN companies c ON c.id = j.company_id
    ${where}
  `;
  const countBindings = [...bindings];
  const [countResult, dataResult] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS n FROM jobs j JOIN companies c ON c.id = j.company_id ${where}`).bind(...countBindings).first(),
    db.prepare(`${selectJoined} ORDER BY j.posted_at DESC, j.id DESC LIMIT ?`).bind(...bindings, filter.limit).all()
  ]);
  return {
    rows: dataResult.results ?? [],
    total: countResult?.n ?? 0
  };
}
__name(listJobs, "listJobs");
async function getJobById(db, id) {
  const result = await db.prepare(
    `SELECT
        j.*,
        c.name        AS company_name,
        c.logo_url    AS company_logo_url,
        c.description AS company_description,
        c.website_url AS company_website_url,
        c.linkedin_url AS company_linkedin_url,
        c.glassdoor_url AS company_glassdoor_url,
        c.x_url       AS company_x_url
       FROM jobs j
       JOIN companies c ON c.id = j.company_id
       WHERE j.id = ?`
  ).bind(id).first();
  return result ?? null;
}
__name(getJobById, "getJobById");
async function updateJobAiFields(db, id, jobSummary, jobDescription, now) {
  await db.prepare(
    `UPDATE jobs
       SET job_summary = ?, job_description = ?, ai_generated_at = ?
       WHERE id = ?`
  ).bind(jobSummary, jobDescription, now, id).run();
}
__name(updateJobAiFields, "updateJobAiFields");
async function getApiKeyByHash(db, hash) {
  const result = await db.prepare("SELECT * FROM api_keys WHERE key_hash = ? AND active = 1").bind(hash).first();
  return result ?? null;
}
__name(getApiKeyByHash, "getApiKeyByHash");
async function touchApiKeyLastUsed(db, id, now) {
  await db.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").bind(now, id).run();
}
__name(touchApiKeyLastUsed, "touchApiKeyLastUsed");
async function getMarketStats(db) {
  const now = Math.floor(Date.now() / 1e3);
  const day = 86400;
  const [
    totalResult,
    last24hResult,
    last7dResult,
    last30dResult,
    byEmploymentResult,
    byWorkplaceResult,
    topCompaniesResult,
    totalCompaniesResult,
    totalSourcesResult
  ] = await db.batch([
    db.prepare("SELECT COUNT(*) AS n FROM jobs"),
    db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE first_seen_at >= ?").bind(now - day),
    db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE first_seen_at >= ?").bind(now - 7 * day),
    db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE first_seen_at >= ?").bind(now - 30 * day),
    db.prepare(
      `SELECT employment_type, COUNT(*) AS count FROM jobs
       GROUP BY employment_type ORDER BY count DESC`
    ),
    db.prepare(
      `SELECT workplace_type, COUNT(*) AS count FROM jobs
       GROUP BY workplace_type ORDER BY count DESC`
    ),
    db.prepare(
      `SELECT c.name AS company_name, COUNT(*) AS count
       FROM jobs j JOIN companies c ON c.id = j.company_id
       GROUP BY j.company_id ORDER BY count DESC LIMIT 10`
    ),
    db.prepare("SELECT COUNT(*) AS n FROM companies"),
    db.prepare("SELECT COUNT(*) AS n FROM sources WHERE enabled = 1")
  ]);
  return {
    total_jobs: totalResult.results[0]?.n ?? 0,
    jobs_last_24h: last24hResult.results[0]?.n ?? 0,
    jobs_last_7d: last7dResult.results[0]?.n ?? 0,
    jobs_last_30d: last30dResult.results[0]?.n ?? 0,
    by_employment_type: byEmploymentResult.results ?? [],
    by_workplace_type: byWorkplaceResult.results ?? [],
    top_companies: topCompaniesResult.results ?? [],
    total_companies: totalCompaniesResult.results[0]?.n ?? 0,
    total_sources: totalSourcesResult.results[0]?.n ?? 0
  };
}
__name(getMarketStats, "getMarketStats");

// src/utils/normalize.ts
function slugify(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
__name(slugify, "slugify");
function buildDedupKey(title2, companySlug) {
  const normalizedTitle = title2.toLowerCase().trim().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ");
  return `${normalizedTitle}|${companySlug}`;
}
__name(buildDedupKey, "buildDedupKey");
var EMPLOYMENT_TYPE_MAP = {
  // Greenhouse
  full_time: "full_time",
  part_time: "part_time",
  contract: "contract",
  internship: "internship",
  temporary: "temporary",
  // Lever
  "full-time": "full_time",
  "part-time": "part_time",
  intern: "internship",
  // Workday / SmartRecruiters
  "full time": "full_time",
  "part time": "part_time",
  regular: "full_time",
  "fixed-term": "temporary",
  freelance: "contract"
};
function normalizeEmploymentType(raw) {
  if (!raw) return null;
  const key = raw.toLowerCase().trim();
  return EMPLOYMENT_TYPE_MAP[key] ?? null;
}
__name(normalizeEmploymentType, "normalizeEmploymentType");
function normalizeWorkplaceType(raw, locationHint) {
  const text = (raw ?? locationHint ?? "").toLowerCase();
  if (text.includes("remote")) return "remote";
  if (text.includes("hybrid")) return "hybrid";
  if (text.includes("on-site") || text.includes("on site") || text.includes("onsite") || text.includes("in-person")) return "on_site";
  return null;
}
__name(normalizeWorkplaceType, "normalizeWorkplaceType");
var CURRENCY_SYMBOLS = {
  "$": "USD",
  "\xA3": "GBP",
  "\u20AC": "EUR",
  "\xA5": "JPY",
  "\u20B9": "INR",
  "C$": "CAD",
  "A$": "AUD"
};
function parseSalary(raw) {
  const empty = { min: null, max: null, currency: null, period: null };
  if (!raw) return empty;
  let currency = null;
  for (const [sym, code] of Object.entries(CURRENCY_SYMBOLS)) {
    if (raw.includes(sym)) {
      currency = code;
      break;
    }
  }
  const isoMatch = raw.match(/\b(USD|GBP|EUR|JPY|INR|CAD|AUD)\b/i);
  if (!currency && isoMatch) currency = isoMatch[1].toUpperCase();
  let period = null;
  if (/\/?\s*(yr|year|annual|annually)/i.test(raw)) period = "year";
  else if (/\/?\s*(mo|month|monthly)/i.test(raw)) period = "month";
  else if (/\/?\s*(hr|hour|hourly)/i.test(raw)) period = "hour";
  const numbers = [...raw.matchAll(/[\d,]+(?:\.\d+)?k?/gi)].map((m) => {
    const s = m[0].replace(/,/g, "");
    const multiplier = s.toLowerCase().endsWith("k") ? 1e3 : 1;
    return parseFloat(s) * multiplier;
  });
  if (numbers.length === 0) return empty;
  const min = numbers[0];
  const max = numbers.length > 1 ? numbers[1] : null;
  return { min, max, currency, period };
}
__name(parseSalary, "parseSalary");
function normalizeLocation(raw) {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\s+/g, " ");
  return trimmed || null;
}
__name(normalizeLocation, "normalizeLocation");
function parseEpochSeconds(raw) {
  if (raw === null || raw === void 0) return null;
  if (typeof raw === "number") {
    return raw > 1e10 ? Math.floor(raw / 1e3) : raw;
  }
  if (typeof raw === "string") {
    const n = Date.parse(raw);
    if (isNaN(n)) return null;
    return Math.floor(n / 1e3);
  }
  return null;
}
__name(parseEpochSeconds, "parseEpochSeconds");
function buildJobId(sourceId, externalId) {
  const raw = `${sourceId}:${externalId}`;
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
__name(buildJobId, "buildJobId");
function uuidv4() {
  return crypto.randomUUID();
}
__name(uuidv4, "uuidv4");
function htmlToText(html) {
  return html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/?(p|div|li|h[1-6]|ul|ol|section|article)[^>]*>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
__name(htmlToText, "htmlToText");

// src/enrichment/ai.ts
var GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
var EMBEDDING_MODEL = "gemini-embedding-2-preview";
var EMBEDDING_DIMENSIONS = 768;
async function callGeminiEmbed(apiKey, text, taskType) {
  const url = `${GEMINI_API_BASE}/models/${EMBEDDING_MODEL}:embedContent?key=${apiKey}`;
  const body = {
    model: `models/${EMBEDDING_MODEL}`,
    content: { parts: [{ text }] },
    taskType,
    outputDimensionality: EMBEDDING_DIMENSIONS
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini Embedding API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  const values = data.embedding?.values;
  if (!values || values.length === 0) {
    throw new Error("Gemini Embedding returned empty vector");
  }
  return values;
}
__name(callGeminiEmbed, "callGeminiEmbed");
function buildJobEmbedText(title2, companyName, location, descriptionRaw) {
  const parts = [`${title2} at ${companyName}`];
  if (location) parts.push(`Location: ${location}`);
  if (descriptionRaw) {
    const cleaned = htmlToText(descriptionRaw).slice(0, 1500);
    parts.push(cleaned);
  }
  return parts.join("\n");
}
__name(buildJobEmbedText, "buildJobEmbedText");
async function embedJob(apiKey, title2, companyName, location, descriptionRaw) {
  const text = buildJobEmbedText(title2, companyName, location, descriptionRaw);
  return callGeminiEmbed(apiKey, text, "RETRIEVAL_DOCUMENT");
}
__name(embedJob, "embedJob");
async function embedQuery(apiKey, query) {
  return callGeminiEmbed(apiKey, query, "RETRIEVAL_QUERY");
}
__name(embedQuery, "embedQuery");
var MODEL = "gemini-3.1-flash-lite-preview";
async function callGemini(apiKey, prompt) {
  const url = `${GEMINI_API_BASE}/models/${MODEL}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1,
      // low temperature = more deterministic extraction
      maxOutputTokens: 1024
    }
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned empty response");
  return text;
}
__name(callGemini, "callGemini");
var JOB_EXTRACTION_PROMPT = /* @__PURE__ */ __name((companyName, jobTitle, descriptionText) => `
You are an assistant that extracts structured information from job postings.

Company: ${companyName}
Job title: ${jobTitle}

Raw job description:
---
${descriptionText.slice(0, 8e3)}
---

Extract the following from the job description above. Do NOT invent information not present in the text. If a section is absent, return an empty array for that field.

Return ONLY valid JSON with exactly this shape:
{
  "job_summary": "<one sentence: what the company does> <one sentence: what this role involves>",
  "responsibilities": ["<bullet>", ...],
  "minimum_qualifications": ["<bullet>", ...],
  "preferred_qualifications": ["<bullet>", ...]
}

Rules:
- job_summary must be exactly two sentences: sentence 1 describes the company, sentence 2 describes the role.
- responsibilities, minimum_qualifications, and preferred_qualifications must each be arrays of strings.
- Each array item should be a concise, standalone point. Do not include raw HTML.
- Return empty arrays [] for any section not clearly present in the source text.
`.trim(), "JOB_EXTRACTION_PROMPT");
async function extractJobFields(apiKey, companyName, jobTitle, descriptionRaw) {
  const descriptionText = htmlToText(descriptionRaw);
  const prompt = JOB_EXTRACTION_PROMPT(companyName, jobTitle, descriptionText);
  const raw = await callGemini(apiKey, prompt);
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Failed to parse Gemini response as JSON: ${cleaned.slice(0, 200)}`);
  }
  const ensureStringArray = /* @__PURE__ */ __name((val) => {
    if (!Array.isArray(val)) return [];
    return val.filter((v) => typeof v === "string");
  }, "ensureStringArray");
  return {
    job_summary: typeof parsed.job_summary === "string" ? parsed.job_summary : "",
    job_description: {
      responsibilities: ensureStringArray(parsed.responsibilities),
      minimum_qualifications: ensureStringArray(parsed.minimum_qualifications),
      preferred_qualifications: ensureStringArray(parsed.preferred_qualifications)
    }
  };
}
__name(extractJobFields, "extractJobFields");
var COMPANY_DESCRIPTION_PROMPT = /* @__PURE__ */ __name((companyName, contextText) => `
You are an assistant that writes factual one-sentence company descriptions.

Company name: ${companyName}

Context (from a job posting by this company):
---
${contextText.slice(0, 4e3)}
---

Write ONE sentence that directly describes what ${companyName} is and what it does. 
Do not use marketing language. Do not start with "A company that..." \u2014 name the company directly.
Do not invent facts not supported by the context.

Return ONLY valid JSON:
{ "description": "<one sentence>" }
`.trim(), "COMPANY_DESCRIPTION_PROMPT");
async function extractCompanyDescription(apiKey, companyName, contextText) {
  const text = htmlToText(contextText);
  const prompt = COMPANY_DESCRIPTION_PROMPT(companyName, text);
  const raw = await callGemini(apiKey, prompt);
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Failed to parse company description JSON: ${cleaned.slice(0, 200)}`);
  }
  return typeof parsed.description === "string" ? parsed.description : "";
}
__name(extractCompanyDescription, "extractCompanyDescription");

// src/utils/errors.ts
function jsonError(code, message, status) {
  const body = { error: { code, message } };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
__name(jsonError, "jsonError");
var Errors = {
  unauthorized(message = "Missing or invalid API key") {
    return jsonError("UNAUTHORIZED", message, 401);
  },
  forbidden(message = "Access denied") {
    return jsonError("FORBIDDEN", message, 403);
  },
  notFound(resource = "Resource") {
    return jsonError("NOT_FOUND", `${resource} not found`, 404);
  },
  methodNotAllowed() {
    return jsonError("METHOD_NOT_ALLOWED", "Method not allowed", 405);
  },
  rateLimited(retryAfterSeconds) {
    const resp = jsonError(
      "RATE_LIMITED",
      `Rate limit exceeded. Retry after ${retryAfterSeconds} seconds.`,
      429
    );
    resp.headers.set("Retry-After", String(retryAfterSeconds));
    return resp;
  },
  badRequest(message) {
    return jsonError("BAD_REQUEST", message, 400);
  },
  internal(message = "An unexpected error occurred") {
    return jsonError("INTERNAL_ERROR", message, 500);
  }
};
function jsonOk(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
__name(jsonOk, "jsonOk");

// src/middleware/auth.ts
function extractBearerToken(request) {
  const header = request.headers.get("Authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}
__name(extractBearerToken, "extractBearerToken");
async function sha256Hex(input) {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha256Hex, "sha256Hex");
async function authenticate(request, db) {
  const token = extractBearerToken(request);
  if (!token) {
    return { ok: false, response: Errors.unauthorized() };
  }
  const hash = await sha256Hex(token);
  const key = await getApiKeyByHash(db, hash);
  if (!key) {
    return { ok: false, response: Errors.unauthorized() };
  }
  return { ok: true, key };
}
__name(authenticate, "authenticate");
function recordKeyUsage(db, keyId, ctx) {
  const now = Math.floor(Date.now() / 1e3);
  ctx.waitUntil(touchApiKeyLastUsed(db, keyId, now));
}
__name(recordKeyUsage, "recordKeyUsage");

// src/middleware/rateLimit.ts
function minuteBucket() {
  const now = /* @__PURE__ */ new Date();
  const y = now.getUTCFullYear();
  const mo = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const h = String(now.getUTCHours()).padStart(2, "0");
  const m = String(now.getUTCMinutes()).padStart(2, "0");
  return `${y}${mo}${d}${h}${m}`;
}
__name(minuteBucket, "minuteBucket");
async function checkRateLimit(kv, key) {
  const bucket = minuteBucket();
  const kvKey = `ratelimit:${key.key_hash}:${bucket}`;
  const limit = key.rate_limit_per_minute;
  const currentStr = await kv.get(kvKey);
  const current = currentStr ? parseInt(currentStr, 10) : 0;
  if (current >= limit) {
    return { allowed: false, response: Errors.rateLimited(60) };
  }
  await kv.put(kvKey, String(current + 1), { expirationTtl: 90 });
  return { allowed: true, remaining: limit - current - 1 };
}
__name(checkRateLimit, "checkRateLimit");

// src/routes/jobs.ts
var DEFAULT_LIMIT = 20;
var MAX_LIMIT = 50;
var VECTOR_CANDIDATES = 100;
function buildRegularCursor(rows, limit) {
  if (rows.length < limit) return null;
  const last = rows[rows.length - 1];
  const ts = last.posted_at ?? last.first_seen_at;
  return btoa(`${ts}:${last.id}`).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
__name(buildRegularCursor, "buildRegularCursor");
function buildVectorCursor(currentOffset, pageSize, totalFiltered) {
  const nextOffset = currentOffset + pageSize;
  if (nextOffset >= totalFiltered) return null;
  return btoa(`vs:${nextOffset}`).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
__name(buildVectorCursor, "buildVectorCursor");
function decodeVectorCursor(cursor) {
  try {
    const padded = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(padded);
    if (!decoded.startsWith("vs:")) return null;
    const offset = parseInt(decoded.slice(3), 10);
    return isNaN(offset) ? null : offset;
  } catch {
    return null;
  }
}
__name(decodeVectorCursor, "decodeVectorCursor");
function rowToPublicJob(row) {
  const bestPostedAt = row.posted_at ?? row.first_seen_at;
  const postedAtIso = new Date(bestPostedAt * 1e3).toISOString();
  let salary = null;
  if (row.salary_currency && row.salary_period) {
    salary = {
      min: row.salary_min,
      max: row.salary_max,
      currency: row.salary_currency,
      period: row.salary_period
    };
  }
  return {
    id: row.id,
    title: row.title,
    posted_at: postedAtIso,
    apply_url: row.apply_url,
    location: row.location,
    employment_type: row.employment_type,
    workplace_type: row.workplace_type,
    source_name: row.source_name,
    source_url: row.source_url,
    salary,
    // List endpoint omits heavy AI fields for performance;
    // they are populated on the detail endpoint (GET /jobs/:id)
    job_summary: row.job_summary,
    job_description: null,
    company: {
      name: row.company_name,
      logo_url: row.company_logo_url,
      description: row.company_description,
      website_url: row.company_website_url,
      linkedin_url: row.company_linkedin_url,
      glassdoor_url: row.company_glassdoor_url,
      x_url: row.company_x_url
    }
  };
}
__name(rowToPublicJob, "rowToPublicJob");
async function handleListJobs(request, env2, ctx) {
  const auth = await authenticate(request, env2.JOBS_DB);
  if (!auth.ok) return auth.response;
  const rateCheck = await checkRateLimit(env2.RATE_LIMIT_KV, auth.key);
  if (!rateCheck.allowed) return rateCheck.response;
  recordKeyUsage(env2.JOBS_DB, auth.key.id, ctx);
  const url = new URL(request.url);
  const params = url.searchParams;
  const limitRaw = parseInt(params.get("limit") ?? String(DEFAULT_LIMIT), 10);
  const limit = isNaN(limitRaw) || limitRaw < 1 ? DEFAULT_LIMIT : Math.min(limitRaw, MAX_LIMIT);
  const q = params.get("q") ?? void 0;
  const location = params.get("location") ?? void 0;
  const employment_type = params.get("employment_type") ?? void 0;
  const workplace_type = params.get("workplace_type") ?? void 0;
  const company = params.get("company") ?? void 0;
  const cursor = params.get("cursor") ?? void 0;
  if (q && env2.JOBS_VECTORS && env2.GEMINI_API_KEY) {
    const vectorOffset = cursor ? decodeVectorCursor(cursor) ?? 0 : 0;
    const queryVector = await embedQuery(env2.GEMINI_API_KEY, q);
    const vectorResults = await env2.JOBS_VECTORS.query(queryVector, {
      topK: VECTOR_CANDIDATES,
      returnMetadata: "none"
    });
    const rankedIds = vectorResults.matches.map((m) => m.id);
    if (rankedIds.length > 0) {
      const filteredRows = await listJobsByIds(env2.JOBS_DB, rankedIds, {
        location,
        employment_type,
        workplace_type,
        company
      });
      const page = filteredRows.slice(vectorOffset, vectorOffset + limit);
      const nextCursor2 = buildVectorCursor(vectorOffset, page.length, filteredRows.length);
      return jsonOk({
        data: page.map(rowToPublicJob),
        meta: {
          total: filteredRows.length,
          limit,
          next_cursor: nextCursor2
        }
      });
    }
  }
  const { rows, total } = await listJobs(env2.JOBS_DB, {
    q,
    location,
    employment_type,
    workplace_type,
    company,
    limit,
    cursor
  });
  const data = rows.map(rowToPublicJob);
  const nextCursor = buildRegularCursor(rows, limit);
  return jsonOk({
    data,
    meta: {
      total,
      limit,
      next_cursor: nextCursor
    }
  });
}
__name(handleListJobs, "handleListJobs");

// src/utils/logger.ts
function emit2(level, msg, fields) {
  const entry = {
    level,
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    msg,
    ...fields
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}
__name(emit2, "emit");
var logger = {
  info(msg, fields) {
    emit2("info", msg, fields);
  },
  warn(msg, fields) {
    emit2("warn", msg, fields);
  },
  error(msg, fields) {
    emit2("error", msg, fields);
  },
  /**
   * Log a completed ingestion run for a single source.
   * This is the primary observability signal for cron health.
   */
  ingestionResult(result) {
    const level = result.error ? "warn" : "info";
    emit2(level, "ingestion_result", result);
  },
  /**
   * Log a summary across all sources after a full cron run.
   */
  ingestionSummary(summary) {
    emit2("info", "ingestion_summary", summary);
  }
};

// src/routes/job.ts
function rowToFullPublicJob(row) {
  const bestPostedAt = row.posted_at ?? row.first_seen_at;
  const postedAtIso = new Date(bestPostedAt * 1e3).toISOString();
  let salary = null;
  if (row.salary_currency && row.salary_period) {
    salary = {
      min: row.salary_min,
      max: row.salary_max,
      currency: row.salary_currency,
      period: row.salary_period
    };
  }
  let jobDescription = null;
  if (row.job_description) {
    try {
      jobDescription = JSON.parse(row.job_description);
    } catch {
    }
  }
  return {
    id: row.id,
    title: row.title,
    posted_at: postedAtIso,
    apply_url: row.apply_url,
    location: row.location,
    employment_type: row.employment_type,
    workplace_type: row.workplace_type,
    source_name: row.source_name,
    source_url: row.source_url,
    salary,
    job_summary: row.job_summary,
    job_description: jobDescription,
    company: {
      name: row.company_name,
      logo_url: row.company_logo_url,
      description: row.company_description,
      website_url: row.company_website_url,
      linkedin_url: row.company_linkedin_url,
      glassdoor_url: row.company_glassdoor_url,
      x_url: row.company_x_url
    }
  };
}
__name(rowToFullPublicJob, "rowToFullPublicJob");
async function handleGetJob(request, env2, ctx, jobId) {
  const auth = await authenticate(request, env2.JOBS_DB);
  if (!auth.ok) return auth.response;
  const rateCheck = await checkRateLimit(env2.RATE_LIMIT_KV, auth.key);
  if (!rateCheck.allowed) return rateCheck.response;
  recordKeyUsage(env2.JOBS_DB, auth.key.id, ctx);
  const row = await getJobById(env2.JOBS_DB, jobId);
  if (!row) return Errors.notFound("Job");
  const needsAi = env2.GEMINI_API_KEY && row.description_raw && (row.ai_generated_at === null || row.job_description === null);
  if (needsAi) {
    try {
      const extracted = await extractJobFields(
        env2.GEMINI_API_KEY,
        row.company_name,
        row.title,
        row.description_raw
      );
      const now = Math.floor(Date.now() / 1e3);
      const jobDescJson = JSON.stringify(extracted.job_description);
      ctx.waitUntil(
        updateJobAiFields(env2.JOBS_DB, row.id, extracted.job_summary, jobDescJson, now)
      );
      row.job_summary = extracted.job_summary;
      row.job_description = jobDescJson;
      row.ai_generated_at = now;
      if (!row.company_description && extracted.job_summary) {
        ctx.waitUntil(
          updateCompanyEnrichment(env2.JOBS_DB, row.company_id, {
            description: extracted.job_summary.split(". ")[0] + "."
          })
        );
      }
    } catch (err) {
      logger.warn("job_ai_extraction_failed", {
        job_id: row.id,
        error: String(err)
      });
    }
  }
  return jsonOk(rowToFullPublicJob(row));
}
__name(handleGetJob, "handleGetJob");

// src/routes/stats.ts
async function handleGetStats(request, env2, ctx) {
  const auth = await authenticate(request, env2.JOBS_DB);
  if (!auth.ok) return auth.response;
  const rateCheck = await checkRateLimit(env2.RATE_LIMIT_KV, auth.key);
  if (!rateCheck.allowed) return rateCheck.response;
  recordKeyUsage(env2.JOBS_DB, auth.key.id, ctx);
  const stats = await getMarketStats(env2.JOBS_DB);
  return jsonOk(stats);
}
__name(handleGetStats, "handleGetStats");

// src/enrichment/company.ts
var ENRICHMENT_REFRESH_SECONDS = 7 * 24 * 60 * 60;
function inferWebsiteUrl(slug) {
  return `https://www.${slug}.com`;
}
__name(inferWebsiteUrl, "inferWebsiteUrl");
function inferLinkedInUrl(slug) {
  return `https://www.linkedin.com/company/${slug}`;
}
__name(inferLinkedInUrl, "inferLinkedInUrl");
async function fetchClearbitLogoUrl(slug) {
  const domain2 = `${slug}.com`;
  const url = `https://logo.clearbit.com/${domain2}`;
  try {
    const res = await fetch(url, { method: "HEAD" });
    if (res.ok) return url;
  } catch {
  }
  return null;
}
__name(fetchClearbitLogoUrl, "fetchClearbitLogoUrl");
async function getCompanyJobContext(db, companyId) {
  const result = await db.prepare(
    `SELECT description_raw FROM jobs
       WHERE company_id = ? AND description_raw IS NOT NULL
       LIMIT 1`
  ).bind(companyId).first();
  return result?.description_raw ?? null;
}
__name(getCompanyJobContext, "getCompanyJobContext");
async function enrichCompany(db, company, geminiApiKey) {
  try {
    const now = Math.floor(Date.now() / 1e3);
    const fields = {
      description_enriched_at: now
    };
    if (!company.website_url) {
      fields.website_url = inferWebsiteUrl(company.slug);
    }
    if (!company.linkedin_url) {
      fields.linkedin_url = inferLinkedInUrl(company.slug);
    }
    if (!company.logo_url) {
      fields.logo_url = await fetchClearbitLogoUrl(company.slug);
    }
    if (!company.description) {
      const context2 = await getCompanyJobContext(db, company.id);
      if (context2) {
        try {
          const description = await extractCompanyDescription(
            geminiApiKey,
            company.name,
            context2
          );
          if (description) fields.description = description;
        } catch (aiErr) {
          logger.warn("company_description_ai_failed", {
            company_id: company.id,
            company_name: company.name,
            error: String(aiErr)
          });
        }
      }
    }
    await updateCompanyEnrichment(db, company.id, fields);
    logger.info("company_enriched", {
      company_id: company.id,
      company_name: company.name,
      fields_updated: Object.keys(fields).filter((k) => k !== "description_enriched_at")
    });
  } catch (err) {
    logger.error("company_enrichment_failed", {
      company_id: company.id,
      company_name: company.name,
      error: String(err)
    });
  }
}
__name(enrichCompany, "enrichCompany");
async function runCompanyEnrichment(db, geminiApiKey) {
  const staleBefore = Math.floor(Date.now() / 1e3) - ENRICHMENT_REFRESH_SECONDS;
  const companies = await listUnenrichedCompanies(db, staleBefore);
  if (companies.length === 0) {
    logger.info("company_enrichment_skipped", { reason: "no_stale_companies" });
    return;
  }
  logger.info("company_enrichment_started", { count: companies.length });
  for (const company of companies) {
    await enrichCompany(db, company, geminiApiKey);
  }
  logger.info("company_enrichment_completed", { count: companies.length });
}
__name(runCompanyEnrichment, "runCompanyEnrichment");

// src/ingestion/sources/greenhouse.ts
function extractSalaryFromMetadata(metadata) {
  for (const field of metadata) {
    const name = field.name.toLowerCase();
    if ((name.includes("salary") || name.includes("compensation") || name.includes("pay")) && field.value) {
      return field.value;
    }
  }
  return null;
}
__name(extractSalaryFromMetadata, "extractSalaryFromMetadata");
function extractWorkplaceFromMetadata(metadata, locationName) {
  for (const field of metadata) {
    const val = field.value?.toLowerCase() ?? "";
    if (val.includes("remote") || val.includes("hybrid") || val.includes("on-site")) {
      return val;
    }
  }
  return locationName;
}
__name(extractWorkplaceFromMetadata, "extractWorkplaceFromMetadata");
var greenhouseFetcher = {
  sourceType: "greenhouse",
  async fetch(source) {
    const url = `${source.base_url}?content=true`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)",
        Accept: "application/json"
      }
    });
    if (!res.ok) {
      throw new Error(`Greenhouse API error ${res.status} for ${source.company_handle}`);
    }
    const data = await res.json();
    const jobs = [];
    for (const job of data.jobs ?? []) {
      try {
        const locationName = job.location?.name ?? "";
        const salaryHint = extractSalaryFromMetadata(job.metadata ?? []);
        const workplaceHint = extractWorkplaceFromMetadata(job.metadata ?? [], locationName);
        const salary = parseSalary(salaryHint);
        jobs.push({
          external_id: String(job.id),
          title: job.title,
          location: normalizeLocation(locationName),
          employment_type: normalizeEmploymentType(null),
          // Greenhouse rarely includes this at board level
          workplace_type: normalizeWorkplaceType(workplaceHint, locationName),
          apply_url: job.absolute_url,
          source_url: job.absolute_url,
          description_raw: job.content ?? null,
          salary_min: salary.min,
          salary_max: salary.max,
          salary_currency: salary.currency,
          salary_period: salary.period,
          posted_at: parseEpochSeconds(job.updated_at),
          // best available date from board API
          company_name: source.name.replace(/\s*\(Greenhouse\)\s*/i, "").trim()
        });
      } catch {
        continue;
      }
    }
    return jobs;
  }
};

// src/ingestion/sources/lever.ts
function buildDescriptionRaw(posting) {
  const parts = [];
  if (posting.description) parts.push(posting.description);
  for (const list of posting.lists ?? []) {
    if (list.text) parts.push(`<h3>${list.text}</h3>`);
    if (list.content) parts.push(list.content);
  }
  return parts.join("\n");
}
__name(buildDescriptionRaw, "buildDescriptionRaw");
var leverFetcher = {
  sourceType: "lever",
  async fetch(source) {
    const url = `${source.base_url}?mode=json`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)",
        Accept: "application/json"
      }
    });
    if (!res.ok) {
      throw new Error(`Lever API error ${res.status} for ${source.company_handle}`);
    }
    const postings = await res.json();
    const jobs = [];
    for (const posting of postings ?? []) {
      try {
        const locationRaw = posting.categories?.location ?? null;
        const allLocations = posting.categories?.allLocations ?? [];
        const locationStr = locationRaw ?? allLocations[0] ?? null;
        const workplaceHint = posting.workplaceType ?? locationStr ?? null;
        jobs.push({
          external_id: posting.id,
          title: posting.text,
          location: normalizeLocation(locationStr),
          employment_type: normalizeEmploymentType(posting.commitment?.text ?? posting.categories?.commitment ?? null),
          workplace_type: normalizeWorkplaceType(workplaceHint, locationStr),
          apply_url: posting.applyUrl ?? posting.hostedUrl,
          source_url: posting.hostedUrl,
          description_raw: buildDescriptionRaw(posting),
          salary_min: null,
          // Lever board API does not include salary in public data
          salary_max: null,
          salary_currency: null,
          salary_period: null,
          posted_at: parseEpochSeconds(posting.createdAt),
          // createdAt is ms epoch
          company_name: source.name.replace(/\s*\(Lever\)\s*/i, "").trim()
        });
      } catch {
        continue;
      }
    }
    return jobs;
  }
};

// src/ingestion/sources/ashby.ts
var EMPLOYMENT_TYPE_MAP2 = {
  fulltime: "full_time",
  "full-time": "full_time",
  parttime: "part_time",
  "part-time": "part_time",
  contract: "contract",
  internship: "internship",
  temporary: "temporary"
};
function normalizeAshbyEmploymentType(raw) {
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/\s/g, "");
  return EMPLOYMENT_TYPE_MAP2[key] ?? null;
}
__name(normalizeAshbyEmploymentType, "normalizeAshbyEmploymentType");
function normalizeAshbyInterval(interval) {
  if (!interval) return null;
  const map = {
    YEARLY: "year",
    MONTHLY: "month",
    HOURLY: "hour"
  };
  return map[interval.toUpperCase()] ?? null;
}
__name(normalizeAshbyInterval, "normalizeAshbyInterval");
function buildLocationString(job) {
  if (job.locationName) return job.locationName;
  if (typeof job.location === "string") return job.location || null;
  if (job.location && typeof job.location === "object") {
    const loc = job.location;
    const parts = [loc.city, loc.region, loc.country].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : null;
  }
  return null;
}
__name(buildLocationString, "buildLocationString");
var ashbyFetcher = {
  sourceType: "ashby",
  async fetch(source) {
    const res = await fetch(source.base_url, {
      headers: {
        "User-Agent": "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)",
        Accept: "application/json"
      }
    });
    if (!res.ok) {
      throw new Error(`Ashby API error ${res.status} for ${source.company_handle}`);
    }
    const data = await res.json();
    const jobs = [];
    const companyName = data.organization?.name ?? source.name.replace(/\s*\(Ashby\)\s*/i, "").trim();
    for (const job of data.jobs ?? []) {
      try {
        const locationStr = buildLocationString(job);
        const locationIsRemote = typeof job.location === "object" ? job.location.isRemote : false;
        const isRemote = job.isRemote ?? locationIsRemote ?? false;
        const workplaceRaw = job.workplaceType ?? (isRemote ? "remote" : locationStr);
        let salaryMin = null;
        let salaryMax = null;
        let salaryCurrency = null;
        let salaryPeriod = null;
        const tiers = job.compensation?.summaryComponents ?? [];
        if (tiers.length > 0) {
          const tier = tiers[0];
          salaryMin = tier.minValue ?? null;
          salaryMax = tier.maxValue ?? null;
          salaryCurrency = tier.currency ?? null;
          salaryPeriod = normalizeAshbyInterval(tier.interval);
        }
        jobs.push({
          external_id: job.id,
          title: job.title,
          location: normalizeLocation(locationStr),
          employment_type: normalizeEmploymentType(normalizeAshbyEmploymentType(job.employmentType)),
          workplace_type: normalizeWorkplaceType(workplaceRaw, locationStr),
          apply_url: job.applyUrl ?? job.jobUrl ?? `https://jobs.ashbyhq.com/${source.company_handle}/${job.id}`,
          source_url: job.jobUrl ?? `https://jobs.ashbyhq.com/${source.company_handle}/${job.id}`,
          description_raw: job.descriptionHtml ?? null,
          salary_min: salaryMin,
          salary_max: salaryMax,
          salary_currency: salaryCurrency,
          salary_period: salaryPeriod,
          // Support both v2 (publishedAt) and v1 (publishedDate) field names
          posted_at: parseEpochSeconds(job.publishedAt ?? job.publishedDate),
          company_name: companyName
        });
      } catch {
        continue;
      }
    }
    return jobs;
  }
};

// src/ingestion/sources/workday.ts
var PAGE_SIZE = 100;
var workdayFetcher = {
  sourceType: "workday",
  async fetch(source) {
    const jobs = [];
    let offset = 0;
    let total = Infinity;
    while (offset < total) {
      const body = {
        appliedFacets: {},
        limit: PAGE_SIZE,
        offset,
        searchText: ""
      };
      const res = await fetch(source.base_url, {
        method: "POST",
        headers: {
          "User-Agent": "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)",
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        throw new Error(`Workday API error ${res.status} for ${source.company_handle}`);
      }
      const data = await res.json();
      total = data.total ?? 0;
      for (const posting of data.jobPostings ?? []) {
        try {
          const titleText = posting.title?.instances?.[0]?.text ?? "";
          if (!titleText) continue;
          const locationRaw = posting.locationsText ?? null;
          const timeType = posting.timeType?.descriptor ?? null;
          const jobType = posting.jobType?.[0]?.descriptor ?? null;
          const employmentHint = timeType ?? jobType;
          const applyUrl = posting.jobPostingURL.startsWith("http") ? posting.jobPostingURL : `https://${source.company_handle}.myworkdayjobs.com${posting.externalPath ?? ""}`;
          jobs.push({
            external_id: posting.id,
            title: titleText,
            location: normalizeLocation(locationRaw),
            employment_type: normalizeEmploymentType(employmentHint),
            workplace_type: normalizeWorkplaceType(null, locationRaw),
            apply_url: applyUrl,
            source_url: applyUrl,
            // Workday does not return full description in the list API;
            // bullet fields provide a light summary until a detail fetch is added.
            description_raw: posting.bulletFields?.join("\n") ?? null,
            salary_min: null,
            // Workday does not include salary in public list API
            salary_max: null,
            salary_currency: null,
            salary_period: null,
            posted_at: parseEpochSeconds(posting.postedOn?.date ?? null),
            company_name: source.name.replace(/\s*\(Workday\)\s*/i, "").trim()
          });
        } catch {
          continue;
        }
      }
      offset += PAGE_SIZE;
      if (offset >= 5e3) break;
    }
    return jobs;
  }
};

// src/ingestion/sources/smartrecruiters.ts
var PAGE_LIMIT = 100;
function buildSmartRecruitersLocation(loc) {
  if (loc.remote) return "Remote";
  const parts = [loc.city, loc.region, loc.country].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}
__name(buildSmartRecruitersLocation, "buildSmartRecruitersLocation");
var SR_EMPLOYMENT_TYPE_MAP = {
  permanent: "full_time",
  full_time: "full_time",
  part_time: "part_time",
  contract: "contract",
  internship: "internship",
  temporary: "temporary",
  freelance: "contract"
};
function normalizeSmartRecruitersEmploymentType(id) {
  if (!id) return null;
  const key = id.toLowerCase().replace(/-/g, "_");
  return SR_EMPLOYMENT_TYPE_MAP[key] ?? null;
}
__name(normalizeSmartRecruitersEmploymentType, "normalizeSmartRecruitersEmploymentType");
var smartRecruitersFetcher = {
  sourceType: "smartrecruiters",
  async fetch(source) {
    const jobs = [];
    let offset = 0;
    let totalFound = Infinity;
    while (offset < totalFound) {
      const url = new URL(source.base_url);
      url.searchParams.set("limit", String(PAGE_LIMIT));
      url.searchParams.set("offset", String(offset));
      const res = await fetch(url.toString(), {
        headers: {
          "User-Agent": "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)",
          Accept: "application/json"
        }
      });
      if (!res.ok) {
        throw new Error(`SmartRecruiters API error ${res.status} for ${source.company_handle}`);
      }
      const data = await res.json();
      totalFound = data.totalFound ?? 0;
      for (const posting of data.content ?? []) {
        try {
          const locationStr = buildSmartRecruitersLocation(posting.location);
          const isRemote = posting.location.remote ?? false;
          const workplaceHint = isRemote ? "remote" : locationStr;
          const employmentTypeId = posting.typeOfEmployment?.id;
          jobs.push({
            external_id: posting.id,
            title: posting.name,
            location: normalizeLocation(locationStr),
            employment_type: normalizeEmploymentType(
              normalizeSmartRecruitersEmploymentType(employmentTypeId)
            ),
            workplace_type: normalizeWorkplaceType(workplaceHint, locationStr),
            apply_url: posting.ref,
            source_url: posting.ref,
            // SmartRecruiters list API does not return description bodies;
            // description_raw will be null until a detail fetch enhancement is added.
            description_raw: null,
            salary_min: null,
            salary_max: null,
            salary_currency: null,
            salary_period: null,
            posted_at: parseEpochSeconds(posting.releasedDate),
            company_name: source.name.replace(/\s*\(SmartRecruiters\)\s*/i, "").trim()
          });
        } catch {
          continue;
        }
      }
      offset += PAGE_LIMIT;
      if (offset >= 5e3) break;
    }
    return jobs;
  }
};

// src/ingestion/sources/recruitee.ts
function buildDescriptionRaw2(offer) {
  const parts = [];
  if (offer.description) parts.push(offer.description);
  if (offer.requirements) parts.push(offer.requirements);
  return parts.length > 0 ? parts.join("\n") : null;
}
__name(buildDescriptionRaw2, "buildDescriptionRaw");
function resolveLocation(offer) {
  if (offer.city && offer.country) return `${offer.city}, ${offer.country}`;
  if (offer.city) return offer.city;
  if (offer.country) return offer.country;
  return offer.location ?? null;
}
__name(resolveLocation, "resolveLocation");
var recruiteeFetcher = {
  sourceType: "recruitee",
  async fetch(source) {
    const res = await fetch(source.base_url, {
      headers: {
        "User-Agent": "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)",
        Accept: "application/json"
      }
    });
    if (!res.ok) {
      throw new Error(`Recruitee API error ${res.status} for ${source.company_handle}`);
    }
    const data = await res.json();
    const jobs = [];
    for (const offer of data.offers ?? []) {
      try {
        const locationStr = resolveLocation(offer);
        const workplaceHint = offer.remote_type ?? (offer.remote ? "remote" : null) ?? locationStr;
        jobs.push({
          external_id: String(offer.id),
          title: offer.title,
          location: normalizeLocation(locationStr),
          employment_type: normalizeEmploymentType(offer.employment_type_code),
          workplace_type: normalizeWorkplaceType(workplaceHint, locationStr),
          apply_url: offer.apply_url ?? offer.careers_url,
          source_url: offer.careers_url,
          description_raw: buildDescriptionRaw2(offer),
          salary_min: null,
          salary_max: null,
          salary_currency: null,
          salary_period: null,
          posted_at: parseEpochSeconds(offer.created_at),
          company_name: source.name.replace(/\s*\(Recruitee\)\s*/i, "").trim()
        });
      } catch {
        continue;
      }
    }
    return jobs;
  }
};

// src/ingestion/sources/workable.ts
function buildLocation(job) {
  if (job.location_str) return job.location_str;
  const parts = [job.city, job.state, job.country].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}
__name(buildLocation, "buildLocation");
var workableFetcher = {
  sourceType: "workable",
  async fetch(source) {
    const res = await fetch(source.base_url, {
      headers: {
        "User-Agent": "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)",
        Accept: "application/json"
      }
    });
    if (!res.ok) {
      throw new Error(`Workable API error ${res.status} for ${source.company_handle}`);
    }
    const data = await res.json();
    const jobs = [];
    for (const job of data.jobs ?? []) {
      try {
        const locationStr = buildLocation(job);
        jobs.push({
          external_id: job.id,
          title: job.title,
          location: normalizeLocation(locationStr),
          employment_type: normalizeEmploymentType(job.type_of_employment),
          workplace_type: normalizeWorkplaceType(job.workplace, locationStr),
          apply_url: job.url,
          source_url: job.url,
          // Public v1 widget does not expose description — AI extraction will skip gracefully
          description_raw: null,
          salary_min: null,
          salary_max: null,
          salary_currency: null,
          salary_period: null,
          posted_at: parseEpochSeconds(job.published_on),
          company_name: source.name.replace(/\s*\(Workable\)\s*/i, "").trim()
        });
      } catch {
        continue;
      }
    }
    return jobs;
  }
};

// src/ingestion/sources/personio.ts
function getText(parent, tagName) {
  const el = parent.getElementsByTagName(tagName)[0];
  const text = el?.textContent?.trim() ?? null;
  return text || null;
}
__name(getText, "getText");
function parseJobElement(el, companyName) {
  const externalId = getText(el, "id");
  const title2 = getText(el, "name");
  const applyUrl = getText(el, "apply_url") ?? getText(el, "applicationUrl");
  if (!externalId || !title2 || !applyUrl) return null;
  const location = getText(el, "office") ?? getText(el, "location");
  const department = getText(el, "department");
  const employmentTypeRaw = getText(el, "schedule") ?? getText(el, "employment_type");
  const remoteHint = getText(el, "remote") ?? getText(el, "workplace");
  const createdAt = getText(el, "created_at") ?? getText(el, "createdAt");
  const descriptionParts = [];
  const descEl = el.getElementsByTagName("jobDescriptions")[0];
  if (descEl) {
    const sections = descEl.getElementsByTagName("jobDescription");
    for (const section of sections) {
      const name = getText(section, "name");
      const value = getText(section, "value");
      if (value) {
        if (name) descriptionParts.push(`<h3>${name}</h3>
${value}`);
        else descriptionParts.push(value);
      }
    }
  }
  if (descriptionParts.length === 0) {
    const rawDesc = getText(el, "description") ?? getText(el, "summary");
    if (rawDesc) descriptionParts.push(rawDesc);
  }
  const locationHint = [remoteHint, location].filter(Boolean).join(" ");
  return {
    external_id: externalId,
    title: title2,
    location: normalizeLocation(
      department && location ? `${location} (${department})` : location
    ),
    employment_type: normalizeEmploymentType(employmentTypeRaw),
    workplace_type: normalizeWorkplaceType(locationHint),
    apply_url: applyUrl,
    source_url: applyUrl,
    description_raw: descriptionParts.length > 0 ? descriptionParts.join("\n\n") : null,
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    posted_at: parseEpochSeconds(createdAt),
    company_name: companyName
  };
}
__name(parseJobElement, "parseJobElement");
var personioFetcher = {
  sourceType: "personio",
  async fetch(source) {
    const res = await fetch(source.base_url, {
      headers: {
        "User-Agent": "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)",
        Accept: "application/xml, text/xml, */*"
      }
    });
    if (!res.ok) {
      throw new Error(`Personio XML error ${res.status} for ${source.company_handle}`);
    }
    const xmlText = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "application/xml");
    const parserError = doc.querySelector("parsererror");
    if (parserError) {
      throw new Error(`Personio XML parse error for ${source.company_handle}: ${parserError.textContent}`);
    }
    const companyName = source.name.replace(/\s*\(Personio\)\s*/i, "").trim();
    const jobElements = doc.getElementsByTagName("job");
    const jobs = [];
    for (const el of jobElements) {
      try {
        const job = parseJobElement(el, companyName);
        if (job) jobs.push(job);
      } catch {
        continue;
      }
    }
    return jobs;
  }
};

// src/ingestion/sources/pinpoint.ts
function buildApplyUrl(handle, posting) {
  const base = `https://${handle}.pinpointhq.com`;
  if (posting.apply_path) return `${base}${posting.apply_path}`;
  return `${base}/postings/${posting.id}`;
}
__name(buildApplyUrl, "buildApplyUrl");
var pinpointFetcher = {
  sourceType: "pinpoint",
  async fetch(source) {
    const res = await fetch(source.base_url, {
      headers: {
        "User-Agent": "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)",
        Accept: "application/json"
      }
    });
    if (!res.ok) {
      throw new Error(`Pinpoint API error ${res.status} for ${source.company_handle}`);
    }
    const data = await res.json();
    const jobs = [];
    for (const posting of data.postings ?? []) {
      try {
        const workplaceHint = posting.remote_type ?? (posting.remote ? "remote" : null) ?? posting.location;
        const applyUrl = buildApplyUrl(source.company_handle, posting);
        jobs.push({
          external_id: String(posting.id),
          title: posting.title,
          location: normalizeLocation(posting.location),
          employment_type: normalizeEmploymentType(posting.employment_type),
          workplace_type: normalizeWorkplaceType(workplaceHint, posting.location),
          apply_url: applyUrl,
          source_url: applyUrl,
          description_raw: posting.description ?? null,
          salary_min: null,
          salary_max: null,
          salary_currency: null,
          salary_period: null,
          posted_at: parseEpochSeconds(posting.published_at),
          company_name: source.name.replace(/\s*\(Pinpoint\)\s*/i, "").trim()
        });
      } catch {
        continue;
      }
    }
    return jobs;
  }
};

// src/ingestion/sources/amazon.ts
var BASE_URL = "https://www.amazon.jobs/en/search.json";
var PAGE_SIZE2 = 100;
var MAX_PAGES = 20;
function buildLocation2(job) {
  if (job.location) return job.location;
  const parts = [job.city, job.state, job.country_code].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}
__name(buildLocation2, "buildLocation");
var amazonFetcher = {
  sourceType: "amazon",
  async fetch(_source) {
    const jobs = [];
    let offset = 0;
    let page = 0;
    while (page < MAX_PAGES) {
      const url = `${BASE_URL}?offset=${offset}&result_limit=${PAGE_SIZE2}&normalized_country_code[]=USA&normalized_country_code[]=GBR&normalized_country_code[]=DEU&normalized_country_code[]=CAN&normalized_country_code[]=AUS`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)",
          Accept: "application/json"
        }
      });
      if (!res.ok) {
        throw new Error(`Amazon Jobs API error ${res.status} at offset ${offset}`);
      }
      const data = await res.json();
      const hits = data.hits ?? [];
      if (hits.length === 0) break;
      for (const hit of hits) {
        try {
          const locationStr = buildLocation2(hit);
          const workplaceHint = hit.is_remote ? "remote" : locationStr;
          const applyUrl = `https://www.amazon.jobs${hit.job_path}`;
          jobs.push({
            external_id: hit.id_icims,
            title: hit.title,
            location: normalizeLocation(locationStr),
            employment_type: normalizeEmploymentType(hit.schedule_type),
            workplace_type: normalizeWorkplaceType(workplaceHint, locationStr),
            apply_url: applyUrl,
            source_url: applyUrl,
            // Amazon's public search does not include full descriptions —
            // only a short summary. We store the short summary for AI context.
            description_raw: hit.description_short ?? null,
            salary_min: null,
            salary_max: null,
            salary_currency: null,
            salary_period: null,
            posted_at: parseEpochSeconds(hit.posted_date),
            company_name: "Amazon"
          });
        } catch {
          continue;
        }
      }
      if (hits.length < PAGE_SIZE2) break;
      offset += PAGE_SIZE2;
      page++;
    }
    return jobs;
  }
};

// src/ingestion/sources/apple.ts
var API_URL = "https://jobs.apple.com/api/role/search";
var PAGE_SIZE3 = 20;
var MAX_PAGES2 = 50;
function buildLocation3(locations) {
  if (!locations || locations.length === 0) return null;
  const first = locations[0];
  if (first.name) return first.name;
  const parts = [first.city, first.state, first.countryCode].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}
__name(buildLocation3, "buildLocation");
var appleFetcher = {
  sourceType: "apple",
  async fetch(_source) {
    const jobs = [];
    let page = 1;
    while (page <= MAX_PAGES2) {
      const body = JSON.stringify({
        query: "",
        filters: {},
        page,
        locale: "en-us",
        sort: "newest"
      });
      const res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "User-Agent": "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)",
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body
      });
      if (!res.ok) {
        throw new Error(`Apple Jobs API error ${res.status} on page ${page}`);
      }
      const data = await res.json();
      const results = data.searchResults ?? [];
      if (results.length === 0) break;
      for (const role of results) {
        try {
          const locationStr = buildLocation3(role.locations ?? []);
          const workplaceHint = role.isRemote ? "remote" : locationStr;
          const applyUrl = `https://jobs.apple.com/en-us/details/${role.positionId}/${role.transformedPostingTitle}`;
          jobs.push({
            external_id: role.positionId,
            title: role.postingTitle,
            location: normalizeLocation(locationStr),
            employment_type: normalizeEmploymentType(role.employmentType),
            workplace_type: normalizeWorkplaceType(workplaceHint, locationStr),
            apply_url: applyUrl,
            source_url: applyUrl,
            // Apple's search API does not return full descriptions.
            // The detail page is behind a JS-rendered frontend.
            description_raw: null,
            salary_min: null,
            salary_max: null,
            salary_currency: null,
            salary_period: null,
            posted_at: parseEpochSeconds(role.postingDate),
            company_name: "Apple"
          });
        } catch {
          continue;
        }
      }
      if (results.length < PAGE_SIZE3) break;
      page++;
    }
    return jobs;
  }
};

// src/ingestion/registry.ts
var REGISTRY = {
  greenhouse: greenhouseFetcher,
  lever: leverFetcher,
  ashby: ashbyFetcher,
  workday: workdayFetcher,
  smartrecruiters: smartRecruitersFetcher,
  recruitee: recruiteeFetcher,
  workable: workableFetcher,
  personio: personioFetcher,
  pinpoint: pinpointFetcher,
  amazon: amazonFetcher,
  apple: appleFetcher
};
function getFetcher(sourceType) {
  return REGISTRY[sourceType] ?? null;
}
__name(getFetcher, "getFetcher");
var SOURCE_PRIORITY = {
  // Direct ATS (employer's own system of record) — highest trust
  greenhouse: 100,
  lever: 100,
  ashby: 100,
  recruitee: 100,
  workable: 100,
  personio: 100,
  pinpoint: 100,
  // Semi-direct: employer configures listing but through a larger platform
  workday: 80,
  smartrecruiters: 70,
  // Company-owned careers portals — high trust (direct from the company itself)
  amazon: 90,
  apple: 90
};
function getSourcePriority(sourceType) {
  return SOURCE_PRIORITY[sourceType] ?? 50;
}
__name(getSourcePriority, "getSourcePriority");

// src/ingestion/dedup.ts
async function isCrossSourceDuplicate(db, dedupKey, incomingSourceType, incomingSourceId) {
  const existing = await db.prepare(
    `SELECT id, source_name FROM jobs
       WHERE dedup_key = ? AND source_id != ?
       LIMIT 1`
  ).bind(dedupKey, incomingSourceId).first();
  if (!existing) return false;
  const existingPriority = getSourcePriority(existing.source_name);
  const incomingPriority = getSourcePriority(incomingSourceType);
  return existingPriority > incomingPriority;
}
__name(isCrossSourceDuplicate, "isCrossSourceDuplicate");

// src/ingestion/runner.ts
async function processSource(env2, source) {
  const db = env2.JOBS_DB;
  const start = Date.now();
  const result = {
    source_id: source.id,
    source_name: source.name,
    fetched: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    deduplicated: 0,
    failed: 0,
    error: null,
    duration_ms: 0
  };
  const fetcher = getFetcher(source.source_type);
  if (!fetcher) {
    result.error = `No fetcher registered for source_type: ${source.source_type}`;
    result.duration_ms = Date.now() - start;
    return result;
  }
  let rawJobs;
  try {
    rawJobs = await fetcher.fetch(source);
    result.fetched = rawJobs.length;
  } catch (err) {
    result.error = String(err);
    result.duration_ms = Date.now() - start;
    await updateSourceFetchResult(db, source.id, Math.floor(Date.now() / 1e3), 0, result.error);
    return result;
  }
  const now = Math.floor(Date.now() / 1e3);
  for (const normalized of rawJobs) {
    try {
      const companySlug = slugify(normalized.company_name);
      const companyId = await upsertCompany(db, uuidv4(), normalized.company_name, companySlug, now);
      const dedupKey = buildDedupKey(normalized.title, companySlug);
      const isDuplicate = await isCrossSourceDuplicate(
        db,
        dedupKey,
        source.source_type,
        source.id
      );
      if (isDuplicate) {
        result.deduplicated++;
        continue;
      }
      const jobId = buildJobId(source.id, normalized.external_id);
      const { inserted, needsEmbedding } = await upsertJob(db, {
        id: jobId,
        company_id: companyId,
        source_id: source.id,
        external_id: normalized.external_id,
        source_name: source.source_type,
        dedup_key: dedupKey,
        normalized,
        now
      });
      if (inserted) {
        result.inserted++;
      } else {
        result.updated++;
      }
      if (needsEmbedding && env2.JOBS_VECTORS && env2.GEMINI_API_KEY) {
        try {
          const vector = await embedJob(
            env2.GEMINI_API_KEY,
            normalized.title,
            normalized.company_name,
            normalized.location,
            normalized.description_raw
          );
          await env2.JOBS_VECTORS.upsert([{ id: jobId, values: vector }]);
          await markJobEmbedded(db, jobId, now);
        } catch (embedErr) {
          logger.warn("job_embedding_failed", {
            job_id: jobId,
            error: String(embedErr)
          });
        }
      }
    } catch (err) {
      result.failed++;
      logger.warn("job_upsert_failed", {
        source_id: source.id,
        external_id: normalized.external_id,
        error: String(err)
      });
    }
  }
  await updateSourceFetchResult(db, source.id, now, result.fetched, null);
  result.duration_ms = Date.now() - start;
  return result;
}
__name(processSource, "processSource");
var EMBEDDING_BACKFILL_BATCH = 500;
async function backfillEmbeddings(env2) {
  if (!env2.JOBS_VECTORS || !env2.GEMINI_API_KEY) {
    logger.warn("embedding_backfill_skipped", { reason: "Vectorize or GEMINI_API_KEY not configured" });
    return;
  }
  const jobs = await getJobsNeedingEmbedding(env2.JOBS_DB, EMBEDDING_BACKFILL_BATCH);
  if (jobs.length === 0) {
    logger.info("embedding_backfill_skipped", { reason: "no jobs missing embeddings" });
    return;
  }
  logger.info("embedding_backfill_started", { count: jobs.length });
  const now = Math.floor(Date.now() / 1e3);
  let succeeded = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      const vector = await embedJob(
        env2.GEMINI_API_KEY,
        job.title,
        job.company_name,
        job.location,
        job.description_raw
      );
      await env2.JOBS_VECTORS.upsert([{ id: job.id, values: vector }]);
      await markJobEmbedded(env2.JOBS_DB, job.id, now);
      succeeded++;
    } catch (err) {
      failed++;
      logger.warn("embedding_backfill_job_failed", { job_id: job.id, error: String(err) });
    }
  }
  logger.info("embedding_backfill_completed", { succeeded, failed, total: jobs.length });
}
__name(backfillEmbeddings, "backfillEmbeddings");
async function runIngestion(env2) {
  const overallStart = Date.now();
  logger.info("ingestion_started");
  const sources = await listEnabledSources(env2.JOBS_DB);
  logger.info("ingestion_sources_loaded", { count: sources.length });
  const results = [];
  for (const source of sources) {
    logger.info("ingestion_source_started", { source_id: source.id, source_name: source.name });
    const result = await processSource(env2, source);
    logger.ingestionResult(result);
    results.push(result);
  }
  const summary = {
    sources_processed: results.length,
    sources_errored: results.filter((r) => r.error !== null).length,
    total_fetched: results.reduce((s, r) => s + r.fetched, 0),
    total_inserted: results.reduce((s, r) => s + r.inserted, 0),
    total_updated: results.reduce((s, r) => s + r.updated, 0),
    total_skipped: results.reduce((s, r) => s + r.skipped, 0),
    total_deduplicated: results.reduce((s, r) => s + r.deduplicated, 0),
    total_failed: results.reduce((s, r) => s + r.failed, 0),
    duration_ms: Date.now() - overallStart
  };
  logger.ingestionSummary(summary);
  if (env2.GEMINI_API_KEY) {
    try {
      await runCompanyEnrichment(env2.JOBS_DB, env2.GEMINI_API_KEY);
    } catch (err) {
      logger.error("company_enrichment_cron_failed", { error: String(err) });
    }
  } else {
    logger.warn("company_enrichment_skipped", { reason: "GEMINI_API_KEY not set" });
  }
  try {
    await backfillEmbeddings(env2);
  } catch (err) {
    logger.error("embedding_backfill_cron_failed", { error: String(err) });
  }
}
__name(runIngestion, "runIngestion");

// src/db/migrate.ts
var SEED_SOURCES = [
  // Greenhouse — public board API: https://boards-api.greenhouse.io/v1/boards/{handle}/jobs
  { id: "gh-stripe", name: "Stripe (Greenhouse)", source_type: "greenhouse", company_handle: "stripe", base_url: "https://boards-api.greenhouse.io/v1/boards/stripe/jobs" },
  { id: "gh-airbnb", name: "Airbnb (Greenhouse)", source_type: "greenhouse", company_handle: "airbnb", base_url: "https://boards-api.greenhouse.io/v1/boards/airbnb/jobs" },
  { id: "gh-shopify", name: "Shopify (Greenhouse)", source_type: "greenhouse", company_handle: "shopify", base_url: "https://boards-api.greenhouse.io/v1/boards/shopify/jobs" },
  { id: "gh-discord", name: "Discord (Greenhouse)", source_type: "greenhouse", company_handle: "discord", base_url: "https://boards-api.greenhouse.io/v1/boards/discord/jobs" },
  { id: "gh-figma", name: "Figma (Greenhouse)", source_type: "greenhouse", company_handle: "figma", base_url: "https://boards-api.greenhouse.io/v1/boards/figma/jobs" },
  { id: "gh-notion", name: "Notion (Greenhouse)", source_type: "greenhouse", company_handle: "notion", base_url: "https://boards-api.greenhouse.io/v1/boards/notion/jobs" },
  { id: "gh-airtable", name: "Airtable (Greenhouse)", source_type: "greenhouse", company_handle: "airtable", base_url: "https://boards-api.greenhouse.io/v1/boards/airtable/jobs" },
  { id: "gh-linear", name: "Linear (Greenhouse)", source_type: "greenhouse", company_handle: "linear", base_url: "https://boards-api.greenhouse.io/v1/boards/linear/jobs" },
  { id: "gh-vercel", name: "Vercel (Greenhouse)", source_type: "greenhouse", company_handle: "vercel", base_url: "https://boards-api.greenhouse.io/v1/boards/vercel/jobs" },
  // Greenhouse — tech with diverse accessible roles (support, sales, ops, content)
  { id: "gh-instacart", name: "Instacart (Greenhouse)", source_type: "greenhouse", company_handle: "instacart", base_url: "https://boards-api.greenhouse.io/v1/boards/instacart/jobs" },
  { id: "gh-hubspot", name: "HubSpot (Greenhouse)", source_type: "greenhouse", company_handle: "hubspot", base_url: "https://boards-api.greenhouse.io/v1/boards/hubspot/jobs" },
  { id: "gh-gusto", name: "Gusto (Greenhouse)", source_type: "greenhouse", company_handle: "gusto", base_url: "https://boards-api.greenhouse.io/v1/boards/gusto/jobs" },
  { id: "gh-grammarly", name: "Grammarly (Greenhouse)", source_type: "greenhouse", company_handle: "grammarly", base_url: "https://boards-api.greenhouse.io/v1/boards/grammarly/jobs" },
  { id: "gh-pinterest", name: "Pinterest (Greenhouse)", source_type: "greenhouse", company_handle: "pinterest", base_url: "https://boards-api.greenhouse.io/v1/boards/pinterest/jobs" },
  { id: "gh-dropbox", name: "Dropbox (Greenhouse)", source_type: "greenhouse", company_handle: "dropbox", base_url: "https://boards-api.greenhouse.io/v1/boards/dropbox/jobs" },
  { id: "gh-brex", name: "Brex (Greenhouse)", source_type: "greenhouse", company_handle: "brex", base_url: "https://boards-api.greenhouse.io/v1/boards/brex/jobs" },
  { id: "gh-gitlab", name: "GitLab (Greenhouse)", source_type: "greenhouse", company_handle: "gitlab", base_url: "https://boards-api.greenhouse.io/v1/boards/gitlab/jobs" },
  { id: "gh-twitch", name: "Twitch (Greenhouse)", source_type: "greenhouse", company_handle: "twitch", base_url: "https://boards-api.greenhouse.io/v1/boards/twitch/jobs" },
  { id: "gh-flexport", name: "Flexport (Greenhouse)", source_type: "greenhouse", company_handle: "flexport", base_url: "https://boards-api.greenhouse.io/v1/boards/flexport/jobs" },
  { id: "gh-klaviyo", name: "Klaviyo (Greenhouse)", source_type: "greenhouse", company_handle: "klaviyo", base_url: "https://boards-api.greenhouse.io/v1/boards/klaviyo/jobs" },
  { id: "gh-carta", name: "Carta (Greenhouse)", source_type: "greenhouse", company_handle: "carta", base_url: "https://boards-api.greenhouse.io/v1/boards/carta/jobs" },
  { id: "gh-databricks", name: "Databricks (Greenhouse)", source_type: "greenhouse", company_handle: "databricks", base_url: "https://boards-api.greenhouse.io/v1/boards/databricks/jobs" },
  { id: "gh-duolingo", name: "Duolingo (Greenhouse)", source_type: "greenhouse", company_handle: "duolingo", base_url: "https://boards-api.greenhouse.io/v1/boards/duolingo/jobs" },
  { id: "gh-robinhood", name: "Robinhood (Greenhouse)", source_type: "greenhouse", company_handle: "robinhood", base_url: "https://boards-api.greenhouse.io/v1/boards/robinhood/jobs" },
  { id: "gh-coinbase", name: "Coinbase (Greenhouse)", source_type: "greenhouse", company_handle: "coinbase", base_url: "https://boards-api.greenhouse.io/v1/boards/coinbase/jobs" },
  { id: "gh-chime", name: "Chime (Greenhouse)", source_type: "greenhouse", company_handle: "chime", base_url: "https://boards-api.greenhouse.io/v1/boards/chime/jobs" },
  { id: "gh-coursera", name: "Coursera (Greenhouse)", source_type: "greenhouse", company_handle: "coursera", base_url: "https://boards-api.greenhouse.io/v1/boards/coursera/jobs" },
  // Greenhouse — retail, fashion, lifestyle (store associate & ops roles)
  { id: "gh-sweetgreen", name: "Sweetgreen (Greenhouse)", source_type: "greenhouse", company_handle: "sweetgreen", base_url: "https://boards-api.greenhouse.io/v1/boards/sweetgreen/jobs" },
  { id: "gh-allbirds", name: "Allbirds (Greenhouse)", source_type: "greenhouse", company_handle: "allbirds", base_url: "https://boards-api.greenhouse.io/v1/boards/allbirds/jobs" },
  { id: "gh-glossier", name: "Glossier (Greenhouse)", source_type: "greenhouse", company_handle: "glossier", base_url: "https://boards-api.greenhouse.io/v1/boards/glossier/jobs" },
  // Greenhouse — healthcare & wellness (patient care, coaching, support, clinical ops)
  { id: "gh-oscar", name: "Oscar Health (Greenhouse)", source_type: "greenhouse", company_handle: "oscar", base_url: "https://boards-api.greenhouse.io/v1/boards/oscar/jobs" },
  // Lever — public board API: https://api.lever.co/v0/postings/{handle}
  // Note: Many companies that were on Lever have migrated to other ATS platforms.
  // Only handles confirmed active as of 2026 are listed here.
  { id: "lv-wealthsimple", name: "Wealthsimple (Lever)", source_type: "lever", company_handle: "wealthsimple", base_url: "https://api.lever.co/v0/postings/wealthsimple" },
  { id: "lv-rover", name: "Rover (Lever)", source_type: "lever", company_handle: "rover", base_url: "https://api.lever.co/v0/postings/rover" },
  { id: "lv-plaid", name: "Plaid (Lever)", source_type: "lever", company_handle: "plaid", base_url: "https://api.lever.co/v0/postings/plaid" },
  // Previously on Lever, now confirmed on Greenhouse:
  { id: "gh-lyft", name: "Lyft (Greenhouse)", source_type: "greenhouse", company_handle: "lyft", base_url: "https://boards-api.greenhouse.io/v1/boards/lyft/jobs" },
  { id: "gh-reddit", name: "Reddit (Greenhouse)", source_type: "greenhouse", company_handle: "reddit", base_url: "https://boards-api.greenhouse.io/v1/boards/reddit/jobs" },
  // Ashby — public board API (new endpoint as of 2026)
  // Format: https://api.ashbyhq.com/posting-api/job-board/{handle}
  // Note: the old jobs.ashbyhq.com/api/... endpoint now returns 404.
  { id: "ab-openai", name: "OpenAI (Ashby)", source_type: "ashby", company_handle: "openai", base_url: "https://api.ashbyhq.com/posting-api/job-board/openai?includeCompensation=true" },
  { id: "ab-ramp", name: "Ramp (Ashby)", source_type: "ashby", company_handle: "ramp", base_url: "https://api.ashbyhq.com/posting-api/job-board/ramp?includeCompensation=true" },
  { id: "ab-notion", name: "Notion (Ashby)", source_type: "ashby", company_handle: "notion", base_url: "https://api.ashbyhq.com/posting-api/job-board/notion?includeCompensation=true" },
  { id: "ab-deel", name: "Deel (Ashby)", source_type: "ashby", company_handle: "deel", base_url: "https://api.ashbyhq.com/posting-api/job-board/deel?includeCompensation=true" },
  { id: "ab-plaid", name: "Plaid (Ashby)", source_type: "ashby", company_handle: "plaid", base_url: "https://api.ashbyhq.com/posting-api/job-board/plaid?includeCompensation=true" },
  { id: "ab-lemonade", name: "Lemonade (Ashby)", source_type: "ashby", company_handle: "lemonade", base_url: "https://api.ashbyhq.com/posting-api/job-board/lemonade?includeCompensation=true" },
  { id: "ab-multiverse", name: "Multiverse (Ashby)", source_type: "ashby", company_handle: "multiverse", base_url: "https://api.ashbyhq.com/posting-api/job-board/multiverse?includeCompensation=true" },
  { id: "ab-1password", name: "1Password (Ashby)", source_type: "ashby", company_handle: "1password", base_url: "https://api.ashbyhq.com/posting-api/job-board/1password?includeCompensation=true" },
  { id: "ab-benchling", name: "Benchling (Ashby)", source_type: "ashby", company_handle: "benchling", base_url: "https://api.ashbyhq.com/posting-api/job-board/benchling?includeCompensation=true" },
  { id: "ab-watershed", name: "Watershed (Ashby)", source_type: "ashby", company_handle: "watershed", base_url: "https://api.ashbyhq.com/posting-api/job-board/watershed?includeCompensation=true" },
  { id: "ab-wealthsimple", name: "Wealthsimple (Ashby)", source_type: "ashby", company_handle: "wealthsimple", base_url: "https://api.ashbyhq.com/posting-api/job-board/wealthsimple?includeCompensation=true" },
  { id: "ab-patreon", name: "Patreon (Ashby)", source_type: "ashby", company_handle: "patreon", base_url: "https://api.ashbyhq.com/posting-api/job-board/patreon?includeCompensation=true" },
  { id: "ab-pennylane", name: "Pennylane (Ashby)", source_type: "ashby", company_handle: "pennylane", base_url: "https://api.ashbyhq.com/posting-api/job-board/pennylane?includeCompensation=true" },
  { id: "ab-homebase", name: "Homebase (Ashby)", source_type: "ashby", company_handle: "homebase", base_url: "https://api.ashbyhq.com/posting-api/job-board/homebase?includeCompensation=true" },
  { id: "ab-hinge-health", name: "Hinge Health (Ashby)", source_type: "ashby", company_handle: "hinge-health", base_url: "https://api.ashbyhq.com/posting-api/job-board/hinge-health?includeCompensation=true" },
  { id: "ab-poshmark", name: "Poshmark (Ashby)", source_type: "ashby", company_handle: "poshmark", base_url: "https://api.ashbyhq.com/posting-api/job-board/poshmark?includeCompensation=true" },
  { id: "ab-brigit", name: "Brigit (Ashby)", source_type: "ashby", company_handle: "brigit", base_url: "https://api.ashbyhq.com/posting-api/job-board/brigit?includeCompensation=true" },
  { id: "ab-acorns", name: "Acorns (Ashby)", source_type: "ashby", company_handle: "acorns", base_url: "https://api.ashbyhq.com/posting-api/job-board/acorns?includeCompensation=true" },
  // Recruitee — public board API: https://{handle}.recruitee.com/api/offers
  // Strong in Europe (Netherlands, Germany, UK). Covers tech and non-tech roles.
  { id: "rt-miro", name: "Miro (Recruitee)", source_type: "recruitee", company_handle: "miro", base_url: "https://miro.recruitee.com/api/offers" },
  { id: "rt-pitch", name: "Pitch (Recruitee)", source_type: "recruitee", company_handle: "pitch", base_url: "https://pitch.recruitee.com/api/offers" },
  { id: "rt-remote", name: "Remote.com (Recruitee)", source_type: "recruitee", company_handle: "remote", base_url: "https://remote.recruitee.com/api/offers" },
  { id: "rt-gitguardian", name: "GitGuardian (Recruitee)", source_type: "recruitee", company_handle: "gitguardian", base_url: "https://gitguardian.recruitee.com/api/offers" },
  { id: "rt-liqtech", name: "LiqTech (Recruitee)", source_type: "recruitee", company_handle: "liqtech", base_url: "https://liqtech.recruitee.com/api/offers" },
  // Workable — public widget API: https://apply.workable.com/api/v1/widget/accounts/{handle}
  // Note: descriptions are not available from the public widget endpoint (see workable.ts).
  { id: "wb-vimeo", name: "Vimeo (Workable)", source_type: "workable", company_handle: "vimeo", base_url: "https://apply.workable.com/api/v1/widget/accounts/vimeo" },
  { id: "wb-papayaglobal", name: "Papaya Global (Workable)", source_type: "workable", company_handle: "papayaglobal", base_url: "https://apply.workable.com/api/v1/widget/accounts/papayaglobal" },
  { id: "wb-karbon", name: "Karbon (Workable)", source_type: "workable", company_handle: "karbon", base_url: "https://apply.workable.com/api/v1/widget/accounts/karbon" },
  { id: "wb-sentry", name: "Sentry (Workable)", source_type: "workable", company_handle: "sentry", base_url: "https://apply.workable.com/api/v1/widget/accounts/sentry" },
  { id: "wb-taxfix", name: "Taxfix (Workable)", source_type: "workable", company_handle: "taxfix", base_url: "https://apply.workable.com/api/v1/widget/accounts/taxfix" },
  // Personio — public XML feed: https://{handle}.jobs.personio.de/xml
  // Dominant in DACH (Germany, Austria, Switzerland). Broad industry coverage.
  { id: "ps-personio", name: "Personio (Personio)", source_type: "personio", company_handle: "personio", base_url: "https://personio.jobs.personio.de/xml" },
  { id: "ps-n26", name: "N26 (Personio)", source_type: "personio", company_handle: "n26", base_url: "https://n26.jobs.personio.de/xml" },
  { id: "ps-egym", name: "EGYM (Personio)", source_type: "personio", company_handle: "egym", base_url: "https://egym.jobs.personio.de/xml" },
  { id: "ps-flatpay", name: "Flatpay (Personio)", source_type: "personio", company_handle: "flatpay", base_url: "https://flatpay.jobs.personio.de/xml" },
  { id: "ps-1komma5", name: "1Komma5\xB0 (Personio)", source_type: "personio", company_handle: "1komma5grad", base_url: "https://1komma5grad.jobs.personio.de/xml" },
  // Pinpoint — public postings API: https://{handle}.pinpointhq.com/postings.json
  // Covers hospitality, nonprofits, professional services, and tech globally.
  { id: "pp-sunking", name: "Sun King (Pinpoint)", source_type: "pinpoint", company_handle: "sunking", base_url: "https://sunking.pinpointhq.com/postings.json" },
  { id: "pp-dazn", name: "DAZN (Pinpoint)", source_type: "pinpoint", company_handle: "dazn", base_url: "https://dazn.pinpointhq.com/postings.json" },
  { id: "pp-tabby", name: "Tabby (Pinpoint)", source_type: "pinpoint", company_handle: "tabby", base_url: "https://tabby.pinpointhq.com/postings.json" },
  { id: "pp-kempinski", name: "Kempinski Hotels (Pinpoint)", source_type: "pinpoint", company_handle: "kempinski", base_url: "https://kempinski.pinpointhq.com/postings.json" },
  { id: "pp-trilon", name: "Trilon Group (Pinpoint)", source_type: "pinpoint", company_handle: "trilon", base_url: "https://trilon.pinpointhq.com/postings.json" },
  // Workday — major US retailers and healthcare employers
  // These cover cashiers, store associates, pharmacy techs, warehouse, and delivery workers.
  // The base_url encodes the undocumented but public CXS API used by Workday's own frontend.
  { id: "wd-target", name: "Target", source_type: "workday", company_handle: "target", base_url: "https://target.wd5.myworkdayjobs.com/wday/cxs/target/targetcareers/jobs" },
  { id: "wd-homedepot", name: "Home Depot", source_type: "workday", company_handle: "homedepot", base_url: "https://homedepot.wd5.myworkdayjobs.com/wday/cxs/homedepot/CareerDepot/jobs" },
  { id: "wd-cvs", name: "CVS Health", source_type: "workday", company_handle: "cvshealth", base_url: "https://cvshealth.wd1.myworkdayjobs.com/wday/cxs/cvshealth/CVS_Health_Careers/jobs" },
  // SmartRecruiters — food service, security, facility services
  // These are some of the largest hourly employers in the US by headcount.
  { id: "sr-dominos", name: "Dominos Pizza", source_type: "smartrecruiters", company_handle: "dominos", base_url: "https://api.smartrecruiters.com/v1/companies/dominos/postings" },
  { id: "sr-securitas", name: "Securitas", source_type: "smartrecruiters", company_handle: "securitas", base_url: "https://api.smartrecruiters.com/v1/companies/securitas/postings" },
  { id: "sr-sodexo", name: "Sodexo", source_type: "smartrecruiters", company_handle: "sodexo", base_url: "https://api.smartrecruiters.com/v1/companies/sodexo/postings" },
  // Amazon — direct company careers API (unauthenticated public JSON search)
  // Covers warehouse, delivery, retail, AWS, and corporate roles globally.
  // Single source entry covers all Amazon jobs.
  { id: "amz-global", name: "Amazon", source_type: "amazon", company_handle: "amazon", base_url: "https://www.amazon.jobs/en/search.json" },
  // Apple — direct company careers API (unauthenticated public JSON via POST)
  // Covers Apple Retail, AppleCare, corporate, and engineering roles globally.
  // Single source entry covers all Apple jobs.
  { id: "apl-global", name: "Apple", source_type: "apple", company_handle: "apple", base_url: "https://jobs.apple.com/api/role/search" }
];
async function seedSources(db) {
  const now = Math.floor(Date.now() / 1e3);
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO sources
       (id, name, source_type, company_handle, base_url, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`
  );
  const batch = SEED_SOURCES.map(
    (s) => stmt.bind(s.id, s.name, s.source_type, s.company_handle, s.base_url, now)
  );
  await db.batch(batch);
}
__name(seedSources, "seedSources");

// src/index.ts
var JOB_ID_PATTERN = /^\/jobs\/([^/]+)$/;
async function handleRequest(request, env2, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";
  const method = request.method;
  if (method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "86400"
      }
    });
  }
  if (path === "/health" && method === "GET") {
    return jsonOk({ status: "ok", version: "1.0.0" });
  }
  if (path === "/stats" && method === "GET") {
    return handleGetStats(request, env2, ctx);
  }
  if (path === "/jobs" && method === "GET") {
    return handleListJobs(request, env2, ctx);
  }
  const jobMatch = path.match(JOB_ID_PATTERN);
  if (jobMatch && method === "GET") {
    return handleGetJob(request, env2, ctx, jobMatch[1]);
  }
  if (path === "/jobs" || path === "/stats" || jobMatch) {
    return Errors.methodNotAllowed();
  }
  return Errors.notFound("Endpoint");
}
__name(handleRequest, "handleRequest");
var src_default = {
  /**
   * HTTP request handler.
   */
  async fetch(request, env2, ctx) {
    try {
      return await handleRequest(request, env2, ctx);
    } catch (err) {
      logger.error("unhandled_request_error", { error: String(err) });
      return Errors.internal();
    }
  },
  /**
   * Scheduled cron handler — runs every hour (cron: "0 * * * *").
   *
   * On first run we seed the sources table so the cron has records to process.
   * seedSources uses INSERT OR IGNORE so re-running is always safe.
   */
  async scheduled(_event, env2, ctx) {
    ctx.waitUntil(
      (async () => {
        try {
          await seedSources(env2.JOBS_DB);
          await runIngestion(env2);
        } catch (err) {
          logger.error("scheduled_handler_failed", { error: String(err) });
        }
      })()
    );
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env2, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env2);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-scheduled.ts
var scheduled = /* @__PURE__ */ __name(async (request, env2, _ctx, middlewareCtx) => {
  const url = new URL(request.url);
  if (url.pathname === "/__scheduled") {
    const cron = url.searchParams.get("cron") ?? "";
    await middlewareCtx.dispatch("scheduled", { cron });
    return new Response("Ran scheduled event");
  }
  const resp = await middlewareCtx.next(request, env2);
  if (request.headers.get("referer")?.endsWith("/__scheduled") && url.pathname === "/favicon.ico" && resp.status === 500) {
    return new Response(null, { status: 404 });
  }
  return resp;
}, "scheduled");
var middleware_scheduled_default = scheduled;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError2 = /* @__PURE__ */ __name(async (request, env2, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env2);
  } catch (e) {
    const error3 = reduceError(e);
    return Response.json(error3, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError2;

// .wrangler/tmp/bundle-nYB7OU/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_scheduled_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env2, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env2, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env2, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env2, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-nYB7OU/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env2, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env2, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env2, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env2, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env2, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env2, ctx) => {
      this.env = env2;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
