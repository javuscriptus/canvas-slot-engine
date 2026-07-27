// Тексты темы «Неон».
//
// Не перевод «Сочи», а другой голос: короче, суше, с городской лексикой.
// Это тоже часть проверки сменяемости — если бы слот где-то подставлял
// свою формулировку, она бы здесь выделилась.

export const strings = {
  ru: {
    loading: "ЗАГРУЗКА",
    loadingAssets: "Готовим вывеску…",
    loadingAudio: "Настраиваем звук…",
    loadingConnect: "Выходим на связь…",
    tapToStart: "КАСНИТЕСЬ, ЧТОБЫ НАЧАТЬ",

    balance: "СЧЁТ",
    bet: "СТАВКА",
    win: "ВЫИГРЫШ",
    totalWin: "ВСЕГО",
    credit: "КРЕДИТ",

    spin: "ПУСК",
    stop: "СТОП",
    auto: "АВТО",
    turbo: "ТУРБО",

    freeSpins: "БЕСПЛАТНЫЕ",
    freeSpinsLeft: "ОСТАЛОСЬ",
    freeSpinsWon: "ВЫ ВЗЯЛИ",
    freeSpinsCount: (n) => `${n} БЕСПЛАТНЫХ`,
    freeSpinsEnd: "СЕРИЯ ОКОНЧЕНА",
    retrigger: (n) => `ЕЩЁ ${n}`,
    totalBonusWin: "ИТОГ СЕРИИ",

    bigWin: "КРУПНЫЙ ВЫИГРЫШ",
    megaWin: "ОГРОМНЫЙ ВЫИГРЫШ",
    epicWin: "НЕВЕРОЯТНЫЙ ВЫИГРЫШ",

    paytable: "ВЫПЛАТЫ",
    paylines: "ЛИНИИ",
    rules: "ПРАВИЛА",
    history: "ЖУРНАЛ",
    close: "ЗАКРЫТЬ",
    settings: "НАСТРОЙКИ",

    autoplayTitle: "АВТОРЕЖИМ",
    autoplaySpins: "СКОЛЬКО СПИНОВ",
    autoplayStart: "ПУСК",
    autoplayStop: "ОСТАНОВИТЬ",
    autoplayUntilFeature: "Стоп на бонусе",
    autoplayLossLimit: "СТОП ПРИ ПРОИГРЫШЕ",
    autoplayWinLimit: "СТОП ПРИ ВЫИГРЫШЕ ОТ",
    autoplayNoLimit: "БЕЗ ЛИМИТА",
    autoplayStoppedLoss: (n) => `Авторежим выключен: проигрыш ${n}`,
    autoplayStoppedWin: (n) => `Авторежим выключен: выигрыш ${n}`,
    autoplayStoppedFeature: "Авторежим выключен: бонус",
    autoplayLimitsNote: "Лимиты считаются от начала серии.",

    roundDetails: "РАУНД",
    roundBack: "НАЗАД",
    roundId: "Номер",
    roundAt: "Время",
    roundSpin: "Спин",
    roundBaseSpin: "Обычный спин",
    roundFreeSpin: "Бесплатный спин",
    roundNoWin: "Пусто",
    roundLine: (n) => `Линия ${n + 1}`,
    roundScatterWin: "Скаттеры",
    roundRngDraws: "Вызовов ГПСЧ",
    roundCapped: "Выплата упёрлась в потолок",
    roundTapHint: "Нажмите на строку — покажем раунд целиком",
    roundLoadFailed: "Раунд не открылся",

    insufficientFunds: "На счету не хватает",
    connectionLost: "Связь пропала. Восстанавливаем…",
    connectionRestored: "Связь есть",
    roundInProgress: "Сначала закончите раунд",
    genericError: "Что-то сломалось",
    retry: "ЕЩЁ РАЗ",

    sessionClosed: "Сессию закрыл оператор",
    maintenance: "Технические работы",
    realityCheck: "Вы играете уже некоторое время",

    introPlay: "ВКЛЮЧИТЬ",
    introRtp: "Возврат игроку (RTP)",
    introMaxWin: "Потолок выигрыша",
    introVolatility: "Разброс",
    introSkip: "Не показывать это снова",

    demoMode: "ДЕМО",
    rtpNote: (rtp) => `Теоретический возврат игроку: ${rtp}%`,
    maxWinNote: (x) => `Больше ${x}× от ставки за раунд не выплачивается`,
    wildNote: "ДИКИЙ заменяет любой символ, кроме СКАТТЕРА. Только барабаны 2, 3 и 4.",
    scatterNote: "Три СКАТТЕРА и больше в любом месте — бесплатные спины.",
    wildMultNote: "В бесплатных спинах каждый ДИКИЙ в линии умножает выплату на 2 или 3.",
    linesNote: "Линии считаются слева направо и только с первого барабана.",
    malfunctionNote: "Технический сбой аннулирует выплаты и розыгрыши."
  },

  en: {
    loading: "LOADING",
    loadingAssets: "Lighting the sign…",
    loadingAudio: "Tuning the sound…",
    loadingConnect: "Going online…",
    tapToStart: "TAP TO START",

    balance: "CREDIT",
    bet: "STAKE",
    win: "WIN",
    totalWin: "TOTAL",
    credit: "CREDIT",

    spin: "GO",
    stop: "STOP",
    auto: "AUTO",
    turbo: "TURBO",

    freeSpins: "FREE ROUNDS",
    freeSpinsLeft: "LEFT",
    freeSpinsWon: "YOU TOOK",
    freeSpinsCount: (n) => `${n} FREE ROUNDS`,
    freeSpinsEnd: "SERIES OVER",
    retrigger: (n) => `${n} MORE`,
    totalBonusWin: "SERIES TOTAL",

    bigWin: "BIG WIN",
    megaWin: "HUGE WIN",
    epicWin: "INSANE WIN",

    paytable: "PAYS",
    paylines: "LINES",
    rules: "RULES",
    history: "LOG",
    close: "CLOSE",
    settings: "SETTINGS",

    autoplayTitle: "AUTO MODE",
    autoplaySpins: "HOW MANY SPINS",
    autoplayStart: "GO",
    autoplayStop: "STOP",
    autoplayUntilFeature: "Stop on bonus",
    autoplayLossLimit: "STOP ON LOSS OF",
    autoplayWinLimit: "STOP ON WIN OF",
    autoplayNoLimit: "NO LIMIT",
    autoplayStoppedLoss: (n) => `Auto mode off: loss ${n}`,
    autoplayStoppedWin: (n) => `Auto mode off: win ${n}`,
    autoplayStoppedFeature: "Auto mode off: bonus",
    autoplayLimitsNote: "Limits count from the start of the series.",

    roundDetails: "ROUND",
    roundBack: "BACK",
    roundId: "Number",
    roundAt: "Time",
    roundSpin: "Spin",
    roundBaseSpin: "Normal spin",
    roundFreeSpin: "Free spin",
    roundNoWin: "Nothing",
    roundLine: (n) => `Line ${n + 1}`,
    roundScatterWin: "Scatters",
    roundRngDraws: "RNG calls",
    roundCapped: "Payout hit the ceiling",
    roundTapHint: "Tap a row — we will show the whole round",
    roundLoadFailed: "The round did not open",

    insufficientFunds: "Not enough credit",
    connectionLost: "Connection dropped. Reconnecting…",
    connectionRestored: "Back online",
    roundInProgress: "Finish the round first",
    genericError: "Something broke",
    retry: "AGAIN",

    sessionClosed: "The operator closed the session",
    maintenance: "Maintenance",
    realityCheck: "You have been playing for a while",

    introPlay: "SWITCH ON",
    introRtp: "Return to player (RTP)",
    introMaxWin: "Win ceiling",
    introVolatility: "Spread",
    introSkip: "Do not show this again",

    demoMode: "DEMO",
    rtpNote: (rtp) => `Theoretical return to player: ${rtp}%`,
    maxWinNote: (x) => `No more than ${x}× the stake is paid per round`,
    wildNote: "WILD replaces any symbol except SCATTER. Reels 2, 3 and 4 only.",
    scatterNote: "Three SCATTERS or more anywhere — free rounds.",
    wildMultNote: "In free rounds every WILD in a line multiplies the pay by 2 or 3.",
    linesNote: "Lines count left to right and only from the first reel.",
    malfunctionNote: "A malfunction voids pays and plays."
  }
};

/**
 * Имена символов. Атлас общий с «Сочи», а вот подписи — свои: у одной
 * и той же картинки в другой игре другое имя, и это ровно та часть,
 * которую тема обязана переопределять.
 */
export const symbols = {
  ru: {
    anchor: "Вывеска", icecream: "Автомат с мороженым", shashlik: "Гриль у дороги",
    hat: "Панама", wine: "Бар на углу",
    gem_red: "Алый", gem_amber: "Янтарь", gem_green: "Зелёный",
    gem_aqua: "Циан", gem_purple: "Пурпур",
    wild: "Дикий", scatter: "Скаттер"
  },
  en: {
    anchor: "Neon Sign", icecream: "Ice-cream Machine", shashlik: "Roadside Grill",
    hat: "Bucket Hat", wine: "Corner Bar",
    gem_red: "Scarlet", gem_amber: "Amber", gem_green: "Green",
    gem_aqua: "Cyan", gem_purple: "Purple",
    wild: "Wild", scatter: "Scatter"
  }
};
