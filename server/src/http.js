// Минимальный HTTP-слой поверх node:http: маршрутизация, разбор JSON,
// CORS, отдача статики. Внешних зависимостей нет намеренно — у игрового
// сервера, который держит деньги, каждая транзитивная зависимость это риск.

"use strict";

const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const { pipeline } = require("node:stream/promises");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webm": "audio/webm",
  ".mp3": "audio/mpeg",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8"
};

const COMPRESSIBLE = new Set([".html", ".js", ".mjs", ".css", ".json", ".svg", ".map"]);
const MAX_BODY = 256 * 1024;

class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler) {
    this.routes.push({ method, pattern, handler });
    return this;
  }

  get(p, h) { return this.add("GET", p, h); }
  post(p, h) { return this.add("POST", p, h); }

  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      if (r.pattern === pathname) return { handler: r.handler, params: {} };
      if (r.pattern instanceof RegExp) {
        const m = pathname.match(r.pattern);
        if (m) return { handler: r.handler, params: m.groups || {} };
      }
    }
    return null;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, "PAYLOAD_TOO_LARGE", "Тело запроса слишком большое"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      let parsed;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return reject(new HttpError(400, "BAD_JSON", "Некорректный JSON"));
      }
      // Тело обязано быть объектом. Массив или строка на его месте — это
      // не «другой формат», а попытка проскочить проверки полей: ctx.body[0]
      // и ctx.body.bet ведут себя по-разному, и обработчику про это знать
      // незачем.
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return reject(new HttpError(400, "BAD_JSON", "Тело запроса должно быть объектом"));
      }
      resolve(parsed);
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...extraHeaders
  });
  res.end(body);
}

/* ───────────────────────────── статика ──────────────────────────── */

function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const target = path.normalize(path.join(root, decoded));
  // Защита от выхода за пределы каталога через ../
  if (!target.startsWith(path.normalize(root))) return null;
  return target;
}

async function serveStatic(req, res, root) {
  let filePath = safeJoin(root, req.url);
  if (!filePath) {
    sendJson(res, 403, { error: "FORBIDDEN" });
    return true;
  }

  let stat;
  try {
    stat = await fsp.stat(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, "index.html");
      stat = await fsp.stat(filePath);
    }
  } catch {
    return false;
  }

  const ext = path.extname(filePath).toLowerCase();
  const etag = `W/"${stat.size}-${stat.mtimeMs.toString(36)}"`;

  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304).end();
    return true;
  }

  // Ассеты с контентным именем можно кешировать надолго,
  // точку входа — нет, иначе игроки застрянут на старой версии.
  const immutable = /\/assets\//.test(filePath) && ext !== ".json";
  const headers = {
    "Content-Type": MIME[ext] || "application/octet-stream",
    ETag: etag,
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    "X-Content-Type-Options": "nosniff"
  };

  const acceptsGzip = /\bgzip\b/.test(req.headers["accept-encoding"] || "");
  if (acceptsGzip && COMPRESSIBLE.has(ext) && stat.size > 1024) {
    headers["Content-Encoding"] = "gzip";
    headers.Vary = "Accept-Encoding";
    res.writeHead(200, headers);
    await pipeline(fs.createReadStream(filePath), zlib.createGzip({ level: 6 }), res);
    return true;
  }

  headers["Content-Length"] = stat.size;
  res.writeHead(200, headers);
  await pipeline(fs.createReadStream(filePath), res);
  return true;
}

/* ────────────────────── заголовки безопасности ──────────────────── */

// Хост из заголовка Host подставляется в CSP, поэтому в нём не должно быть
// ничего, кроме имени и порта: перевод строки в значении заголовка — это
// инъекция заголовка, а пробел — лишний источник в списке разрешённых.
const SAFE_HOST = /^[A-Za-z0-9.\-:[\]]{1,255}$/;

/**
 * Разрешённые адреса для fetch и WebSocket.
 *
 * 'self' в connect-src по спецификации покрывает и ws/wss того же
 * происхождения, но не во всех браузерах, а сокет — обязательная часть
 * поставки. Поэтому свой же адрес выписывается явно; чужие адреса сюда
 * попадают только из конфигурации оператора.
 */
function connectSources(req, config, secure) {
  const out = ["'self'"];
  const host = req.headers.host;
  if (host && SAFE_HOST.test(host)) {
    out.push(`${secure ? "wss" : "ws"}://${host}`);
  }
  for (const extra of config.http.cspConnect) out.push(extra);
  return out.join(" ");
}

/**
 * Строгий CSP без 'unsafe-inline' и 'unsafe-eval'.
 *
 * Клиент под него подходит по построению: игра рисуется в canvas, разметка
 * оболочки статична, стили лежат в styles.css, а весь код — нативные
 * ES-модули с диска. Инлайновых обработчиков и eval в клиенте нет, и это
 * проверяется тестом: строгий CSP, выданный «на будущее», сломался бы
 * молча — консольная ошибка в iframe оператора никому не видна.
 */
