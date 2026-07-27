// Тряска камеры.
//
// Применяется к контейнеру игрового поля, а не ко всей сцене: трясти вместе
// с барабанами панель управления, счётчики и фон — верный способ сделать
// интерфейс дешёвым. Настоящие автоматы дрожат барабанами, а корпус стоит
// на месте.

export class Shaker {
  /** @param target узел, который трясётся; его x и y принадлежат тряске. */
  constructor(target) {
    this.target = target;
    this.amp = 0;
    this.time = 0;
    this.duration = 0.4;
  }

  /**
   * Короткий толчок. Используется на крупных выигрышах и на антисипации —
   * там, где событие нужно почувствовать физически.
   *
   * Более сильный толчок перебивает слабый, а не складывается с ним:
   * иначе серия событий подряд превращается в постоянную дрожь.
   */
  kick(amp = 10, duration = 0.4) {
    this.amp = Math.max(this.amp, amp);
    this.duration = duration;
    this.time = 0;
  }

  update(dt) {
    const t = this.target;
    if (this.amp <= 0) {
      if (t.x !== 0 || t.y !== 0) { t.x = 0; t.y = 0; }
      return;
    }
    this.time += dt;
    const k = Math.min(1, this.time / this.duration);
    const falloff = (1 - k) * (1 - k);
    const a = this.amp * falloff;
    // Толчок преимущественно вертикальный: барабан падает сверху вниз,
    // и боковая болтанка выглядела бы неестественно.
    t.x = Math.sin(this.time * 41) * a * 0.35;
    t.y = Math.cos(this.time * 33) * a;
    if (k >= 1) {
      this.amp = 0;
      t.x = 0;
      t.y = 0;
    }
  }
}
