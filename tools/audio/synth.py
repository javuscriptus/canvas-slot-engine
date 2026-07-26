#!/usr/bin/env python3
"""
Синтез всей звуковой дорожки игры с нуля: SFX-спрайт и музыкальные петли.

    python3 tools/audio/synth.py

Ничего не скачивает и не использует чужие сэмплы — значит, нет
лицензионных рисков при запуске на реальные деньги.
Результат: client/assets/audio/{sfx.webm,sfx.mp3,sfx.json,music_*.{webm,mp3}}

──────────────────────────── о звучании ─────────────────────────────

Тема — черноморский променад. Не абстрактное «казино», а конкретное
место: набережная, вечер, из открытого кафе играет живой состав.

Отсюда и состав инструментов. Нейлоновая гитара (не металлические
струны — они звучат холодно и по-северному), аккордеон с расстроенными
язычками, флюгельгорн вместо трубы: он мягче и теплее. Ритм — румба,
латинская перкуссия на кахоне и конгах. Под всем этим постоянный шум
прибоя, изредка чайка.

Гармония — андалузская каденция Am — G — F — E. Это тот самый оборот,
который мгновенно читается как «юг»: он же в одесских песнях, в цыганском
романсе, в средиземноморской эстраде. Мажорная терция в последнем аккорде
(G#) даёт фригийский доминантовый лад — характерную «южную» краску,
ради которой всё и затевалось.

Во фриспинах та же каденция на кварту выше (Dm — C — B♭ — A) и другой
состав: ведёт вибрафон, перкуссия смягчается щётками, добавляется
контрапункт флюгельгорна. Слышно, что это тот же вечер, но позже.
"""

import json
import os
import subprocess
import sys
import numpy as np

SR = 48000          # частота дискретизации
OUT = os.path.join(os.path.dirname(__file__), "../../client/assets/audio")

rng = np.random.default_rng(20260726)   # фиксированное зерно → детерминированная сборка


# ─────────────────────────────── базис ────────────────────────────────

def t(dur):
    return np.linspace(0, dur, int(SR * dur), endpoint=False)


def sine(freq, dur, phase=0.0):
    return np.sin(2 * np.pi * freq * t(dur) + phase)


def saw(freq, dur):
    x = t(dur)
    return 2.0 * ((x * freq) % 1.0) - 1.0


def square(freq, dur, duty=0.5):
    return np.where(((t(dur) * freq) % 1.0) < duty, 1.0, -1.0)


def triangle(freq, dur):
    return 2.0 * np.abs(2.0 * ((t(dur) * freq) % 1.0) - 1.0) - 1.0


def noise(dur):
    return rng.uniform(-1, 1, int(SR * dur))


def sweep(f0, f1, dur, kind="sine", curve="exp"):
    """Частотный свип. Фаза считается интегрированием мгновенной частоты."""
    x = t(dur)
    if curve == "exp":
        f = f0 * (f1 / f0) ** (x / max(dur, 1e-9))
    else:
        f = f0 + (f1 - f0) * (x / max(dur, 1e-9))
    phase = 2 * np.pi * np.cumsum(f) / SR
    if kind == "saw":
        return 2.0 * ((phase / (2 * np.pi)) % 1.0) - 1.0
    if kind == "square":
        return np.sign(np.sin(phase))
    return np.sin(phase)


# ───────────────────────────── ноты ───────────────────────────────────

_SEMI = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def nf(name):
    """
    Имя ноты → частота. "A4" = 440 Гц, поддерживаются # и b.

    Партии записываются нотами, а не числами: строку 587.33 в мелодии
    невозможно прочитать глазами, а "D5" — можно, и ошибку видно сразу.
    """
    letter = name[0].upper()
    i = 1
    semi = _SEMI[letter]
    while i < len(name) and name[i] in "#b":
        semi += 1 if name[i] == "#" else -1
        i += 1
    octave = int(name[i:])
    midi = 12 * (octave + 1) + semi
    return 440.0 * 2 ** ((midi - 69) / 12.0)


def chord(names):
    return [nf(n) for n in names]


# ───────────────────────────── огибающие ──────────────────────────────

def adsr(dur, a=0.01, d=0.1, s=0.6, r=0.2):
    n = int(SR * dur)
    na, nd = int(SR * a), int(SR * d)
    nr = int(SR * r)
    ns = max(0, n - na - nd - nr)
    env = np.concatenate([
        np.linspace(0, 1, na, endpoint=False) if na else np.array([]),
        np.linspace(1, s, nd, endpoint=False) if nd else np.array([]),
        np.full(ns, s),
        np.linspace(s, 0, nr) if nr else np.array([]),
    ])
    return np.resize(env, n)


def perc_env(dur, attack=0.002, power=3.0):
    """Ударная огибающая: мгновенная атака, экспоненциальный спад."""
    n = int(SR * dur)
    na = max(1, int(SR * attack))
    env = np.ones(n)
    env[:na] = np.linspace(0, 1, na)
    tail = np.linspace(0, 1, n - na)
    env[na:] = (1 - tail) ** power
    return env


# ────────────────────────────── обработка ─────────────────────────────

def lowpass_fast(x, cutoff):
    """Векторная аппроксимация ФНЧ через БПФ — для длинных сигналов."""
    n = len(x)
    spec = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(n, 1 / SR)
    spec *= 1.0 / (1.0 + (freqs / max(cutoff, 1e-6)) ** 2)
    return np.fft.irfft(spec, n)


def highpass_fast(x, cutoff):
    n = len(x)
    spec = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(n, 1 / SR)
    ratio = (freqs / max(cutoff, 1e-6)) ** 2
    spec *= ratio / (1.0 + ratio)
    return np.fft.irfft(spec, n)


def bandpass(x, low, high):
    return lowpass_fast(highpass_fast(x, low), high)


def resonate(x, peaks):
    """
    Резонансы корпуса инструмента: peaks = [(частота, добротность, усиление)].

    Без этого щипок звучит как синтезатор. Дека гитары подчёркивает
    несколько узких полос, и именно они отличают «деревянный» тембр
    от «электронного» — сам по себе алгоритм Карплуса даёт голую струну.
    """
    n = len(x)
    spec = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(n, 1 / SR)
    gain = np.ones_like(freqs)
    for f0, q, g in peaks:
        gain += g / (1.0 + (q * (freqs / f0 - f0 / np.maximum(freqs, 1e-6))) ** 2)
    return np.fft.irfft(spec * gain, n)


def _db(g):
    return 10.0 ** (g / 20.0)


def peaking(x, f0, q, gain_db):
    """Колокольный эквалайзер в частотной области."""
    n = len(x)
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    shape = 1.0 / (1.0 + (q * (f / f0 - f0 / np.maximum(f, 1e-6))) ** 2)
    return np.fft.irfft(spec * (1.0 + (_db(gain_db) - 1.0) * shape), n)


