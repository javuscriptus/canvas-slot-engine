import { Container, Graphics } from "pixi.js";

export class GraphicsController extends Container {
  constructor(app, reelsController) {
    super();
    this.app = app;
    this.reelsController = reelsController;
    this.lineGraphics = new Graphics();
    this.boxGraphics = new Graphics();
    this.addChild(this.lineGraphics);
    this.addChild(this.boxGraphics);

    this.paylinePatterns = [
      [1, 1, 1, 1, 1],
      [0, 0, 0, 0, 0],
      [2, 2, 2, 2, 2],
      [0, 1, 2, 1, 0],
      [2, 1, 0, 1, 2]
    ];

    this.activeWins = [];
    this.currentWinIndex = -1;
    this.cycleTimer = 0;
    this.pulseTimer = 0;
  }

  showWins(wins) {
    this.clear();
    this.activeWins = wins;
    if (wins.length === 0) return;

    this.currentWinIndex = 0;
    this.cycleTimer = 0;
    this.pulseTimer = 0;

    this.drawAllWinsSummary();
  }

  clear() {
    this.lineGraphics.clear();
    this.boxGraphics.clear();
    this.activeWins = [];
    this.currentWinIndex = -1;
  }

  drawAllWinsSummary() {
    this.lineGraphics.clear();
    this.boxGraphics.clear();

    const color = 0xffea00;

    this.activeWins.forEach((win) => {
      if (win.lineIndex === -1) {
        win.coords.forEach((coord) => {
          const coords = this.reelsController.getSymbolGlobalCoords(coord.col, coord.row);
          this.boxGraphics.rect(coords.x - 60, coords.y - 60, 120, 120);
          this.boxGraphics.stroke({ width: 3, color, alpha: 0.8 });
        });
      } else {
        const pattern = this.paylinePatterns[win.lineIndex];
        this.lineGraphics.moveTo(
          this.reelsController.getSymbolGlobalCoords(0, pattern[0]).x,
          this.reelsController.getSymbolGlobalCoords(0, pattern[0]).y
        );

        for (let col = 1; col < 5; col++) {
          const coords = this.reelsController.getSymbolGlobalCoords(col, pattern[col]);
          this.lineGraphics.lineTo(coords.x, coords.y);
        }

        this.lineGraphics.stroke({ width: 3, color, alpha: 0.8 });

        for (let col = 0; col < win.count; col++) {
          const row = pattern[col];
          const coords = this.reelsController.getSymbolGlobalCoords(col, row);

          this.boxGraphics.rect(coords.x - 60, coords.y - 60, 120, 120);
          this.boxGraphics.stroke({ width: 3, color, alpha: 0.9 });
        }
      }
    });
  }

  drawSingleWin(win, pulseValue) {
    this.lineGraphics.clear();
    this.boxGraphics.clear();

    const color = 0xffea00;

    if (win.lineIndex === -1) {
      win.coords.forEach((coord) => {
        const coords = this.reelsController.getSymbolGlobalCoords(coord.col, coord.row);
        const boxSize = 120 + Math.sin(pulseValue) * 6;
        this.boxGraphics.rect(coords.x - boxSize / 2, coords.y - boxSize / 2, boxSize, boxSize);
        this.boxGraphics.stroke({ width: 4, color, alpha: 0.9 });
      });
    } else {
      const pattern = this.paylinePatterns[win.lineIndex];
      const firstCoords = this.reelsController.getSymbolGlobalCoords(0, pattern[0]);
      this.lineGraphics.moveTo(firstCoords.x, firstCoords.y);

      for (let col = 1; col < 5; col++) {
        const coords = this.reelsController.getSymbolGlobalCoords(col, pattern[col]);
        this.lineGraphics.lineTo(coords.x, coords.y);
      }

      this.lineGraphics.stroke({ width: 4, color, alpha: 0.9 });

      for (let col = 0; col < win.count; col++) {
        const row = pattern[col];
        const coords = this.reelsController.getSymbolGlobalCoords(col, row);

        const boxSize = 120 + Math.sin(pulseValue) * 6;
        this.boxGraphics.rect(coords.x - boxSize / 2, coords.y - boxSize / 2, boxSize, boxSize);
        this.boxGraphics.stroke({ width: 4, color, alpha: 0.9 });
      }
    }
  }

  update(ticker) {
    if (this.activeWins.length <= 1) {
      if (this.activeWins.length === 1) {
        this.pulseTimer += 0.12 * ticker.deltaTime;
        this.drawSingleWin(this.activeWins[0], this.pulseTimer);
      }
      return;
    }

    this.pulseTimer += 0.15 * ticker.deltaTime;
    this.cycleTimer += 16.6 * ticker.deltaTime;

    if (this.cycleTimer >= 1500) {
      this.cycleTimer = 0;
      this.currentWinIndex = (this.currentWinIndex + 1) % this.activeWins.length;
    }

    if (this.currentWinIndex !== -1) {
      const win = this.activeWins[this.currentWinIndex];
      this.drawSingleWin(win, this.pulseTimer);
    }
  }
}
