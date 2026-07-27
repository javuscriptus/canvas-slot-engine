// Живность сцены: золотая пыль над набережной, накат волны и чайки.
//
// Это ПЛАГИН темы, а не часть игры. Ему дают слой сцены и подписку на кадр,
// дальше он живёт сам: заводит свои частицы, сам их двигает, сам решает,
// когда крикнуть чайке. Слот про чаек не знает ничего — раньше знал:
// таймеры прибоя и вызов ambientGlow лежали прямо в игровом цикле, и
// вторая тема получала их в наследство вместе с черноморским колоритом.
//
// Фоновые звуки не кладутся в музыкальную петлю: она повторяется каждые
// 19 секунд, и любой узнаваемый звук в ней превращается в навязчивый тик.
// Поэтому они живут здесь и запускаются по случайному расписанию — ухо
// не находит период и принимает их за среду.

import { ParticleSystem } from "../../engine/particles.js";
import { Bursts } from "./effects.js";

/** Сколько частиц держим живыми: пыль долгая, поэтому их всегда много. */
const CAPACITY = 120;

/** Интервал появления пылинки и разброс пауз между звуками моря, секунды. */
const DUST_EVERY = 0.5;
const SEA_MIN = 11;
const SEA_SPAN = 17;

/**
 * @param opts.app      Application: нужен ради подписки на кадр
 * @param opts.layer    контейнер слоя, куда плагин кладёт свои узлы
 * @param opts.store    ассеты — за кадром частицы
 * @param opts.audio    звук
 * @param opts.theme    своя же тема: имена кадров и звуков
 * @param opts.getState () => ({ idle, free }) — состояние игры общими словами
 */
export function createAmbient({ app, layer, store, audio, theme, getState = () => ({}) }) {
  const particles = new ParticleSystem(CAPACITY);
  layer.add(particles);

  const glow = store.frame(theme.atlas.particleGlow);
  const spark = store.frame(theme.atlas.particleSpark);

  // Первая чайка не сразу: на старте у игрока и так шумно от загрузки.
  let seaTimer = 9 + Math.random() * 10;
  let dustTimer = 0;
  let surfTimer = 2;

  const tick = (dt) => {
    particles.update(dt);
    if (dt <= 0) return;

    const { idle = true, free = false } = getState();
    // Во фриспинах и во время спина набережная затихает: там своя,
    // более плотная музыка, и второй план обязан ей уступить.
    const quiet = free || !idle;

    dustTimer -= dt;
    if (dustTimer <= 0) {
      dustTimer = DUST_EVERY;
      Bursts.ambientGlow(particles, glow,
        Math.random() * particles.width,
        particles.height * (0.25 + Math.random() * 0.55));
    }

    // Накат: полоса пены у нижнего края, редкая и почти незаметная.
    // Её задача — чтобы низ кадра не был мёртвым, а не привлечь взгляд.
    surfTimer -= dt;
    if (surfTimer <= 0) {
      surfTimer = 1.4 + Math.random() * 2.2;
      Bursts.surfFoam(particles, spark,
        Math.random() * particles.width,
        particles.height * (0.78 + Math.random() * 0.1));
    }

    seaTimer -= dt;
    if (seaTimer > 0) return;
    if (Math.random() < 0.55) {
      audio.play(theme.sounds.gull, { volume: quiet ? 0.16 : 0.34, rate: 0.9 + Math.random() * 0.25 });
    } else {
      audio.play(theme.sounds.wave, { volume: quiet ? 0.12 : 0.26, rate: 0.92 + Math.random() * 0.16 });
    }
    seaTimer = SEA_MIN + Math.random() * SEA_SPAN;
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