def shelf(x, f0, gain_db, high=True):
    """Полочный фильтр: поднимает или срезает всё выше/ниже частоты."""
    n = len(x)
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    ratio = (f / max(f0, 1e-6)) ** 2
    s = ratio / (1.0 + ratio) if high else 1.0 / (1.0 + ratio)
    return np.fft.irfft(spec * (1.0 + (_db(gain_db) - 1.0) * s), n)


def mix_bus(x, air=4.0, mud=-3.5):
    """
    Шина сведения.

    Отдельные инструменты звучат правильно, а вместе дают гору в нижней
    середине: там сидят и корпус гитары, и левая рука аккордеона, и низ
    конг. Одновременно не хватает воздуха — почти всё в тембрах отрезано
    фильтрами по дороге. Поэтому здесь всегда одно и то же: убрать
    200 Гц, вернуть верх полкой, срезать подвал, который всё равно
    не воспроизведёт ни один телефон.
    """
    y = highpass_fast(x, 38)
    y = peaking(y, 210, 1.1, mud)
    y = peaking(y, 3200, 0.8, 1.5)
    y = shelf(y, 5000, air, high=True)
    return y


def fft_convolve(x, ir):
    """Свёртка через БПФ: прямая на длинных петлях считалась бы минутами."""
    n = len(x) + len(ir) - 1
    size = 1 << (n - 1).bit_length()
    y = np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)
    return y[: len(x)]


def reverb(x, decay=1.4, mix=0.28, damp=4200):
    """Свёрточная реверберация с экспоненциально затухающим шумом."""
    ir_len = int(SR * decay)
    ir = rng.uniform(-1, 1, ir_len) * np.exp(-np.linspace(0, 7, ir_len))
    ir[0] = 1.0
    ir = lowpass_fast(ir, damp)
    wet = fft_convolve(x, ir)
    wet /= (np.max(np.abs(wet)) or 1)
    return (1 - mix) * x + mix * wet


def pad(x, dur):
    """Дополняет/обрезает сигнал до точной длительности."""
    n = int(SR * dur)
    if len(x) >= n:
        return x[:n]
    return np.concatenate([x, np.zeros(n - len(x))])


def add_at(buf, seg, start_sec):
    """Подмешивает сегмент в буфер с обрезкой по границе — иначе хвост
    последнего удара вылезает за длину клипа и numpy падает."""
    i = int(start_sec * SR)
    if i >= len(buf):
        return buf
    if i < 0:
        seg = seg[-i:]
        i = 0
    seg = seg[: len(buf) - i]
    buf[i:i + len(seg)] += seg
    return buf


def mixdown(*layers):
    n = max(len(l) for l in layers)
    out = np.zeros(n)
    for l in layers:
        out[: len(l)] += l
    return out


def normalize(x, peak=0.88):
    m = np.max(np.abs(x)) or 1.0
    return x * (peak / m)


def fade(x, fin=0.004, fout=0.02):
    y = x.copy()
    ni, no = int(SR * fin), int(SR * fout)
    if ni:
        y[:ni] *= np.linspace(0, 1, ni)
    if no:
        y[-no:] *= np.linspace(1, 0, no)
    return y


# ─────────────────────────── инструменты ──────────────────────────────

def karplus(freq, dur, decay=0.9965, damp=0.5, exciter=None):
    """
    Струна методом Карплуса — Стронга, посчитанная кругами задержки.

    Классическая реализация идёт по одному отсчёту и на питоне стоит
    непозволительно дорого: полсекунды звука — это 24 000 итераций
    на КАЖДУЮ ноту, а нот в петле под сотню. Здесь фильтр применяется
    к целому кругу линии задержки сразу, вектором. Разница на слух
    неразличима, а время сборки падает на порядок.
    """
    n = int(SR * dur)
    p = max(2, int(round(SR / freq)))
    buf = np.resize(exciter, p) if exciter is not None else rng.uniform(-1, 1, p)
    blocks = []
    total = 0
    while total < n:
        blocks.append(buf)
        total += p
        buf = decay * (damp * buf + (1 - damp) * np.roll(buf, -1))
    return np.concatenate(blocks)[:n]


def nylon(freq, dur, amp=1.0, bright=1.0):
    """
    Нейлоновая струна классической гитары.

    Возбуждение — не белый шум, а мягкий отфильтрованный импульс: ноготь
    по нейлону не даёт той верхней «трески», что медиатор по металлу.
    Дальше резонансы деки: воздушная мода корпуса ≈ 100 Гц и верхняя
    ≈ 200 Гц. Именно они делают звук деревянным, а не синтетическим.
    """
    p = max(2, int(round(SR / freq)))
    exc = lowpass_fast(rng.uniform(-1, 1, p), 1800 * bright)
    exc *= np.linspace(1, 0.3, p) ** 0.5
    y = karplus(freq, dur, decay=0.9972, damp=0.42, exciter=exc)
    y = resonate(y, [(96, 9, 0.9), (196, 12, 0.6), (420, 8, 0.45)])
    y = lowpass_fast(y, 5200 * bright)
    y = highpass_fast(y, 70)
    return y * perc_env(dur, 0.0015, 1.25) * amp * 0.5


def guitar_chord(freqs, dur, amp=1.0, spread=0.016, down=True):
    """Перебор струн: приём вниз или вверх. Разброс атак и делает «строй»."""
    order = list(freqs) if down else list(reversed(freqs))
    y = np.zeros(int(SR * dur))
    for i, f in enumerate(order):
        add_at(y, nylon(f, max(0.05, dur - i * spread), amp), i * spread)
    return y


def rasgueado(freqs, dur, amp=1.0):
    """Веерный удар по струнам — фламенковая краска, ставится на слабую долю."""
    y = np.zeros(int(SR * dur))
    for i, f in enumerate(list(freqs) + [freqs[-1] * 2]):
        add_at(y, nylon(f, max(0.05, dur - i * 0.009), amp * 0.7, bright=1.4), i * 0.009)
    return y


def accordion(freq, dur, amp=1.0, reeds=(1.0, 1.0047, 0.9953)):
    """
    Аккордеон с расстроенными язычками (мюзет).

    Расстройка обязательна: один язычок звучит как дешёвый орган.
    Биения между тремя чуть разными язычками и дают тот самый
    «дышащий» тембр, который узнаётся на набережной за сто метров.
    """
    y = np.zeros(int(SR * dur))
    for r in reeds:
        f = freq * r
        y += square(f, dur, 0.44) * 0.34 + saw(f, dur) * 0.22
    y = bandpass(y, 190, 4200)
    # Лёгкое дыхание мехов: без него звук стоит на месте.
    breath = lowpass_fast(noise(dur), 700) * 0.06
    env = adsr(dur, a=0.07, d=0.18, s=0.82, r=0.22)
    trem = 1 + 0.05 * np.sin(2 * np.pi * 4.6 * t(dur))
    return (y / len(reeds) + breath) * env * trem * amp * 0.3