function securityHeaders(req, config, secure) {
  const ancestors = config.http.frameAncestors;
  const csp = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    // data: нужен только под встроенные в CSS маркеры-иконки; внешних
    // источников картинок у игры нет.
    "img-src 'self' data:",
    "font-src 'self'",
    "media-src 'self'",
    `connect-src ${connectSources(req, config, secure)}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    // Игра сама ничего не встраивает, но с этого же origin отдаётся
    // демо-лобби, которое открывает игру в iframe. Без frame-src оно
    // упирается в default-src 'none' и показывает пустой прямоугольник.
    "frame-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
    // Игра ЖИВЁТ в iframe лобби оператора — это стандартный способ
    // поставки контента. X-Frame-Options: SAMEORIGIN такое встраивание
    // полностью запрещает, поэтому список доменов задаётся здесь.
    // Пустой список означает «встраивание запрещено».
    `frame-ancestors ${ancestors.length ? ancestors.join(" ") : "'none'"}`
  ];

  const headers = {
    "Content-Security-Policy": csp.join("; "),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    // Наклон устройства нужен параллаксу сцены, остальное игре не нужно
    // вообще — и не должно быть доступно чужому коду, если он туда попадёт.
    "Permissions-Policy":
      "accelerometer=(self), gyroscope=(self), magnetometer=(self), fullscreen=(self), " +
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), midi=(), " +
      "display-capture=(), serial=(), bluetooth=()"
  };

  if (!ancestors.length) headers["X-Frame-Options"] = "DENY";
  // HSTS имеет смысл только на HTTPS: по HTTP браузер его игнорирует,
  // а на localhost он ещё и мешает разработке.
  if (secure) headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";

  return headers;
}

/* ────────────────────────────── сервер ──────────────────────────── */

function createServer({ router, config, onError, limiter }) {
  const server = http.createServer(async (req, res) => {
    const started = process.hrtime.bigint();
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    const forwardedProto = config.http.trustProxy
      ? String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim()
      : "";
    const secure = !!req.socket.encrypted || forwardedProto === "https";
    const ip = config.http.trustProxy
      ? (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress
      : req.socket.remoteAddress;

    // CORS
    const origin = req.headers.origin;
    if (origin && config.http.corsOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,Authorization,Idempotency-Key",
        "Access-Control-Max-Age": "86400"
      });
      return res.end();
    }

    for (const [name, value] of Object.entries(securityHeaders(req, config, secure))) {
      res.setHeader(name, value);
    }

    try {
      // Общий лимит по адресу — до маршрутизации и до разбора тела.
      // Он не привязан ни к сессии, ни к игроку, поэтому его нельзя
      // сбросить, открыв новую сессию.
      if (limiter && url.pathname.startsWith("/api/")) {
        const hit = limiter.hit(`ip:${ip}`, config.limits.apiPerMinutePerIp);
        if (!hit.allowed) {
          res.setHeader("Retry-After", Math.ceil(hit.retryAfterMs / 1000));
          throw new HttpError(429, "RATE_LIMITED", "Слишком часто. Подождите немного");
        }
      }

      const route = router.match(req.method, url.pathname);
      if (route) {
        const body = req.method === "POST" ? await readBody(req) : {};
        const ctx = {
          req, res, url, body,
          params: route.params,
          query: url.searchParams,
          ip,
          secure,
          userAgent: (req.headers["user-agent"] || "").slice(0, 300),
          auth: (req.headers.authorization || "").replace(/^Bearer\s+/i, "")
        };
        const result = await route.handler(ctx);
        if (!res.writableEnded) {
          // Обработчик может вернуть либо данные как есть, либо конверт
          // { __status, __body }. Отдельные поля-имена нужны потому, что
          // у полезной нагрузки бывает своё поле status (как у /healthz).
          const isEnvelope = result && typeof result === "object" && "__status" in result;
          sendJson(res, isEnvelope ? result.__status : 200, isEnvelope ? result.__body : (result ?? {}));
        }
        return;
      }

      if (config.http.serveStatic) {
        if (await serveStatic(req, res, config.http.staticDir)) return;
        // SPA-фолбэк: любой неизвестный путь отдаёт точку входа.
        if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
          req.url = "/index.html";
          if (await serveStatic(req, res, config.http.staticDir)) return;
        }
      }

      sendJson(res, 404, { error: "NOT_FOUND" });
    } catch (err) {
      const status = err.status || 500;
      // Наружу уходит только то, что мы написали сами. Сообщение
      // неожиданного исключения — это путь к файлу, кусок SQL или имя
      // внутреннего поля; по нему удобно изучать сервер снаружи.
      // Клиенту достаётся ссылка на запись в логе, а не подробности.
      const authored = err instanceof HttpError;
      const ref = authored ? null : crypto.randomBytes(6).toString("hex");
      if (status >= 500 && onError) onError(err, req, ref);
      if (res.writableEnded) return;
      sendJson(res, status, {
        error: authored ? err.code : "INTERNAL_ERROR",
        message: authored ? err.message : "Внутренняя ошибка",
        ...(ref ? { ref } : {})
      });
    } finally {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      if (ms > 250) {
        console.warn(`[slow] ${req.method} ${url.pathname} — ${ms.toFixed(0)} мс`);
      }
    }
  });

  server.keepAliveTimeout = 65000;
  server.headersTimeout = 70000;
  return server;
}

module.exports = { Router, createServer, sendJson, readBody, HttpError };
