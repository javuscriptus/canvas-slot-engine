// Живность сцены темы «Неон»: пыль в свете фонаря и мигание вывески.
//
// Плагин устроен так же, как у «Сочи», и это единственное, что у них
// общее: ему выдают слой и подписку на кадр, дальше он живёт сам.
// Чаек, прибоя и расписания морских звуков здесь нет вовсе — второй план
// принадлежит теме целиком, включая решение «а нужен ли он».

import { ParticleSystem } from "../../engine/particles.js";
import { Bursts } from "./effects.js";

const CAPACITY = 90;

/**
 * Вывеска мигает не равномерно: серия из двух-трёх вспышек подряд,
 * затем долгая пауза. Ровное мигание читается как индикатор загрузки.
 */
const BURST_GAP = 0.11;
const REST_MIN = 4;
const REST_SPAN = 7;

export function createAmbient({ app, layer, store, audio, theme, getState = () => ({}) }) {
  const particles = new ParticleSystem(CAPACITY);
  layer.add(particles);

  const glow = store.frame(theme.atlas.particleGlow);

  let dustTimer = 0;
  let flickerTimer = 3;
  let burstLeft = 0;

  const tick = (dt) => {
    particles.update(dt);
    if (dt <= 0) return;

    const { idle = true, free = false } = getState();

    dustTimer -= dt;
    if (dustTimer <= 0) {
      dustTimer = 0.42;
      Bursts.ambientGlow(particles, glow,
        Math.random() * particles.width * 0.3,
        particles.height * (0.2 + Math.random() * 0.6));
    }

    // Во время спина и в бонусе вывеска не мигает: там своя подсветка,
    // и лишний мерцающий источник за барабанами читается как дефект.
    if (!idle || free) return;

    flickerTimer -= dt;
    if (flickerTimer > 0) return;
    Bursts.signFlicker(particles, glow,
      particles.width * (0.12 + Math.random() * 0.76),
      particles.height * (0.16 + Math.random() * 0.3));
    if (burstLeft > 0) {
      burstLeft--;
      flickerTimer = BURST_GAP;
    } else {
      burstLeft = 1 + Math.floor(Math.random() * 2);
      flickerTimer = REST_MIN + Math.random() * REST_SPAN;
    }
  };

  app.onUpdate.add(tick);

  return {
    applyLayout(layout) {
      particles.setSize(layout.width, layout.height);
    },
    destroy() {
      app.onUpdate.remove(tick);
      particles.clear();
      layer.remove(particles);
    }
  };
}