def flugel(freq, dur, amp=1.0, bright=1.0):
    """
    Флюгельгорн: тот же строй, что у трубы, но конический раструб —
    звук круглее и теплее. Для курортной темы это важнее яркости:
    труба режет ухо, флюгельгорн обнимает.
    """
    x = t(dur)
    vib = np.sin(2 * np.pi * 5.1 * x) * np.clip((x - 0.18) / 0.3, 0, 1) * 0.0045
    phase = 2 * np.pi * np.cumsum(freq * (1 + vib)) / SR
    y = np.zeros_like(x)
    for k in range(1, 13):
        y += np.sin(k * phase) / (k ** 1.35)
    # Раструб открывается на атаке — медь всегда светлеет под напором.
    y = lowpass_fast(y, 1500 + 1800 * bright)
    air = highpass_fast(noise(dur), 2500) * 0.045 * np.exp(-x * 6)
    return (y + air) * adsr(dur, a=0.055, d=0.14, s=0.78, r=0.26) * amp * 0.32


def vibraphone(freq, dur, amp=1.0):
    """Вибрафон: моды бруска 1 : 4 : 10 плюс мотор-тремоло."""
    x = t(dur)
    y = (np.sin(2 * np.pi * freq * x) * np.exp(-x * 1.6)
         + 0.32 * np.sin(2 * np.pi * freq * 4.0 * x) * np.exp(-x * 4.5)
         + 0.12 * np.sin(2 * np.pi * freq * 10.0 * x) * np.exp(-x * 9.0))
    motor = 1 - 0.34 * (0.5 + 0.5 * np.sin(2 * np.pi * 5.4 * x))
    mallet = highpass_fast(noise(dur), 3000) * np.exp(-x * 120) * 0.1
    return (y * motor + mallet) * perc_env(dur, 0.001, 0.9) * amp * 0.45


def upright_bass(freq, dur, amp=1.0):
    """Контрабас: щипок с деревянным призвуком и коротким «стуком» пальца."""
    y = karplus(freq, dur, decay=0.9988, damp=0.7)
    y = lowpass_fast(y, 700)
    y = resonate(y, [(70, 7, 1.6), (130, 9, 0.7)])
    thump = lowpass_fast(noise(0.03), 220) * perc_env(0.03, 0.0005, 3) * 0.5
    y = mixdown(y * perc_env(dur, 0.004, 1.1), pad(thump, dur))
    return y * amp * 0.75


def celesta(freq, dur, amp=1.0, bright=1.0):
    """
    Челеста: чистый колокольчик с длинным сиянием.

    Главный инструмент выигрышей. Частотная модуляция здесь мягкая
    (индекс около единицы, а не трёх, как у колокола) и с отношением
    3:1 — получается прозрачный, «стеклянный» тон без металлического
    лязга. Именно он даёт то самое ощущение, ради которого выигрыш
    и слушают: сверху звенит, снизу держит.
    """
    x = t(dur)
    idx = 1.15 * bright * np.exp(-x * 3.2)
    y = np.sin(2 * np.pi * freq * x + idx * np.sin(2 * np.pi * freq * 3 * x))
    # Второй, чуть расстроенный голос: биения делают звук живым.
    y += 0.5 * np.sin(2 * np.pi * freq * 1.001 * x
                      + idx * 0.7 * np.sin(2 * np.pi * freq * 3.01 * x)) * np.exp(-x * 1.7)
    # Верхнее сияние — то, что слышно последним и дольше всего.
    y += 0.16 * np.sin(2 * np.pi * freq * 4 * x) * np.exp(-x * 4.5)
    y += 0.07 * np.sin(2 * np.pi * freq * 6.7 * x) * np.exp(-x * 7)
    env = np.exp(-x * 1.5) * (1 - np.exp(-x * 900))
    return y * env * amp * 0.42


def glass(freq, dur, amp=1.0):
    """Высокий призвук поверх аккорда — «пыльца». Почти без основного тона."""
    x = t(dur)
    y = np.zeros_like(x)
    for k, decay in ((4.0, 3.5), (5.4, 5.0), (8.1, 7.0), (11.0, 9.5)):
        y += np.sin(2 * np.pi * freq * k * x) * np.exp(-x * decay) / k
    return y * amp * 0.5


def choir(freqs, dur, amp=1.0):
    """
    Хоровая подушка под крупный выигрыш.

    Не настоящий хор, конечно: пила с расстройкой, прогнанная через
    три форманты гласной «а». Задача — не изобразить людей, а дать
    большому выигрышу основание, на котором держатся колокольчики.
    Без подушки верх звучит тонко и дёшево.
    """
    n = int(SR * dur)
    x = t(dur)
    y = np.zeros(n)
    for f in freqs:
        for d in (0.997, 1.0, 1.004):
            vib = 1 + 0.004 * np.sin(2 * np.pi * 4.7 * x + f)
            ph = 2 * np.pi * np.cumsum(f * d * vib) / SR
            y += (2.0 * ((ph / (2 * np.pi)) % 1.0) - 1.0) * 0.4
    y /= max(1, len(freqs) * 3)
    y = resonate(y, [(700, 4, 2.4), (1150, 5, 1.6), (2600, 6, 0.8)])
    y = lowpass_fast(y, 3400)
    return y * adsr(dur, a=0.22, d=0.3, s=0.85, r=0.45) * amp * 0.55


def sub_swell(freq, dur, amp=1.0):
    """Низкий подъём под кульминацию: его не слышат, его чувствуют."""
    x = t(dur)
    y = np.sin(2 * np.pi * freq * x) + 0.3 * np.sin(2 * np.pi * freq * 2 * x)
    return y * adsr(dur, a=0.25, d=0.2, s=0.8, r=0.4) * amp * 0.5


def bell(freq, dur, bright=1.0, amp=1.0):
    """FM-колокол: остался для скаттера — он должен звенеть, а не петь."""
    x = t(dur)
    mod = np.sin(2 * np.pi * freq * 1.41 * x) * np.exp(-x * 5) * 3.2 * bright
    y = np.sin(2 * np.pi * freq * x + mod)
    y += 0.35 * np.sin(2 * np.pi * freq * 2.76 * x) * np.exp(-x * 7)
    y += 0.2 * np.sin(2 * np.pi * freq * 5.4 * x) * np.exp(-x * 11)
    return y * perc_env(dur, 0.002, 2.2) * amp


