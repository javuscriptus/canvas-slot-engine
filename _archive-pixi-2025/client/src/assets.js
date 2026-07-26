import { Graphics, Rectangle } from "pixi.js";

export function generateTextures(app) {
  const textures = {};
  const symbolSize = 120;

  for (let id = 0; id < 8; id++) {
    const g = new Graphics();
    g.rect(0, 0, symbolSize, symbolSize);
    g.fill({ color: 0x4a157d, alpha: 0.1 });
    g.stroke({ width: 1, color: 0x8a2be2, alpha: 0.2 });

    switch (id) {
      case 0:
        g.circle(symbolSize / 2, symbolSize / 2 + 5, 28);
        g.fill({ color: 0xffe4e1 });
        g.stroke({ width: 2, color: 0xd3d3d3 });

        g.circle(symbolSize / 2 - 10, symbolSize / 2, 3);
        g.fill({ color: 0x000000 });
        g.circle(symbolSize / 2 + 10, symbolSize / 2, 3);
        g.fill({ color: 0x000000 });

        g.arc(symbolSize / 2, symbolSize / 2 + 8, 12, 0, Math.PI);
        g.stroke({ width: 3, color: 0xff0055 });

        g.moveTo(symbolSize / 2 - 25, symbolSize / 2 - 12);
        g.quadraticCurveTo(symbolSize / 2 - 45, symbolSize / 2 - 45, symbolSize / 2 - 15, symbolSize / 2 - 30);
        g.quadraticCurveTo(symbolSize / 2, symbolSize / 2 - 15, symbolSize / 2 + 15, symbolSize / 2 - 30);
        g.quadraticCurveTo(symbolSize / 2 + 45, symbolSize / 2 - 45, symbolSize / 2 + 25, symbolSize / 2 - 12);
        g.closePath();
        g.fill({ color: 0xff007f });

        g.moveTo(symbolSize / 2 - 18, symbolSize / 2 - 22);
        g.quadraticCurveTo(symbolSize / 2, symbolSize / 2 - 50, symbolSize / 2 + 18, symbolSize / 2 - 22);
        g.quadraticCurveTo(symbolSize / 2, symbolSize / 2 - 15, symbolSize / 2 - 18, symbolSize / 2 - 22);
        g.closePath();
        g.fill({ color: 0xffd700 });

        g.moveTo(symbolSize / 2 - 25, symbolSize / 2 - 12);
        g.quadraticCurveTo(symbolSize / 2 - 5, symbolSize / 2 - 22, symbolSize / 2, symbolSize / 2 - 22);
        g.quadraticCurveTo(symbolSize / 2 + 5, symbolSize / 2 - 22, symbolSize / 2 + 25, symbolSize / 2 - 12);
        g.quadraticCurveTo(symbolSize / 2, symbolSize / 2 + 5, symbolSize / 2 - 25, symbolSize / 2 - 12);
        g.closePath();
        g.fill({ color: 0x00bfff });

        g.circle(symbolSize / 2 - 32, symbolSize / 2 - 25, 6);
        g.fill({ color: 0xffd700 });
        g.stroke({ width: 1, color: 0xffffff });

        g.circle(symbolSize / 2, symbolSize / 2 - 42, 6);
        g.fill({ color: 0xffd700 });
        g.stroke({ width: 1, color: 0xffffff });

        g.circle(symbolSize / 2 + 32, symbolSize / 2 - 25, 6);
        g.fill({ color: 0xffd700 });
        g.stroke({ width: 1, color: 0xffffff });

        g.moveTo(symbolSize / 2 - 20, symbolSize / 2 + 30);
        g.lineTo(symbolSize / 2 - 35, symbolSize / 2 + 45);
        g.lineTo(symbolSize / 2 - 10, symbolSize / 2 + 38);
        g.lineTo(symbolSize / 2, symbolSize / 2 + 52);
        g.lineTo(symbolSize / 2 + 10, symbolSize / 2 + 38);
        g.lineTo(symbolSize / 2 + 35, symbolSize / 2 + 45);
        g.lineTo(symbolSize / 2 + 20, symbolSize / 2 + 30);
        g.closePath();
        g.fill({ color: 0xba55d3 });
        break;

      case 1:
        g.moveTo(25, 80);
        g.lineTo(95, 80);
        g.lineTo(90, 92);
        g.lineTo(30, 92);
        g.closePath();
        g.fill({ color: 0xd2691e });

        g.moveTo(28, 80);
        g.lineTo(20, 42);
        g.lineTo(40, 62);
        g.lineTo(60, 32);
        g.lineTo(80, 62);
        g.lineTo(100, 42);
        g.lineTo(92, 80);
        g.closePath();
        g.fill({ color: 0xffd700 });
        g.stroke({ width: 2, color: 0xffffff });

        g.circle(20, 42, 4);
        g.fill({ color: 0xff0000 });
        g.circle(60, 32, 5);
        g.fill({ color: 0xff0000 });
        g.circle(100, 42, 4);
        g.fill({ color: 0xff0000 });

        g.rect(20, 94, 80, 16);
        g.fill({ color: 0xcc0000 });
        g.stroke({ width: 1, color: 0xffd700 });
        break;

      case 2:
        g.ellipse(symbolSize / 2, symbolSize / 2 + 20, 24, 32);
        g.fill({ color: 0xd2691e });
        g.stroke({ width: 2, color: 0xffd700 });

        g.rect(symbolSize / 2 - 5, 20, 10, 50);
        g.fill({ color: 0x8b4513 });
        g.stroke({ width: 1, color: 0xffd700 });

        g.moveTo(symbolSize / 2 - 12, 20);
        g.lineTo(symbolSize / 2 + 12, 12);
        g.lineTo(symbolSize / 2 + 8, 8);
        g.lineTo(symbolSize / 2 - 16, 16);
        g.closePath();
        g.fill({ color: 0xffd700 });

        g.circle(symbolSize / 2, symbolSize / 2 + 8, 6);
        g.fill({ color: 0x000000 });

        g.moveTo(symbolSize / 2 - 2, 20);
        g.lineTo(symbolSize / 2 - 2, symbolSize / 2 + 8);
        g.moveTo(symbolSize / 2 + 2, 20);
        g.lineTo(symbolSize / 2 + 2, symbolSize / 2 + 8);
        g.stroke({ width: 1.5, color: 0xdddddd });
        break;

      case 3:
        g.moveTo(35, 95);
        g.lineTo(45, 95);
        g.lineTo(42, 55);
        g.lineTo(38, 55);
        g.closePath();
        g.fill({ color: 0xdddddd });

        g.ellipse(40, 45, 14, 20);
        g.fill({ color: 0xff0055 });
        g.stroke({ width: 2, color: 0xffffff });

        g.moveTo(75, 95);
        g.lineTo(85, 95);
        g.lineTo(82, 55);
        g.lineTo(78, 55);
        g.closePath();
        g.fill({ color: 0xdddddd });

        g.ellipse(80, 45, 14, 20);
        g.fill({ color: 0x00ccff });
        g.stroke({ width: 2, color: 0xffffff });

        g.moveTo(55, 100);
        g.lineTo(65, 100);
        g.lineTo(62, 60);
        g.lineTo(58, 60);
        g.closePath();
        g.fill({ color: 0xcccccc });

        g.ellipse(60, 50, 14, 20);
        g.fill({ color: 0xffcc00 });
        g.stroke({ width: 2, color: 0xffffff });
        break;

      case 4:
        g.moveTo(25, 75);
        g.quadraticCurveTo(45, 45, 75, 45);
        g.lineTo(85, 65);
        g.quadraticCurveTo(55, 65, 38, 85);
        g.closePath();
        g.fill({ color: 0xba55d3 });
        g.stroke({ width: 1.5, color: 0xff00ff });

        g.moveTo(85, 65);
        g.quadraticCurveTo(105, 75, 110, 60);
        g.quadraticCurveTo(95, 90, 75, 80);
        g.lineTo(38, 85);
        g.quadraticCurveTo(55, 65, 85, 65);
        g.closePath();
        g.fill({ color: 0xff00ff });
        g.stroke({ width: 1.5, color: 0xffffff });

        g.circle(112, 58, 4);
        g.fill({ color: 0xffd700 });
        break;

      case 5:
        g.moveTo(60, 22);
        g.lineTo(95, 60);
        g.lineTo(60, 98);
        g.lineTo(25, 60);
        g.closePath();
        g.fill({ color: 0xff0000 });
        g.stroke({ width: 3, color: 0xff9999 });

        g.moveTo(60, 22);
        g.lineTo(60, 98);
        g.moveTo(25, 60);
        g.lineTo(95, 60);
        g.stroke({ width: 1, color: 0xffcccc, alpha: 0.7 });
        break;

      case 6:
        g.moveTo(60, 24);
        g.lineTo(90, 42);
        g.lineTo(90, 78);
        g.lineTo(60, 96);
        g.lineTo(30, 78);
        g.lineTo(30, 42);
        g.closePath();
        g.fill({ color: 0x00ffff });
        g.stroke({ width: 3, color: 0xffffff });

        g.moveTo(60, 24);
        g.lineTo(60, 96);
        g.moveTo(30, 42);
        g.lineTo(90, 78);
        g.moveTo(30, 78);
        g.lineTo(90, 42);
        g.stroke({ width: 1, color: 0xe0ffff, alpha: 0.6 });
        break;

      case 7:
        g.circle(symbolSize / 2, symbolSize / 2, 34);
        g.fill({ color: 0x1e90ff });
        g.stroke({ width: 3, color: 0x00f2fe });

        g.ellipse(symbolSize / 2 - 10, symbolSize / 2 - 12, 16, 8);
        g.fill({ color: 0xffffff, alpha: 0.4 });
        break;
    }

    textures[id] = app.renderer.generateTexture({ target: g });
  }

  const btnSpin = new Graphics();
  btnSpin.circle(42, 42, 38);
  btnSpin.fill({ color: 0x111116 });
  btnSpin.stroke({ width: 4, color: 0xffea00 });

  btnSpin.arc(42, 42, 20, 0, Math.PI * 1.5);
  btnSpin.stroke({ width: 4, color: 0xffffff });
  btnSpin.moveTo(42, 14);
  btnSpin.lineTo(50, 22);
  btnSpin.lineTo(34, 22);
  btnSpin.closePath();
  btnSpin.fill({ color: 0xffffff });

  btnSpin.arc(42, 42, 20, Math.PI, Math.PI * 2.5);
  btnSpin.stroke({ width: 4, color: 0xffffff });
  btnSpin.moveTo(42, 70);
  btnSpin.lineTo(34, 62);
  btnSpin.lineTo(50, 62);
  btnSpin.closePath();
  btnSpin.fill({ color: 0xffffff });

  textures["btn_spin"] = app.renderer.generateTexture({ target: btnSpin });

  const btnNormal = new Graphics();
  btnNormal.circle(20, 20, 18);
  btnNormal.fill({ color: 0x111116 });
  btnNormal.stroke({ width: 2, color: 0xffffff, alpha: 0.8 });
  textures["btn_normal"] = app.renderer.generateTexture({ target: btnNormal });

  const btnDisabled = new Graphics();
  btnDisabled.circle(20, 20, 18);
  btnDisabled.fill({ color: 0x050508 });
  btnDisabled.stroke({ width: 2, color: 0x444444, alpha: 0.5 });
  textures["btn_disabled"] = app.renderer.generateTexture({ target: btnDisabled });

  const reelBg = new Graphics();
  reelBg.rect(0, 0, 140, 390);
  reelBg.fill({ color: 0x3d0c5a, alpha: 0.05 });
  textures["reel_bg"] = app.renderer.generateTexture({
    target: reelBg,
    bounds: new Rectangle(0, 0, 140, 390)
  });

  const gameBg = new Graphics();
  gameBg.rect(0, 0, 740, 390);
  gameBg.fill({ color: 0x3d0c5a });

  for (let xOffset = -390; xOffset < 740; xOffset += 30) {
    gameBg.moveTo(xOffset, 0);
    gameBg.lineTo(xOffset + 390, 390);
  }
  for (let xOffset = 0; xOffset < 740 + 390; xOffset += 30) {
    gameBg.moveTo(xOffset, 0);
    gameBg.lineTo(xOffset - 390, 390);
  }
  gameBg.stroke({ width: 1, color: 0x5a1884, alpha: 0.4 });
  textures["game_bg"] = app.renderer.generateTexture({
    target: gameBg,
    bounds: new Rectangle(0, 0, 740, 390)
  });

  return textures;
}
