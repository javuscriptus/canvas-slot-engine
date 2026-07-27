// Канал server → client.
//
// Здесь принципиально НЕТ игровых действий. Спин уходит по HTTP и там же
// возвращается: это денежная операция, ей нужны идемпотентность и понятный
// повтор после обрыва. Сокет доставляет только то, что инициирует сервер:
// изменение баланса вне игры, закрытие сессии оператором, режим
// обслуживания, промо и напоминания об ответственной игре.
//
// Поэтому обрыв сокета не ломает игру — она продолжает работать на HTTP,
// просто временно не получает уведомлений.

import { Signal } from "../../engine/core.js";

const MAX_BACKOFF = 20000;

export class GameSocket {
  /**
   * @param opts.getTicket — async () => { ticket, path? }. Тикет одноразовый
   *   и живёт секунды, поэтому запрашивается перед КАЖДЫМ подключением,
   *   включая реконнекты. Токен сессии в URL не попадает никогда: адрес
   *   апгрейда оседает в access-логах прокси.
   */
  constructor({ url = null, path = "/ws", getTicket = null } = {}) {
    this.path = path;
    this.explicitUrl = url;
    this.getTicket = getTicket;
    this.ws = null;
    this.connected = false;
    this.enabled = true;

    this.onEvent = new Signal();          // (type, payload)
    this.onConnectionChange = new Signal(); // (connected)

    this._attempt = 0;
    this._reconnectTimer = null;
    this._heartbeatTimer = null;
    this._closedByUs = false;
    this._opening = false;
  }

  _url(ticket) {
    const q = `?ticket=${encodeURIComponent(ticket)}`;
    if (this.explicitUrl) return this.explicitUrl + q;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}${this.path}${q}`;
  }

  connect(getTicket = this.getTicket) {
    this.getTicket = getTicket;
    this._closedByUs = false;
    this._open();
  }

  async _open() {
    if (!this.enabled || !this.getTicket || this._opening) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;

    this._opening = true;
    let ticket;
    try {
      const issued = await this.getTicket();
      ticket = issued?.ticket;
      if (issued?.path) this.path = issued.path;
    } catch {
      // Сервер не выдал тикет — сеть или сессия. Игра при этом продолжает
      // работать на HTTP, поэтому просто пробуем позже.
    }

    // За время запроса игру могли закрыть или поставить на паузу.
    if (!ticket || this._closedByUs || !this.enabled) {
      this._opening = false;
      if (!this._closedByUs && this.enabled) this._scheduleReconnect();
      return;
    }

    let ws;
    try {
      ws = new WebSocket(this._url(ticket));
    } catch {
      this._opening = false;
      this._scheduleReconnect();
      return;
    }
    this._opening = false;
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      this._attempt = 0;
      this.onConnectionChange.emit(true);
      this._startHeartbeat();
    };

    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (!msg || !msg.type) return;
      if (msg.type === "pong" || msg.type === "hello") return;
      this.onEvent.emit(msg.type, msg);
    };

    ws.onclose = (e) => {
      this._stopHeartbeat();
      if (this.connected) {
        this.connected = false;
        this.onConnectionChange.emit(false);
      }
      // 4001 — сессию закрыл оператор; переподключаться бессмысленно.
      if (this._closedByUs || e.code === 4001) return;
      this._scheduleReconnect();
    };

    ws.onerror = () => {
      // Сообщение об ошибке придёт следом в onclose — там и переподключимся.
    };
  }

  /**
   * Переподключение с экспоненциальной паузой и случайным разбросом.
   * Разброс обязателен: без него после падения сервера все клиенты
   * возвращаются одновременно и роняют его повторно.
   */
  _scheduleReconnect() {
    clearTimeout(this._reconnectTimer);
    const base = Math.min(MAX_BACKOFF, 800 * Math.pow(1.7, this._attempt++));
    const delay = base * (0.7 + Math.random() * 0.6);
    this._reconnectTimer = setTimeout(() => this._open(), delay);
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    // Собственный пинг поверх протокольного: некоторые прокси считают
    // управляющие кадры «тишиной» и всё равно рвут соединение.
    this._heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 20000);
  }

  _stopHeartbeat() {
    clearInterval(this._heartbeatTimer);
    this._heartbeatTimer = null;
  }

  close() {
    this._closedByUs = true;
    this._opening = false;
    clearTimeout(this._reconnectTimer);
    this._stopHeartbeat();
    try { this.ws?.close(1000, "bye"); } catch { /* уже закрыт */ }
    this.ws = null;
    this.connected = false;
  }
}