def metallic_clink(dur=0.16, base=2200, amp=1.0):
    """Звон монеты: несколько негармонических частичных тонов."""
    parts = [1.0, 1.87, 2.41, 3.12, 4.03]
    x = t(dur)
    y = np.zeros(int(SR * dur))
    for i, p in enumerate(parts):
        y += np.sin(2 * np.pi * base * p * x) * np.exp(-x * (14 + i * 5)) / (i + 1)
    y += noise(dur) * np.exp(-x * 90) * 0.25
    return y * amp * 0.5


# ─────────────────────────── перкуссия ────────────────────────────────

def cajon_bass(amp=1.0):
    """Низкий удар ладонью в центр передней панели."""
    y = mixdown(
        sweep(165, 58, 0.24, "sine") * perc_env(0.24, 0.001, 2.6),
        pad(lowpass_fast(noise(0.05), 380) * perc_env(0.05, 0.0005, 3) * 0.5, 0.24),
    )
    return y * amp * 0.5


def cajon_slap(amp=1.0):
    """Щелчок по краю: сухой, короткий, с деревянным призвуком."""
    y = mixdown(
        bandpass(noise(0.08), 1400, 7000) * perc_env(0.08, 0.0004, 5),
        pad(sine(430, 0.05) * perc_env(0.05, 0.0004, 6) * 0.35, 0.08),
    )
    return y * amp * 0.9


def conga(freq=210, dur=0.26, amp=1.0, open_tone=True):
    x = t(dur)
    skin = np.sin(2 * np.pi * freq * x) * np.exp(-x * (5 if open_tone else 26))
    skin += 0.4 * np.sin(2 * np.pi * freq * 1.6 * x) * np.exp(-x * 12)
    attack = bandpass(noise(dur), 700, 5000) * np.exp(-x * 60) * 0.4
    return (skin + attack) * amp * 0.8


def clave(amp=1.0):
    """Клаве: два деревянных бруска, почти чистый тон, мгновенный спад."""
    dur = 0.09
    x = t(dur)
    y = (np.sin(2 * np.pi * 2450 * x) + 0.6 * np.sin(2 * np.pi * 3350 * x))
    y *= np.exp(-x * 55)
    y += bandpass(noise(dur), 1500, 8000) * np.exp(-x * 130) * 0.35
    return y * amp * 0.95


def shaker(amp=1.0, closed=True):
    dur = 0.11 if closed else 0.2
    x = t(dur)
    y = highpass_fast(noise(dur), 6000)
    y *= np.exp(-x * (48 if closed else 16)) * (1 - np.exp(-x * 900))
    return y * amp * 0.85


def guiro(amp=1.0, dur=0.34, ticks=13):
    """Гуиро: серия зубчиков под палочкой, к концу чуть быстрее."""
    y = np.zeros(int(SR * dur))
    pos = 0.0
    for i in range(ticks):
        tick = bandpass(noise(0.02), 2200, 8000) * perc_env(0.02, 0.0003, 4)
        add_at(y, tick * (0.5 + 0.5 * i / ticks), pos)
        pos += (dur / ticks) * (1.25 - 0.5 * i / ticks)
    return y * amp * 0.45


def brush(amp=1.0):
    """Щётка по пластику: мягкий шелест вместо щелчка. Для ночной темы."""
    dur = 0.22
    y = bandpass(noise(dur), 900, 6500) * perc_env(dur, 0.02, 1.4)
    return y * amp * 0.6


# ─────────────────────── море и чайки ─────────────────────────────────

def surf(dur, amp=1.0, seamless=True):
    """
    Прибой: отфильтрованный шум с медленными накатами.

    Для музыкальной петли важно, чтобы огибающая замыкалась в кольцо,
    иначе на стыке слышен провал. Поэтому периоды накатов — точные доли
    длины петли, а не «примерно шесть секунд».
    """
    n = int(SR * dur)
    x = t(dur)
    base = bandpass(rng.normal(0, 1, n), 130, 700)
    hiss = bandpass(rng.normal(0, 1, n), 1800, 7500) * 0.45

    if seamless:
        periods = [dur / 2, dur / 3, dur / 5]
    else:
        periods = [6.5, 4.1, 2.7]

    env = np.zeros(n)
    for i, p in enumerate(periods):
        env += (0.5 + 0.5 * np.sin(2 * np.pi * x / p + i * 1.7)) / (i + 1)
    env /= env.max() or 1
    env = 0.25 + 0.75 * env ** 1.8

    return (base + hiss * env) * env * amp * 0.4


def gull(amp=1.0, calls=3):
    """
    Крик чайки: нисходящий формантный вскрик, два-три раза подряд.

    Сделан «голосом», а не свистом: несущая с сильной модуляцией плюс
    резонанс на 1.6 кГц. Чистая синусоида звучала бы как приборный писк.
    """
    gap = 0.26
    dur = gap * calls + 0.4
    y = np.zeros(int(SR * dur))
    for i in range(calls):
        d = rng.uniform(0.16, 0.22)
        x = t(d)
        f0 = rng.uniform(1150, 1400)
        f = f0 * (1 + 0.55 * np.exp(-x * 14)) * (1 - 0.35 * x / d)
        phase = 2 * np.pi * np.cumsum(f) / SR
        cry = np.sin(phase) + 0.5 * np.sin(2 * phase) + 0.25 * np.sin(3 * phase)
        cry *= 1 + 0.5 * np.sin(2 * np.pi * 32 * x)      # «дрожь» в голосе
        cry = resonate(cry, [(1600, 5, 1.8), (3100, 7, 0.7)])
        cry *= adsr(d, a=0.012, d=0.05, s=0.6, r=0.09)
        add_at(y, cry * rng.uniform(0.7, 1.0), i * gap + rng.uniform(0, 0.05))
    return y * amp * 0.32


# ─────────────────────────── звуковые эффекты ─────────────────────────

def sfx_click():
    """Клаве вместо синтетического «бипа»: тот же щелчок, но из состава."""
    return fade(normalize(clave(1.0), 0.5))


def sfx_button():
    y = mixdown(
        nylon(nf("A3"), 0.4, 0.9),
        pad(clave(0.35), 0.4),
    )
    return fade(normalize(y, 0.6))


def sfx_error():
    """Кластер аккордеона на полутоне — «фальшивая нота», слышно сразу."""
    y = mixdown(
        accordion(nf("F3"), 0.34, 0.9),
        accordion(nf("E3"), 0.34, 0.9),
        pad(cajon_bass(0.5), 0.34),
    )
    return fade(normalize(lowpass_fast(y, 2200), 0.6))


def sfx_spin_start():
    """Расгеадо по струнам, шейкер и накат волны — барабаны пошли."""
    dur = 0.6
    y = mixdown(
        pad(rasgueado(chord(["A3", "C4", "E4", "A4"]), 0.5, 0.9), dur),
        pad(guiro(0.6, 0.3, 10), dur),
        pad(cajon_bass(0.7), dur),
        surf(dur, 0.6, seamless=False) * np.linspace(0.2, 1.0, int(SR * dur)) ** 2,
    )
    return fade(normalize(y, 0.72))


