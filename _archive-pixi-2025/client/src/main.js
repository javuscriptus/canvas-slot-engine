import { Application } from "pixi.js";
import { Game } from "./game";

async function init() {
  await document.fonts.ready;

  const app = new Application();
  await app.init({
    width: 1280,
    height: 720,
    antialias: true,
    backgroundAlpha: 1,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true
  });

  const container = document.getElementById("game-container");
  container.appendChild(app.canvas);

  const resize = () => {
    const targetWidth = 1280;
    const targetHeight = 720;
    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;

    const scale = Math.min(screenWidth / targetWidth, screenHeight / targetHeight);

    app.canvas.style.width = `${targetWidth * scale}px`;
    app.canvas.style.height = `${targetHeight * scale}px`;
  };

  window.addEventListener("resize", resize);
  resize();

  const game = new Game(app);
  await game.start();
}

init();
