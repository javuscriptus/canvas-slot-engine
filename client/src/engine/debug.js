// Панель диагностики: цифры, по которым разбираются жалобы на «мигание».
//
// Нужна прежде всего затем, чтобы отличить настоящий провал кадров от
// бесконечного цикла изменения размера: последний выглядит для игрока
// точно так же — картинка дёргается, — но чинится совершенно иначе.
// Поэтому здесь считаются не только fps, но и число реальных вызовов
// отрисовки и число событий resize за секунду.
//
// Живёт в движке, а не в точке входа: измеряются подсистемы движка,
// и второй игре на нём эта панель понадобится ровно такой же.

/**
 * @param opts.renderer  рендер, за которым следим
 * @param opts.ticker    тикер — источник fps
 * @param opts.status    () => строка состояния игры; движок про раунды
 *                       не знает, поэтому подпись приходит снаружи
 * @returns функция отключения
 */
export function attachDebugOverlay({ renderer, ticker, status = () => "" }) {
  const el = document.createElement("div");
  el.style.cssText = `position:fixed;left:8px;top:8px;z-index:99;padding:8px 12px;
    background:rgba(0,0,0,.72);color:#8CFFB0;font:12px/1.5 monospace;
    border-radius:8px;pointer-events:none;white-space:pre`;
  document.body.appendChild(el);

  let renders = 0;
  let resizes = 0;
  const origRender = renderer.render.bind(renderer);
  renderer.render = () => { renders++; return origRender(); };
  const offResize = renderer.onResize.add(() => resizes++);

  const timer = setInterval(() => {
    el.textContent =
      `fps        ${Math.round(ticker.fps)}\n` +
      `отрисовок  ${renders}/с\n` +
      `resize     ${resizes}/с  ${resizes > 2 ? "← ЦИКЛ!" : ""}\n` +
      `dpr        ${renderer.dpr}  scale ${renderer.scale.toFixed(3)}\n` +
      `холст      ${renderer.canvas.width}×${renderer.canvas.height}\n` +
      `draw calls ${renderer.drawCalls}  отсечено ${renderer.culled}\n` +
      `текстур    ${renderer.textures.map.size} / ` +
        `${(renderer.textures.bytes / 1048576).toFixed(1)} МБ\n` +
      `состояние  ${status()}`;
    renders = 0;
    resizes = 0;
  }, 1000);

  return () => {
    clearInterval(timer);
    offResize();
    renderer.render = origRender;
    el.remove();
  };
}