def sfx_reel_stop():
    """Кахон: низ ладонью плюс сухой щелчок по краю."""
    dur = 0.28
    y = mixdown(
        pad(cajon_bass(0.9), dur),
        pad(cajon_slap(0.5), dur),
        pad(conga(240, 0.2, 0.35, open_tone=False), dur),
    )
    return fade(normalize(y, 0.75))


def sfx_symbol_land():
    return fade(normalize(conga(300, 0.16, 0.5, open_tone=False), 0.45))


def sfx_anticipation():
    """
    Нарастание перед возможным скаттером.

    Ускоряющаяся дробь конг плюс аккордеон, ползущий вверх по фригийскому
    ладу. Тот же приём, что у живого состава перед кульминацией: не
    «страшный» синтезаторный райзер, а ускорение и повышение.
    """
    dur = 1.8
    x = t(dur)

    # ВНИМАНИЕ: шагу нужен нижний предел. Без него шаг убывает
    # геометрически, сумма сходится к конечному пределу, и цикл никогда
    # не доходит до конца клипа — сборка просто виснет навсегда.
    MIN_STEP = 0.045
    roll = np.zeros(int(SR * dur))
    step = 0.19
    pos = 0.0
    i = 0
    while pos < dur - 0.08:
        add_at(roll, conga(200 + 14 * i, 0.18, 0.5 + 0.5 * pos / dur, open_tone=False), pos)
        add_at(roll, shaker(0.4 + 0.4 * pos / dur), pos)
        step = max(MIN_STEP, step * 0.87)
        pos += step
        i += 1

    # E — F — G# — A: фригийский доминантовый подъём к тонике.
    swell = np.zeros(int(SR * dur))
    for k, name in enumerate(["E4", "F4", "G#4", "A4"]):
        add_at(swell, accordion(nf(name), 0.55, 0.5 + 0.22 * k), 0.28 * k)

    y = mixdown(roll, swell, surf(dur, 0.5, seamless=False) * np.linspace(0.2, 1, len(x)))
    return fade(normalize(reverb(y, 1.0, 0.2), 0.72), 0.01, 0.05)


def sfx_scatter():
    """Приземление скаттера: колокол, а поверх — чайка. Курортный акцент."""
    y = mixdown(
        bell(nf("A5"), 0.9, 1.2, 0.6),
        bell(nf("E6"), 0.8, 1.0, 0.32),
        pad(vibraphone(nf("A6"), 0.7, 0.35), 0.9),
        pad(gull(0.5, calls=1), 0.9),
    )
    return fade(normalize(reverb(y, 1.4, 0.3), 0.8))


def arp(names, note=0.09, dur_total=None, inst=nylon, amp=1.0, tail=0.6):
    total = dur_total or (note * len(names) + tail)
    y = np.zeros(int(SR * total))
    for i, name in enumerate(names):
        length = min(tail + 0.2, total - i * note)
        if length <= 0.02:
            continue
        add_at(y, inst(nf(name), length, amp=amp), i * note)
    return y


# Ля-фригийский доминантовый: A B♭ C# D E F G. Тот самый «южный» лад.
PHRYG = ["A4", "Bb4", "C#5", "D5", "E5", "F5", "G5", "A5", "C#6", "E6"]

# ─────────────────── о гармонии выигрышей ────────────────────
#
# Музыка игры — в ля миноре, но выигрыш на фригийском ладу звучал бы
# тревожно: тот же оборот, который делает тему южной, в отрыве от
# ритма читается как напряжение, а не как награда.
#
# Поэтому выигрыши строятся на ля-минорной пентатонике с опорой
# на до мажор — параллельный мажор той же тональности. Он полностью
# созвучен подложке, но звучит светло. Восходящее движение
# обязательно: слух воспринимает подъём как «стало лучше»,
# и это работает даже на трёх нотах.
PENTA = ["A4", "C5", "D5", "E5", "G5", "A5", "C6", "D6", "E6", "G6"]
CMAJ = ["C3", "E3", "G3", "B3"]


def sfx_win_small():
    """Мелкий выигрыш: три ноты вверх. Короткий, светлый, без пафоса."""
    dur = 0.85
    y = mixdown(
        arp(PENTA[:3], 0.075, dur, inst=celesta, amp=0.85, tail=0.7),
        arp(PENTA[:3], 0.075, dur, inst=nylon, amp=0.45, tail=0.5),
        # Верхний призвук нужен и здесь: без него мелкий выигрыш звучит
        # глухо и не связывается на слух со средним и крупным.
        pad(glass(nf("A5"), 0.6, 0.2), dur),
        pad(shaker(0.28), dur),
    )
    return fade(normalize(reverb(y, 1.1, 0.30), 0.72))


def sfx_win_medium():
    """
    Средний выигрыш: пробежка на октаву с добавленной верхней квинтой.

    Челеста ведёт, гитара подпирает снизу, вибрафон ставит точку.
    Верхняя «пыльца» — отдельным слоем: именно она и создаёт то самое
    ощущение, ради которого выигрыш хочется слушать ещё раз.
    """
    dur = 1.35
    y = mixdown(
        arp(PENTA[:6], 0.07, dur, inst=celesta, amp=0.9, tail=0.9),
        arp(PENTA[:4], 0.07, dur, inst=nylon, amp=0.4, tail=0.6),
        pad(vibraphone(nf("C6"), 1.0, 0.4), dur),
        pad(glass(nf("E6"), 0.9, 0.22), dur),
        pad(shaker(0.32), dur),
        pad(conga(nf("A3"), 0.24, 0.28), dur),
    )
    return fade(normalize(reverb(y, 1.3, 0.32), 0.78))


def sfx_win_big():
    """
    Крупный выигрыш: каскад на две октавы, аккорд до мажор всем составом.

    Здесь важен низ. Одни колокольчики сверху звучат тонко и дёшево;
    хоровая подушка и суб-нота дают основание, на котором каскад
    воспринимается как событие, а не как трель.
    """
    dur = 2.4
    y = np.zeros(int(SR * dur))

    add_at(y, arp(PENTA, 0.058, 1.9, inst=celesta, amp=0.95, tail=1.1), 0.0)
    add_at(y, arp(PENTA[2:], 0.058, 1.4, inst=vibraphone, amp=0.4, tail=0.8), 0.12)
    add_at(y, choir(chord(["C4", "E4", "G4"]), 1.9, 0.7), 0.06)
    add_at(y, mixdown(*[flugel(nf(n), 1.5, 0.7) for n in ["C4", "E4", "G4"]]), 0.06)
    add_at(y, sub_swell(nf("C2"), 1.6, 0.8), 0.0)
    add_at(y, cajon_bass(0.85), 0.0)
    add_at(y, guiro(0.45, 0.5, 18), 0.05)
    for i, n in enumerate(["C6", "E6", "G6"]):
        add_at(y, glass(nf(n), 1.2, 0.3), 0.55 + i * 0.18)

    return fade(normalize(reverb(y, 1.7, 0.34), 0.88))


