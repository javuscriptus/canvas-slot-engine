import { Container, Sprite, Graphics, BlurFilter } from "pixi.js";

export class ReelsController extends Container {
  constructor(app, textures) {
    super();
    this.app = app;
    this.textures = textures;
    this.reels = [];
    this.reelWidth = 140;
    this.symbolHeight = 130;
    this.visibleSymbols = 3;
    this.totalReels = 5;

    this.initReels();
  }

  initReels() {
    const totalHeight = this.symbolHeight * this.visibleSymbols;

    for (let i = 0; i < this.totalReels; i++) {
      const reelContainer = new Container();
      reelContainer.x = i * (this.reelWidth + 10);
      reelContainer.y = 0;

      const bg = new Sprite(this.textures["reel_bg"]);
      reelContainer.addChild(bg);

      const symbolContainer = new Container();
      reelContainer.addChild(symbolContainer);

      const mask = new Graphics();
      mask.rect(0, 0, this.reelWidth, totalHeight);
      mask.fill({ color: 0xffffff });
      reelContainer.addChild(mask);
      symbolContainer.mask = mask;

      const blur = new BlurFilter();
      blur.strengthX = 0;
      blur.strengthY = 0;
      symbolContainer.filters = [blur];

      const reelData = {
        container: reelContainer,
        symbolContainer: symbolContainer,
        blurFilter: blur,
        symbols: [],
        position: 0,
        previousPosition: 0,
        spinSpeed: 0,
        state: "idle",
        targetSymbols: null,
        stopDelay: 0,
        bounceTimer: 0,
        anticipateTimer: 0
      };

      for (let j = -1; j < this.visibleSymbols + 1; j++) {
        const symbolId = Math.floor(Math.random() * 8);
        const sprite = new Sprite(this.textures[symbolId]);
        sprite.x = (this.reelWidth - 120) / 2;
        sprite.y = j * this.symbolHeight;
        sprite.width = 120;
        sprite.height = 120;
        sprite.symbolId = symbolId;

        symbolContainer.addChild(sprite);
        reelData.symbols.push(sprite);
      }

      this.addChild(reelContainer);
      this.reels.push(reelData);
    }
  }

  startSpin() {
    this.reels.forEach((reel, index) => {
      reel.state = "anticipate";
      reel.spinSpeed = 0;
      reel.targetSymbols = null;
      reel.stopDelay = 200 + index * 250;
      reel.bounceTimer = 0;
      reel.anticipateTimer = 0;
    });
  }

  stopSpin(screenData) {
    this.reels.forEach((reel, index) => {
      const colSymbols = [
        screenData[0][index],
        screenData[1][index],
        screenData[2][index]
      ];
      reel.targetSymbols = colSymbols;
      reel.state = "stopping";
    });
  }

  update(ticker) {
    const dt = ticker.deltaTime;

    this.reels.forEach((reel) => {
      if (reel.state === "anticipate") {
        reel.anticipateTimer += 0.12 * dt;
        const offset = -20 * Math.sin(reel.anticipateTimer * Math.PI);
        reel.symbols.forEach((sprite, j) => {
          sprite.y = (j - 1) * this.symbolHeight + offset;
        });
        if (reel.anticipateTimer >= 1) {
          reel.state = "spinning";
          reel.spinSpeed = 15;
        }
        reel.blurFilter.strengthY = 0;
      } else if (reel.state === "spinning") {
        if (reel.spinSpeed < 50) {
          reel.spinSpeed += 2.5 * dt;
        }
        reel.position += reel.spinSpeed * dt;
        this.updateReelSymbols(reel);
        reel.blurFilter.strengthY = Math.min(reel.spinSpeed * 0.4, 25);
      } else if (reel.state === "stopping") {
        if (reel.stopDelay > 0) {
          reel.stopDelay -= 16.6 * dt;
          reel.position += reel.spinSpeed * dt;
          this.updateReelSymbols(reel);
          reel.blurFilter.strengthY = Math.min(reel.spinSpeed * 0.4, 25);
        } else {
          reel.state = "aligning";
        }
      } else if (reel.state === "aligning") {
        const targetPos = Math.ceil(reel.position / this.symbolHeight) * this.symbolHeight;
        const diff = targetPos - reel.position;

        if (diff > 1) {
          reel.spinSpeed = diff * 0.2;
          reel.position += reel.spinSpeed * dt;
          this.updateReelSymbols(reel, true);
          reel.blurFilter.strengthY = Math.min(reel.spinSpeed * 0.4, 25);
        } else {
          reel.position = targetPos;
          reel.state = "bouncing";
          reel.bounceTimer = 0;
          this.applyFinalTextures(reel);
        }
      } else if (reel.state === "bouncing") {
        reel.bounceTimer += 0.15 * dt;
        const offset = Math.sin(reel.bounceTimer * Math.PI) * 16 * Math.exp(-reel.bounceTimer * 1.5);

        reel.symbols.forEach((sprite, j) => {
          sprite.y = (j - 1) * this.symbolHeight + offset;
        });

        if (reel.bounceTimer >= 3) {
          reel.state = "idle";
          reel.symbols.forEach((sprite, j) => {
            sprite.y = (j - 1) * this.symbolHeight;
          });
        }
        reel.blurFilter.strengthY = 0;
      }
    });
  }

