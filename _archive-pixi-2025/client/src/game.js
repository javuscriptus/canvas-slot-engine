import { Container, Graphics, Text, TextStyle, Sprite, FillGradient } from "pixi.js";
import { APIClient } from "./api";
import { generateTextures } from "./assets";
import { ReelsController } from "./reels";
import { UIController } from "./ui";
import { GraphicsController } from "./graphics";

class PaytablePanel extends Container {
  constructor(app, textures) {
    super();
    this.app = app;
    this.textures = textures;
    this.sectors = {};
    this.currentBet = 10;

    this.multipliers = {
      0: { 5: 1000, 4: 200, 3: 20 },
      1: { 5: 250, 4: 50, 3: 10 },
      2: { 5: 200, 4: 40, 3: 10 },
      3: { 5: 200, 4: 40, 3: 10 },
      4: { 5: 40, 4: 10, 3: 4 },
      5: { 5: 40, 4: 10, 3: 4 },
      6: { 5: 40, 4: 8, 3: 4 },
      7: { 5: 40, 4: 8, 3: 4, 2: 1 }
    };

    this.initLayout();
  }

  initLayout() {
    const titleJoker = new Text({
      text: "Joker's",
      style: new TextStyle({
        fontFamily: "Georgia",
        fontSize: 34,
        fill: 0xff00ff,
        stroke: { color: 0xffffff, width: 2 },
        fontStyle: "italic",
        fontWeight: "bold"
      })
    });
    titleJoker.anchor.set(0.5);
    titleJoker.x = 640;
    titleJoker.y = 45;
    this.addChild(titleJoker);

    const titleJewelsGradient = new FillGradient(0, 0, 0, 44);
    titleJewelsGradient.addColorStop(0, "#ffd700");
    titleJewelsGradient.addColorStop(1, "#ffaa00");

    const titleJewels = new Text({
      text: "Jewels",
      style: new TextStyle({
        fontFamily: "Orbitron",
        fontSize: 44,
        fill: { fill: titleJewelsGradient },
        fontWeight: "900",
        stroke: { color: 0x000000, width: 4 },
        letterSpacing: 2
      })
    });
    titleJewels.anchor.set(0.5);
    titleJewels.x = 640;
    titleJewels.y = 90;
    this.addChild(titleJewels);

    const infoText = new Text({
      text: "ALL SYMBOLS PAY FROM LEFT TO RIGHT. BONUS PAYS ON ANY POSITION.",
      style: new TextStyle({
        fontFamily: "Orbitron",
        fontSize: 12,
        fontWeight: "bold",
        fill: 0xffea00,
        letterSpacing: 1
      })
    });
    infoText.anchor.set(0.5);
    infoText.x = 640;
    infoText.y = 195;
    this.addChild(infoText);

    const underLine = new Graphics();
    underLine.moveTo(100, 210);
    underLine.lineTo(1180, 210);
    underLine.stroke({ width: 2, color: 0xffea00, alpha: 0.8 });
    this.addChild(underLine);

    const coords = {
      0: { x: 30, y: 15, w: 220, h: 70 },
      1: { x: 270, y: 15, w: 220, h: 70 },
      2: { x: 790, y: 15, w: 220, h: 70 },
      3: { x: 1030, y: 15, w: 220, h: 70 },
      4: { x: 30, y: 105, w: 220, h: 70 },
      5: { x: 270, y: 105, w: 220, h: 70 },
      6: { x: 790, y: 105, w: 220, h: 70 },
      7: { x: 1030, y: 105, w: 220, h: 80 }
    };

    Object.keys(this.multipliers).forEach((id) => {
      const symId = parseInt(id);
      const pos = coords[symId];

      const sector = new Container();
      sector.x = pos.x;
      sector.y = pos.y;

      const bg = new Graphics();
      bg.roundRect(0, 0, pos.w, pos.h, 8);
      bg.fill({ color: 0x22053a, alpha: 0.6 });
      bg.stroke({ width: 1.5, color: 0x5a1884 });
      sector.addChild(bg);

      const glow = new Graphics();
      glow.roundRect(-2, -2, pos.w + 4, pos.h + 4, 10);
      glow.stroke({ width: 3, color: 0xffea00 });
      glow.visible = false;
      sector.addChild(glow);

      const preview = new Sprite(this.textures[symId]);
      preview.width = 50;
      preview.height = 50;
      preview.x = 10;
      preview.y = (pos.h - 50) / 2;
      sector.addChild(preview);

      const textContainer = new Container();
      textContainer.x = 70;
      textContainer.y = 6;
      sector.addChild(textContainer);

      this.sectors[symId] = {
        container: sector,
        glow: glow,
        textContainer: textContainer,
        height: pos.h
      };

      this.addChild(sector);
    });

    this.updateBet(this.currentBet);
  }

