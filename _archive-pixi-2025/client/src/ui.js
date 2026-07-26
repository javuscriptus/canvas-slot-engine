import { Container, Sprite, Text, TextStyle, Graphics } from "pixi.js";

export class UIController extends Container {
  constructor(app, textures, config, onSpin, onBetChange) {
    super();
    this.app = app;
    this.textures = textures;
    this.config = config;
    this.onSpin = onSpin;
    this.onBetChange = onBetChange;

    this.currentBetIndex = config.availableBets.indexOf(config.defaultBet);
    if (this.currentBetIndex === -1) this.currentBetIndex = 0;
    this.currentBet = config.availableBets[this.currentBetIndex];

    this.initStyle();
    this.initPanel();
  }

  initStyle() {
    this.labelStyle = new TextStyle({
      fontFamily: "Orbitron",
      fontSize: 11,
      fill: 0xaaaaaa,
      fontWeight: "bold"
    });

    this.valueStyle = new TextStyle({
      fontFamily: "Rajdhani",
      fontSize: 20,
      fontWeight: "bold",
      fill: 0xffffff
    });

    this.statusStyle = new TextStyle({
      fontFamily: "Orbitron",
      fontSize: 22,
      fontWeight: "900",
      fill: 0xffffff,
      letterSpacing: 1
    });

    this.autoplayStyle = new TextStyle({
      fontFamily: "Orbitron",
      fontSize: 8,
      fontWeight: "bold",
      fill: 0xffffff
    });
  }

  initPanel() {
    const bg = new Graphics();
    bg.rect(0, 0, 740, 80);
    bg.fill({ color: 0x000000, alpha: 0.4 });
    this.addChild(bg);

    const btnMenu = new Graphics();
    btnMenu.circle(16, 16, 15);
    btnMenu.fill({ color: 0x111116 });
    btnMenu.stroke({ width: 1.5, color: 0xffffff, alpha: 0.8 });
    btnMenu.moveTo(9, 11);
    btnMenu.lineTo(23, 11);
    btnMenu.moveTo(9, 16);
    btnMenu.lineTo(23, 16);
    btnMenu.moveTo(9, 21);
    btnMenu.lineTo(23, 21);
    btnMenu.stroke({ width: 2, color: 0xffffff });
    btnMenu.x = 10;
    btnMenu.y = 10;
    btnMenu.eventMode = "static";
    btnMenu.cursor = "pointer";
    this.addChild(btnMenu);

    const btnSound = new Graphics();
    btnSound.circle(16, 16, 15);
    btnSound.fill({ color: 0x111116 });
    btnSound.stroke({ width: 1.5, color: 0xffffff, alpha: 0.8 });
    btnSound.moveTo(9, 13);
    btnSound.lineTo(13, 13);
    btnSound.lineTo(18, 8);
    btnSound.lineTo(18, 24);
    btnSound.lineTo(13, 19);
    btnSound.lineTo(9, 19);
    btnSound.closePath();
    btnSound.fill({ color: 0xffffff });
    btnSound.x = 10;
    btnSound.y = 44;
    btnSound.eventMode = "static";
    btnSound.cursor = "pointer";
    this.addChild(btnSound);

    const btnInfo = new Graphics();
    btnInfo.circle(16, 16, 15);
    btnInfo.fill({ color: 0x111116 });
    btnInfo.stroke({ width: 1.5, color: 0xffffff, alpha: 0.8 });
    const textI = new Text({ text: "i", style: new TextStyle({ fontFamily: "Georgia", fontSize: 16, fontWeight: "bold", fill: 0xffffff }) });
    textI.anchor.set(0.5);
    textI.x = 16;
    textI.y = 15;
    btnInfo.addChild(textI);
    btnInfo.x = 48;
    btnInfo.y = 27;
    btnInfo.eventMode = "static";
    btnInfo.cursor = "pointer";
    this.addChild(btnInfo);

    this.creditText = new Text({ text: "CREDIT", style: this.labelStyle });
    this.creditText.x = 95;
    this.creditText.y = 15;
    this.creditVal = new Text({ text: "€99,987.00", style: this.valueStyle });
    this.creditVal.x = 160;
    this.creditVal.y = 11;
    this.addChild(this.creditText, this.creditVal);

    this.betText = new Text({ text: "BET", style: this.labelStyle });
    this.betText.x = 95;
    this.betText.y = 45;
    this.betVal = new Text({ text: "€1.00", style: this.valueStyle });
    this.betVal.x = 160;
    this.betVal.y = 41;
    this.addChild(this.betText, this.betVal);

    this.statusText = new Text({ text: "PLACE YOUR BETS!", style: this.statusStyle });
    this.statusText.anchor.set(0.5);
    this.statusText.x = 390;
    this.statusText.y = 40;
    this.addChild(this.statusText);

    this.btnMinus = new Sprite(this.textures["btn_normal"]);
    this.btnMinus.anchor.set(0.5);
    this.btnMinus.x = 550;
    this.btnMinus.y = 40;
    this.btnMinus.eventMode = "static";
    this.btnMinus.cursor = "pointer";
    const minusSym = new Text({ text: "-", style: new TextStyle({ fontFamily: "Orbitron", fontSize: 22, fill: 0xffffff, fontWeight: "bold" }) });
    minusSym.anchor.set(0.5);
    minusSym.y = -2;
    this.btnMinus.addChild(minusSym);
    this.btnMinus.on("pointerdown", () => this.changeBet(-1));
    this.addChild(this.btnMinus);

    this.btnSpin = new Sprite(this.textures["btn_spin"]);
    this.btnSpin.anchor.set(0.5);
    this.btnSpin.x = 612;
    this.btnSpin.y = 40;
    this.btnSpin.eventMode = "static";
    this.btnSpin.cursor = "pointer";
    this.btnSpin.on("pointerdown", () => this.triggerSpin());
    this.addChild(this.btnSpin);

    const autoplayBg = new Graphics();
    autoplayBg.roundRect(-30, 0, 60, 14, 4);
    autoplayBg.fill({ color: 0x000000 });
    autoplayBg.stroke({ width: 1, color: 0x444444 });
    const autoplayText = new Text({ text: "AUTOPLAY", style: this.autoplayStyle });
    autoplayText.anchor.set(0.5);
    autoplayText.y = 7;
    autoplayBg.addChild(autoplayText);
    autoplayBg.x = 612;
    autoplayBg.y = 66;
    this.addChild(autoplayBg);

    this.btnPlus = new Sprite(this.textures["btn_normal"]);
    this.btnPlus.anchor.set(0.5);
    this.btnPlus.x = 674;
    this.btnPlus.y = 40;
    this.btnPlus.eventMode = "static";
    this.btnPlus.cursor = "pointer";
    const plusSym = new Text({ text: "+", style: new TextStyle({ fontFamily: "Orbitron", fontSize: 20, fill: 0xffffff, fontWeight: "bold" }) });
    plusSym.anchor.set(0.5);
    plusSym.y = -1;
    this.btnPlus.addChild(plusSym);
    this.btnPlus.on("pointerdown", () => this.changeBet(1));
    this.addChild(this.btnPlus);
  }