# Ноты, по которым «настроены» монеты. Случайный звон — это шум;
# звон по пентатонике складывается в переливы и слушается как музыка.
COIN_NOTES = ["C6", "D6", "E6", "G6", "A6", "C7", "D7", "E7"]


def sfx_coins():
    """
    Россыпь монет.

    Ключевая правка против прежней версии: высота каждой монеты берётся
    не случайным числом из диапазона, а из пентатоники. Случайные частоты
    дают дребезг кассового аппарата, настроенные — перелив, который
    хочется дослушать. Разница слышна с первой секунды.
    """
    dur = 1.7
    y = np.zeros(int(SR * dur))
    pos = 0.0
    while pos < dur - 0.25:
        f = nf(COIN_NOTES[rng.integers(0, len(COIN_NOTES))])
        amp = rng.uniform(0.35, 0.85)
        add_at(y, metallic_clink(0.18, f, amp * 0.55), pos)
        # Половина монет получает мягкий колокольчик той же высоты:
        # он смягчает металл и связывает россыпь в аккорд.
        if rng.random() < 0.5:
            add_at(y, celesta(f, 0.5, amp * 0.5), pos)
        pos += rng.uniform(0.03, 0.08) * (1 + pos * 0.8)
    y = mixdown(y, pad(guiro(0.35, 0.5, 16), dur))
    return fade(normalize(reverb(y, 1.2, 0.26), 0.74))


def sfx_fanfare():
    """
    Фанфара самого крупного выигрыша.

    Здесь сознательно уходим из андалузской каденции в светлый оборот
    C — G — Am — F с возвратом в C. Причина простая: минорный оборот,
    который делает тему южной, в роли награды читается как тревога.
    Игрок, сорвавший максимум, должен услышать, что случилось
    хорошее, а не что что-то надвигается.
    Тональность общая с музыкой (до мажор — параллельный ля минору),
    поэтому переход обратно в тему не режет слух.
    """
    dur = 3.4
    beat = 0.6
    prog = [
        (["C4", "E4", "G4"], "C2"),
        (["G3", "B3", "D4"], "G2"),
        (["A3", "C4", "E4"], "A2"),
        (["F3", "A3", "C4"], "F2"),
        (["C4", "E4", "G4"], "C2"),
    ]

    horns = np.zeros(int(SR * dur))
    bass = np.zeros(int(SR * dur))
    pad_ = np.zeros(int(SR * dur))
    guitars = np.zeros(int(SR * dur))
    for i, (notes, root) in enumerate(prog):
        at = i * beat
        last = i == len(prog) - 1
        length = beat * (2.8 if last else 1.05)
        add_at(horns, mixdown(*[flugel(nf(n), length, 0.9, bright=1.25) for n in notes]), at)
        add_at(bass, upright_bass(nf(root), length, 0.95), at)
        add_at(pad_, choir([nf(n) for n in notes], length, 0.65), at)
        add_at(guitars, rasgueado(chord(notes), min(length, 0.5), 0.7), at)

    perc = np.zeros(int(SR * dur))
    steps = int(dur / (beat / 2))
    for i in range(steps):
        at = i * beat / 2
        add_at(perc, cajon_bass(0.7) if i % 4 == 0 else cajon_slap(0.45), at)
        add_at(perc, shaker(0.3), at)
    for i in range(len(prog)):
        add_at(perc, clave(0.5), i * beat)

    # Каскад челесты на разрешении: то, что слышно последним.
    shimmer = np.zeros(int(SR * dur))
    add_at(shimmer, arp(PENTA + PENTA[4:], 0.055, 1.9, inst=celesta, amp=0.75, tail=1.0),
           beat * (len(prog) - 1))
    add_at(shimmer, sub_swell(nf("C2"), 1.6, 0.7), beat * (len(prog) - 1))

    y = mixdown(horns * 0.9, bass, pad_, guitars * 0.7, perc * 0.75, shimmer)
    return fade(normalize(reverb(y, 2.0, 0.34), 0.92))


def sfx_freespins():
    """Запуск фриспинов: аккордеонный разлив, вибрафон и накат волны."""
    dur = 2.5
    swell = np.zeros(int(SR * dur))
    for k, name in enumerate(["A3", "C4", "E4", "A4"]):
        add_at(swell, accordion(nf(name), 1.5 - 0.12 * k, 0.85), 0.1 * k)

    bells = arp(["A5", "C6", "E6", "A6"], 0.13, 1.4, inst=vibraphone, amp=0.55)

    y = np.zeros(int(SR * dur))
    add_at(y, surf(1.3, 0.9, seamless=False) * np.linspace(0.15, 1, int(SR * 1.3)) ** 2, 0.0)
    add_at(y, guiro(0.5, 0.6, 20), 0.5)
    add_at(y, swell, 1.05)
    add_at(y, bells, 1.05)
    add_at(y, cajon_bass(0.9), 1.05)
    add_at(y, gull(0.45, calls=2), 1.7)
    return fade(normalize(reverb(y, 1.6, 0.3), 0.88))


def sfx_win_count_tick():
    """
    Тик счётчика выигрыша.

    Он звучит десятками подряд, пока крутится сумма, и игра поднимает
    ему высоту по ходу счёта. Поэтому это мягкий колокольчик, а не
    деревянный щелчок: щелчок на тридцатом повторе раздражает, а
    восходящий звон читается как нарастание — то самое, что и нужно.
    """
    dur = 0.18
    y = celesta(nf("E6"), dur, 0.6, bright=0.7)
    return fade(normalize(y, 0.3), 0.001, 0.05)


def sfx_transition():
    """Смена режима: волна накатывает и уходит, поверх — шейкер."""
    dur = 1.1
    wave = surf(dur, 1.0, seamless=False)
    wave *= np.concatenate([
        np.linspace(0.1, 1.0, int(SR * 0.45)) ** 1.6,
        np.linspace(1.0, 0.05, int(SR * dur) - int(SR * 0.45)) ** 1.2,
    ])
    y = mixdown(wave, pad(guiro(0.5, 0.7, 22), dur), pad(cajon_bass(0.6), dur))
    return fade(normalize(reverb(y, 1.0, 0.25), 0.7))


def sfx_gull():
    """Фоновая чайка — игра пускает её изредка поверх музыки."""
    return fade(normalize(gull(1.0, calls=rng.integers(2, 4)), 0.4), 0.02, 0.08)