  updateBet(bet) {
    this.currentBet = bet;

    Object.keys(this.multipliers).forEach((id) => {
      const symId = parseInt(id);
      const sector = this.sectors[symId];
      sector.textContainer.removeChildren();

      const mults = this.multipliers[symId];
      const keys = Object.keys(mults).sort((a, b) => b - a);

      let yOffset = 0;
      if (keys.length === 4) {
        yOffset = -2;
      } else if (keys.length === 3) {
        yOffset = 5;
      }

      keys.forEach((countStr) => {
        const count = parseInt(countStr);
        const mult = mults[count];
        const winVal = bet * mult;

        const rowContainer = new Container();
        rowContainer.y = yOffset;

        const countText = new Text({
          text: `${count} - `,
          style: new TextStyle({
            fontFamily: "Orbitron",
            fontSize: 11,
            fill: 0xffea00,
            fontWeight: "bold"
          })
        });

        const valText = new Text({
          text: `€${winVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          style: new TextStyle({
            fontFamily: "Rajdhani",
            fontSize: 12,
            fill: 0xffffff,
            fontWeight: "bold"
          })
        });
        valText.x = 26;
        valText.y = -1;

        rowContainer.addChild(countText);
        rowContainer.addChild(valText);
        sector.textContainer.addChild(rowContainer);

        yOffset += 14;
      });
    });
  }

  highlightSymbol(symbolId) {
    this.clearHighlight();
    if (this.sectors[symbolId]) {
      this.sectors[symbolId].glow.visible = true;
    }
  }

  clearHighlight() {
    Object.values(this.sectors).forEach((sector) => {
      sector.glow.visible = false;
    });
  }

  update(ticker) {
    Object.values(this.sectors).forEach((sector) => {
      if (sector.glow.visible) {
        sector.glow.alpha = 0.5 + Math.sin(Date.now() * 0.015) * 0.5;
      }
    });
  }
}

export class Game {
  constructor(app) {
    this.app = app;
    this.api = new APIClient();
    this.container = new Container();
    this.app.stage.addChild(this.container);

    this.state = "initializing";
  }

  async start() {
    try {
      this.textures = generateTextures(this.app);
      const initData = await this.api.init();

      document.getElementById("progress-fill").style.width = "100%";
      setTimeout(() => {
        const loader = document.getElementById("loading-screen");
        if (loader) loader.style.opacity = "0";
        setTimeout(() => {
          if (loader) loader.style.display = "none";
        }, 500);
      }, 300);

      this.setupLayout(initData);
      this.state = "idle";
    } catch (err) {
      console.error(err);
      document.getElementById("loading-status").innerText = "CONNECTION ERROR. RECENTLY OFFLINE.";
      document.getElementById("loading-status").style.color = "#ff0055";
    }
  }

  setupLayout(initData) {
    const mainBg = new Graphics();
    mainBg.rect(0, 0, 1280, 720);
    mainBg.fill({ color: 0x1d022e });

    for (let x = 0; x < 1280; x += 40) {
      mainBg.moveTo(x, 0);
      mainBg.lineTo(x, 720);
    }
    for (let y = 0; y < 720; y += 40) {
      mainBg.moveTo(0, y);
      mainBg.lineTo(1280, y);
    }
    mainBg.stroke({ width: 1, color: 0x2e0448 });
    this.container.addChild(mainBg);

    this.paytable = new PaytablePanel(this.app, this.textures);
    this.container.addChild(this.paytable);

    const gameWidth = 740;
    const gameHeight = 390;
    const reelsX = (1280 - gameWidth) / 2;
    const reelsY = 220;

    const gameBgSprite = new Sprite(this.textures["game_bg"]);
    gameBgSprite.x = reelsX;
    gameBgSprite.y = reelsY;
    this.container.addChild(gameBgSprite);

    this.reels = new ReelsController(this.app, this.textures);
    this.reels.x = reelsX;
    this.reels.y = reelsY;
    this.container.addChild(this.reels);

    const borderLeft = new Graphics();
    borderLeft.moveTo(reelsX - 5, reelsY);
    borderLeft.lineTo(reelsX - 5, reelsY + gameHeight);
    borderLeft.stroke({ width: 6, color: 0xffea00 });
    this.container.addChild(borderLeft);

    const borderRight = new Graphics();
    borderRight.moveTo(reelsX + gameWidth + 5, reelsY);
    borderRight.lineTo(reelsX + gameWidth + 5, reelsY + gameHeight);
    borderRight.stroke({ width: 6, color: 0xffea00 });
    this.container.addChild(borderRight);

    for (let i = 1; i < 5; i++) {
      const lineX = reelsX + i * 150 - 5;
      const separator = new Graphics();
      separator.moveTo(lineX, reelsY);
      separator.lineTo(lineX, reelsY + gameHeight);
      separator.stroke({ width: 2, color: 0xffea00, alpha: 0.6 });
      this.container.addChild(separator);
    }

    this.graphics = new GraphicsController(this.app, this.reels);
    this.graphics.x = reelsX;
    this.graphics.y = reelsY;
    this.container.addChild(this.graphics);

    this.ui = new UIController(
      this.app,
      this.textures,
      initData.config,
      (bet) => this.onSpinRequested(bet),
      (bet) => this.onBetChanged(bet)
    );
    this.ui.x = reelsX;
    this.ui.y = reelsY + gameHeight + 15;
    this.container.addChild(this.ui);

    this.ui.updateBalance(initData.player.balance);
    this.ui.updateWin(0);

    this.paytable.updateBet(this.ui.currentBet);

    window.addEventListener("keydown", (e) => {
      if ((e.code === "Space" || e.code === "Enter") && this.state === "idle") {
        e.preventDefault();
        this.ui.triggerSpin();
      }
    });

    this.app.ticker.add((ticker) => this.update(ticker));
  }

  onBetChanged(newBet) {
    this.graphics.clear();
    this.paytable.updateBet(newBet);
    this.reels.undim();
    this.paytable.clearHighlight();
  }

  async onSpinRequested(bet) {
    this.state = "spinning";
    this.graphics.clear();
    this.reels.undim();
    this.paytable.clearHighlight();
    this.reels.startSpin();

    try {
      const result = await this.api.spin(bet);

      setTimeout(() => {
        this.reels.stopSpin(result.screen);
        this.pendingResult = result;
      }, 1000);
    } catch (err) {
      console.error(err);
      this.reels.stopSpin([
        [0, 1, 2, 3, 4],
        [4, 3, 2, 1, 0],
        [1, 2, 3, 4, 0]
      ]);
      this.pendingResult = {
        error: true,
        balance: 10000.0,
        totalWin: 0,
        wins: []
      };
    }
  }

  update(ticker) {
    this.reels.update(ticker);
    this.graphics.update(ticker);
    this.paytable.update(ticker);

    if (this.state === "spinning" && this.reels.isIdle()) {
      this.state = "idle";
      this.ui.enableControls();

      if (this.pendingResult) {
        this.ui.updateBalance(this.pendingResult.balance);
        this.ui.updateWin(this.pendingResult.totalWin);

        if (!this.pendingResult.error && this.pendingResult.wins.length > 0) {
          this.graphics.showWins(this.pendingResult.wins);

          const winCoordsSet = new Set();
          this.pendingResult.wins.forEach((win) => {
            this.paytable.highlightSymbol(win.symbol);

            if (win.lineIndex === -1) {
              win.coords.forEach((coord) => {
                winCoordsSet.add(`${coord.col},${coord.row}`);
              });
            } else {
              const pattern = this.graphics.paylinePatterns[win.lineIndex];
              for (let col = 0; col < win.count; col++) {
                winCoordsSet.add(`${col},${pattern[col]}`);
              }
            }
          });

          this.reels.dim(winCoordsSet);
        }

        this.pendingResult = null;
      }
    }
  }
}