  updateBalance(balance, currency = "EUR") {
    const symbol = "€";
    this.creditVal.text = symbol + balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  updateWin(winAmount, currency = "EUR") {
    const symbol = "€";
    if (winAmount > 0) {
      this.statusText.text = "WIN " + symbol + winAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } else {
      this.statusText.text = "PLACE YOUR BETS!";
    }
  }

  changeBet(direction) {
    if (this.btnSpin.alpha < 1) return;

    const newIndex = this.currentBetIndex + direction;
    if (newIndex >= 0 && newIndex < this.config.availableBets.length) {
      this.currentBetIndex = newIndex;
      this.currentBet = this.config.availableBets[this.currentBetIndex];
      this.betVal.text = `€${this.currentBet.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      this.onBetChange(this.currentBet);
    }
  }

  triggerSpin() {
    if (this.btnSpin.alpha < 1) return;
    this.disableControls();
    this.statusText.text = "SPINNING...";
    this.onSpin(this.currentBet);
  }

  disableControls() {
    this.btnSpin.alpha = 0.4;
    this.btnSpin.cursor = "default";
    this.btnPlus.alpha = 0.4;
    this.btnPlus.cursor = "default";
    this.btnMinus.alpha = 0.4;
    this.btnMinus.cursor = "default";
  }

  enableControls() {
    this.btnSpin.alpha = 1;
    this.btnSpin.cursor = "pointer";
    this.btnPlus.alpha = 1;
    this.btnPlus.cursor = "pointer";
    this.btnMinus.alpha = 1;
    this.btnMinus.cursor = "pointer";
  }
}