def sfx_wave():
    """Одиночный накат — вторая фоновая краска, реже и тише чайки."""
    dur = 2.2
    y = surf(dur, 1.0, seamless=False)
    y *= np.concatenate([
        np.linspace(0.05, 1.0, int(SR * 0.9)) ** 2,
        np.linspace(1.0, 0.02, int(SR * dur) - int(SR * 0.9)) ** 1.4,
    ])
    return fade(normalize(y, 0.42), 0.05, 0.25)


# ──────────────────────────────── музыка ──────────────────────────────

# Андалузская каденция. Мажорная терция в последнем аккорде (G#, A)
# и даёт фригийский доминантовый лад — ту самую «южную» краску.
PROG_BASE = [
    (["A3", "C4", "E4"], "A2"),      # Am
    (["G3", "B3", "D4"], "G2"),      # G
    (["F3", "A3", "C4"], "F2"),      # F
    (["E3", "G#3", "B3"], "E2"),     # E  ← мажор, не минор
]

# Та же каденция квартой выше: Dm — C — B♭ — A.
# Аккорды сознательно оставлены октавой выше базовой темы — это и даёт
# ощущение подъёма при входе в бонус. Бас, наоборот, уведён вниз: без
# него светлая гармония повисает в воздухе и тема звучит худосочно.
PROG_FREE = [
    (["D4", "F4", "A4"], "D3"),
    (["C4", "E4", "G4"], "C3"),
    (["Bb3", "D4", "F4"], "Bb2"),
    (["A3", "C#4", "E4"], "A2"),
]

# Мелодия: (доля от начала петли, нота, длительность в долях).
MELODY_BASE = [
    (0.0, "E5", 1.0), (1.0, "D5", 0.5), (1.5, "C5", 0.5), (2.0, "B4", 1.5),
    (4.0, "C5", 1.0), (5.0, "B4", 0.5), (5.5, "A4", 1.5),
    (8.0, "A4", 0.5), (8.5, "C5", 0.5), (9.0, "F5", 1.5), (11.0, "E5", 1.0),
    (12.0, "E5", 0.5), (12.5, "F5", 0.5), (13.0, "G#5", 1.0), (14.0, "E5", 2.0),

    (16.0, "A5", 1.0), (17.0, "G5", 0.5), (17.5, "E5", 0.5), (18.0, "C5", 1.5),
    (20.0, "D5", 1.0), (21.0, "B4", 1.0), (22.0, "G4", 1.0),
    (24.0, "F5", 0.5), (24.5, "E5", 0.5), (25.0, "C5", 1.0), (26.0, "A4", 1.5),
    (28.0, "B4", 0.5), (28.5, "C5", 0.5), (29.0, "G#4", 1.0), (30.0, "A4", 2.0),
]

MELODY_FREE = [
    (0.0, "A5", 1.0), (1.0, "G5", 0.5), (1.5, "F5", 0.5), (2.0, "E5", 1.5),
    (4.0, "F5", 1.0), (5.0, "E5", 0.5), (5.5, "D5", 1.5),
    (8.0, "D5", 0.5), (8.5, "F5", 0.5), (9.0, "Bb5", 1.5), (11.0, "A5", 1.0),
    (12.0, "A5", 0.5), (12.5, "Bb5", 0.5), (13.0, "C#6", 1.0), (14.0, "A5", 2.0),

    (16.0, "D6", 1.0), (17.0, "C6", 0.5), (17.5, "A5", 0.5), (18.0, "F5", 1.5),
    (20.0, "G5", 1.0), (21.0, "E5", 1.0), (22.0, "C5", 1.0),
    (24.0, "Bb5", 0.5), (24.5, "A5", 0.5), (25.0, "F5", 1.0), (26.0, "D5", 1.5),
    (28.0, "E5", 0.5), (28.5, "F5", 0.5), (29.0, "C#5", 1.0), (30.0, "D5", 2.0),
]

# Сон-клаве 3-2, позиции в восьмых внутри двухтактового круга.
CLAVE_32 = [0, 3, 6, 10, 12]