  updateReelSymbols(reel, isStopping = false) {
    const offset = reel.position % this.symbolHeight;

    reel.symbols.forEach((sprite, j) => {
      sprite.y = (j - 1) * this.symbolHeight + offset;
    });

    if (reel.position - reel.previousPosition >= this.symbolHeight) {
      reel.previousPosition = reel.position - offset;

      const lastSprite = reel.symbols.pop();
      reel.symbols.unshift(lastSprite);

      let nextSymbolId;
      if (isStopping && reel.targetSymbols) {
        nextSymbolId = reel.targetSymbols[0];
      } else {
        nextSymbolId = Math.floor(Math.random() * 8);
      }

      lastSprite.texture = this.textures[nextSymbolId];
      lastSprite.symbolId = nextSymbolId;
    }
  }

  applyFinalTextures(reel) {
    if (!reel.targetSymbols) return;

    reel.symbols[1].texture = this.textures[reel.targetSymbols[0]];
    reel.symbols[1].symbolId = reel.targetSymbols[0];

    reel.symbols[2].texture = this.textures[reel.targetSymbols[1]];
    reel.symbols[2].symbolId = reel.targetSymbols[1];

    reel.symbols[3].texture = this.textures[reel.targetSymbols[2]];
    reel.symbols[3].symbolId = reel.targetSymbols[2];

    const topRandom = Math.floor(Math.random() * 8);
    const bottomRandom = Math.floor(Math.random() * 8);
    reel.symbols[0].texture = this.textures[topRandom];
    reel.symbols[0].symbolId = topRandom;
    reel.symbols[4].texture = this.textures[bottomRandom];
    reel.symbols[4].symbolId = bottomRandom;

    reel.symbols.forEach((sprite, j) => {
      sprite.y = (j - 1) * this.symbolHeight;
    });
  }

  dim(winningCoordsSet) {
    for (let col = 0; col < this.totalReels; col++) {
      const reel = this.reels[col];
      for (let row = 0; row < 3; row++) {
        const sprite = reel.symbols[row + 1];
        const coordKey = `${col},${row}`;
        if (!winningCoordsSet.has(coordKey)) {
          sprite.alpha = 0.4;
        } else {
          sprite.alpha = 1.0;
        }
      }
    }
  }

  undim() {
    for (let col = 0; col < this.totalReels; col++) {
      const reel = this.reels[col];
      for (let row = 0; row < 3; row++) {
        const sprite = reel.symbols[row + 1];
        sprite.alpha = 1.0;
      }
    }
  }

  isIdle() {
    return this.reels.every((reel) => reel.state === "idle");
  }

  getSymbolGlobalCoords(col, row) {
    const reel = this.reels[col];
    const sprite = reel.symbols[row + 1];
    return {
      x: reel.container.x + sprite.x + 60,
      y: reel.container.y + sprite.y + 60
    };
  }
}