def build_music(theme="base", return_stems=False):
    """
    Зацикленная тема. Румба, 100 BPM, 8 тактов по 4 доли = 19.2 секунды.

    Длина выбрана не «на глаз»: восемь тактов — это два полных круга
    андалузской каденции, поэтому петля замыкается на гармонически
    правильном месте и стык не слышен даже без кроссфейда.
    """
    bpm = 100.0
    beat = 60.0 / bpm
    bar = beat * 4
    bars = 8
    dur = bar * bars
    n = int(SR * dur)

    night = theme != "base"
    prog = PROG_FREE if night else PROG_BASE
    melody = MELODY_FREE if night else MELODY_BASE

    def at(b):
        """Доля → секунды."""
        return b * beat

    guitars = np.zeros(n)
    bassline = np.zeros(n)
    reeds = np.zeros(n)
    perc = np.zeros(n)
    lead = np.zeros(n)

    for b in range(bars):
        notes, root = prog[b % len(prog)]
        base_beat = b * 4

        # ── гитара: перебор на раз и расгеадо на слабые доли ──────────
        add_at(guitars, guitar_chord(chord(notes), bar * 0.9, 0.55), at(base_beat))
        for off in (1.5, 2.5, 3.5):
            add_at(guitars, rasgueado(chord(notes), beat * 0.8, 0.34), at(base_beat + off))

        # ── контрабас: тумбао — раз и «и-четыре» ──────────────────────
        # Основная октава плюс подоктава потише. Одна нижняя октава
        # звучит внушительно в наушниках и пропадает на телефоне: 55 Гц
        # динамик просто не воспроизводит. Пара октав слышна везде.
        rf = nf(root)
        for f, a in ((rf, 0.9), (rf / 2, 0.4)):
            add_at(bassline, upright_bass(f, beat * 1.4, a), at(base_beat))
            add_at(bassline, upright_bass(f, beat * 0.9, a * 0.78), at(base_beat + 3.5))
        add_at(bassline, upright_bass(nf(notes[2]) / 2, beat * 0.9, 0.55), at(base_beat + 2.5))

        # ── аккордеон: подушка, во второй половине темы громче ────────
        amp = 0.5 if b < 4 else 0.72
        for k, name in enumerate(notes):
            # Ночью аккордеон уходит октавой ниже и работает подушкой:
            # в написанной октаве он лезет ровно туда, где ведёт вибрафон,
            # и вся тема сбивается в один гулкий диапазон.
            f = nf(name) / (2 if night else 1)
            add_at(reeds, accordion(f, bar * 0.95, amp * (1 - 0.12 * k)),
                   at(base_beat) + 0.012 * k)

    # ── перкуссия ────────────────────────────────────────────────────
    eighth = beat / 2
    for i in range(bars * 8):
        pos = at(i * 0.5)
        step = i % 8

        if step == 0:
            add_at(perc, cajon_bass(0.8), pos)
        elif step == 4:
            add_at(perc, cajon_bass(0.5), pos)
        if step in (3, 6):
            add_at(perc, (brush(0.85) if night else cajon_slap(0.6)), pos)

        add_at(perc, shaker(0.3 if step % 2 == 0 else 0.19), pos)

        if not night and (i % 16) in CLAVE_32:
            add_at(perc, clave(0.42), pos)

        if step in (2, 5, 7):
            add_at(perc, conga(nf("A3") if step == 7 else nf("E3"),
                               0.24, 0.3, open_tone=(step == 7)), pos)

    for b in range(0, bars, 4):
        add_at(perc, guiro(0.3, bar * 0.5, 16), at(b * 4 + 3))

    # ── мелодия ──────────────────────────────────────────────────────
    for start, name, length in melody:
        f = nf(name)
        seconds = length * beat
        if night:
            # Ночью ведёт вибрафон, флюгельгорн держит второй голос октавой ниже.
            add_at(lead, vibraphone(f, min(seconds * 1.6, 1.6), 0.3), at(start))
            add_at(lead, flugel(f / 2, seconds * 0.95, 0.3), at(start))
        else:
            add_at(lead, nylon(f, min(seconds * 1.5, 1.4), 0.85, bright=1.1), at(start))
            if length >= 1.0:
                add_at(lead, flugel(f, seconds * 0.9, 0.34), at(start) + 0.02)

    # ── море ─────────────────────────────────────────────────────────
    # Прибой — подложка, а не инструмент. Громче этого он перестаёт быть
    # морем и становится шипением ленты под музыкой.
    sea = surf(dur, 0.24 if night else 0.30)

    # Уровни выставлены по замеру стемов, а не на глаз: гармоническая
    # подушка (гитара и аккордеон) изначально сидела на 10 дБ ниже
    # мелодии и перкуссии, из-за чего тема звучала как соло под метроном.
    music = mixdown(
        guitars * 1.55,
        bassline * 1.1,
        reeds * (1.45 if night else 1.3),
        perc * (0.95 if night else 0.85),
        lead * (0.85 if night else 1.15),
        sea,
    )

    music = reverb(music, 1.6 if night else 1.1, 0.24 if night else 0.17)
    if return_stems:
        # Диагностика сведения: без разбора по партиям невозможно понять,
        # какая из них съедает диапазон — на слух и по общему спектру
        # это только гадание.
        return {"гитара": guitars * 1.55, "бас": bassline * 1.1,
                "аккордеон": reeds * (1.45 if night else 1.3),
                "перкуссия": perc * (0.95 if night else 0.85),
                "мелодия": lead * (0.85 if night else 1.15), "море": sea}

    music = mix_bus(music, air=3.0, mud=-3.0)

    # Выравнивание по громкости, а не по пику. Ночная тема плотнее
    # базовой: при нормализации по пику она получается заметно громче,
    # и переход в бонус звучит как скачок уровня, а не как смена темы.
    TARGET_RMS = 0.075
    music *= TARGET_RMS / (np.sqrt((music ** 2).mean()) or 1.0)
    peak = np.max(np.abs(music)) or 1.0
    if peak > 0.85:
        music *= 0.85 / peak

    # Кроссфейд «хвоста» в начало — страховка от щелчка на стыке петли.
    xf = int(SR * 0.12)
    music[:xf] = music[:xf] * np.linspace(0, 1, xf) + music[-xf:] * np.linspace(1, 0, xf)
    return music[:-xf]


# ────────────────────────────── экспорт ───────────────────────────────

def to_int16(x):
    return np.clip(x, -1, 1)


def write_wav(path, mono, stereo_width=0.0):
    import wave
    if stereo_width > 0:
        delay = int(SR * 0.008 * stereo_width)
        left = np.concatenate([mono, np.zeros(delay)])
        right = np.concatenate([np.zeros(delay), mono])
        data = np.stack([left, right], axis=1)
    else:
        data = np.stack([mono, mono], axis=1)
    pcm = (to_int16(data) * 32767).astype(np.int16)
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def encode(src_wav, dst_base):
    """WebM/Opus — основной формат, MP3 — резерв для старых iOS."""
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", src_wav,
         "-c:a", "libopus", "-b:a", "96k", "-vbr", "on", f"{dst_base}.webm"],
        check=True)
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", src_wav,
         "-c:a", "libmp3lame", "-q:a", "4", f"{dst_base}.mp3"],
        check=True)


SFX = [
    ("click", sfx_click),
    ("button", sfx_button),
    ("error", sfx_error),
    ("spin_start", sfx_spin_start),
    ("reel_stop", sfx_reel_stop),
    ("symbol_land", sfx_symbol_land),
    ("anticipation", sfx_anticipation),
    ("scatter", sfx_scatter),
    ("win_small", sfx_win_small),
    ("win_medium", sfx_win_medium),
    ("win_big", sfx_win_big),
    ("coins", sfx_coins),
    ("fanfare", sfx_fanfare),
    ("freespins", sfx_freespins),
    ("tick", sfx_win_count_tick),
    ("transition", sfx_transition),
    ("gull", sfx_gull),
    ("wave", sfx_wave),
]

GAP = 0.25   # тишина между эффектами: страхует от «наезда» при неточном seek


def main():
    os.makedirs(OUT, exist_ok=True)

    print("→ SFX")
    clips = []
    sprite = {}
    cursor = 0.0
    for name, fn in SFX:
        y = fn()
        dur = len(y) / SR
        sprite[name] = [round(cursor * 1000), round(dur * 1000)]
        clips.append(y)
        clips.append(np.zeros(int(SR * GAP)))
        cursor += dur + GAP
        print(f"   {name:<14} {dur:5.2f} с")

    # Общий запас по уровню: Opus/MP3 дают интерсэмпловые выбросы,
    # и спрайт, сведённый «в потолок», начинает клиппировать после кодирования.
    sprite_audio = normalize(np.concatenate(clips), 0.75)
    wav = os.path.join(OUT, "_sfx.wav")
    write_wav(wav, sprite_audio)
    encode(wav, os.path.join(OUT, "sfx"))
    os.remove(wav)

    with open(os.path.join(OUT, "sfx.json"), "w") as f:
        json.dump({"sprite": sprite}, f, indent=2)

    for theme, fname in (("base", "music_base"), ("free", "music_free")):
        print(f"→ музыка {theme}")
        m = build_music(theme)
        wav = os.path.join(OUT, f"_{fname}.wav")
        write_wav(wav, m, stereo_width=0.6)
        encode(wav, os.path.join(OUT, fname))
        os.remove(wav)
        print(f"   {len(m) / SR:.2f} с петля")

    total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
    print(f"✓ звук готов, {total / 1024:.0f} КБ")


if __name__ == "__main__":
    main()
