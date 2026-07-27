// Тексты игры.
//
// Половина строк одинакова у любого слота, половина описывает именно эту
// тему: имена символов, правила про диких на 2, 3 и 4 барабанах, название
// заведения. Разделять их по двум файлам смысла нет — переводчику нужен
// один список, а слот всё равно получает словарь параметром.
//
// Добавление языка = добавление объекта в strings и в symbols.

export const strings = {
  ru: {
    loading: "ЗАГРУЗКА",
    loadingAssets: "Загрузка графики…",
    loadingAudio: "Загрузка звука…",
    loadingConnect: "Соединение с сервером…",
    tapToStart: "НАЖМИТЕ, ЧТОБЫ НАЧАТЬ",

    balance: "БАЛАНС",
    bet: "СТАВКА",
    win: "ВЫИГРЫШ",
    totalWin: "ОБЩИЙ ВЫИГРЫШ",
    credit: "КРЕДИТ",

    spin: "КРУТИТЬ",
    stop: "СТОП",
    auto: "АВТО",
    turbo: "ТУРБО",

    freeSpins: "ФРИСПИНЫ",
    freeSpinsLeft: "ОСТАЛОСЬ",
    freeSpinsWon: "ВЫ ВЫИГРАЛИ",
    freeSpinsCount: (n) => `${n} ФРИСПИНОВ`,
    freeSpinsEnd: "ФРИСПИНЫ ЗАВЕРШЕНЫ",
    retrigger: (n) => `+${n} ФРИСПИНОВ`,
    totalBonusWin: "ВЫИГРЫШ В БОНУСЕ",

    bigWin: "БОЛЬШОЙ ВЫИГРЫШ",
    megaWin: "МЕГА ВЫИГРЫШ",
    epicWin: "ЭПИЧЕСКИЙ ВЫИГРЫШ",

    paytable: "ТАБЛИЦА ВЫПЛАТ",
    paylines: "ЛИНИИ ВЫПЛАТ",
    rules: "ПРАВИЛА",
    history: "ИСТОРИЯ",
    close: "ЗАКРЫТЬ",
    settings: "НАСТРОЙКИ",

    autoplayTitle: "АВТОИГРА",
    autoplaySpins: "КОЛИЧЕСТВО СПИНОВ",
    autoplayStart: "СТАРТ",
    autoplayStop: "ОСТАНОВИТЬ АВТОИГРУ",
    autoplayUntilFeature: "Останавливать при бонусе",
    autoplayLossLimit: "ОСТАНОВИТЬ ПРИ ПРОИГРЫШЕ",
    autoplayWinLimit: "ОСТАНОВИТЬ ПРИ ВЫИГРЫШЕ ОТ",
    autoplayNoLimit: "БЕЗ ЛИМИТА",
    autoplayStoppedLoss: (n) => `Автоигра остановлена: проигрыш достиг ${n}`,
    autoplayStoppedWin: (n) => `Автоигра остановлена: выигрыш ${n}`,
    autoplayStoppedFeature: "Автоигра остановлена: выпал бонус",
    autoplayLimitsNote: "Лимиты считаются от начала серии автоигры.",

    roundDetails: "РАУНД",
    roundBack: "К СПИСКУ",
    roundId: "Номер раунда",
    roundAt: "Время",
    roundSpin: "Спин",
    roundBaseSpin: "Базовый спин",
    roundFreeSpin: "Фриспин",
    roundNoWin: "Без выигрыша",
    roundLine: (n) => `Линия ${n + 1}`,
    roundScatterWin: "Скаттеры",
    roundRngDraws: "Обращений к ГПСЧ",
    roundCapped: "Выплата ограничена максимумом",
    roundTapHint: "Нажмите на строку, чтобы посмотреть раунд",
    roundLoadFailed: "Не удалось загрузить раунд",

    insufficientFunds: "Недостаточно средств",
    connectionLost: "Соединение потеряно. Пробуем восстановить…",
    connectionRestored: "Соединение восстановлено",
    roundInProgress: "Завершите текущий раунд",
    genericError: "Что-то пошло не так",
    retry: "ПОВТОРИТЬ",

    sessionClosed: "Сессия закрыта оператором",
    maintenance: "Идут технические работы",
    realityCheck: "Напоминание: вы играете уже некоторое время",

    introPlay: "ИГРАТЬ",
    introRtp: "Возврат игроку (RTP)",
    introMaxWin: "Максимальный выигрыш",
    introVolatility: "Волатильность",
    introSkip: "Больше не показывать",

    demoMode: "ДЕМО-РЕЖИМ",
    rtpNote: (rtp) => `Теоретический возврат игроку: ${rtp}%`,
    maxWinNote: (x) => `Максимальный выигрыш: ${x}× от ставки`,
    wildNote: "Заменяет все символы, кроме СКАТТЕРА. Появляется на 2, 3 и 4 барабанах.",
    scatterNote: "3 и более СКАТТЕРОВ в любом месте запускают фриспины.",
    wildMultNote: "Во фриспинах каждый дикий в выигрышной линии даёт множитель ×2 или ×3.",
    linesNote: "Выплаты идут слева направо по активным линиям, начиная с первого барабана.",
    malfunctionNote: "Сбой аннулирует все выплаты и розыгрыши."
  },

  en: {
    loading: "LOADING",
    loadingAssets: "Loading graphics…",
    loadingAudio: "Loading audio…",
    loadingConnect: "Connecting…",
    tapToStart: "TAP TO START",

    balance: "BALANCE",
    bet: "BET",
    win: "WIN",
    totalWin: "TOTAL WIN",
    credit: "CREDIT",

    spin: "SPIN",
    stop: "STOP",
    auto: "AUTO",
    turbo: "TURBO",

    freeSpins: "FREE SPINS",
    freeSpinsLeft: "LEFT",
    freeSpinsWon: "YOU WON",
    freeSpinsCount: (n) => `${n} FREE SPINS`,
    freeSpinsEnd: "FREE SPINS COMPLETE",
    retrigger: (n) => `+${n} FREE SPINS`,
    totalBonusWin: "BONUS WIN",

    bigWin: "BIG WIN",
    megaWin: "MEGA WIN",
    epicWin: "EPIC WIN",

    paytable: "PAYTABLE",
    paylines: "PAYLINES",
    rules: "RULES",
    history: "HISTORY",
    close: "CLOSE",
    settings: "SETTINGS",

    autoplayTitle: "AUTOPLAY",
    autoplaySpins: "NUMBER OF SPINS",
    autoplayStart: "START",
    autoplayStop: "STOP AUTOPLAY",
    autoplayUntilFeature: "Stop on feature",
    autoplayLossLimit: "STOP ON LOSS OF",
    autoplayWinLimit: "STOP ON SINGLE WIN OF",
    autoplayNoLimit: "NO LIMIT",
    autoplayStoppedLoss: (n) => `Autoplay stopped: loss reached ${n}`,
    autoplayStoppedWin: (n) => `Autoplay stopped: win of ${n}`,
    autoplayStoppedFeature: "Autoplay stopped: feature triggered",
    autoplayLimitsNote: "Limits are counted from the start of the autoplay session.",

    roundDetails: "ROUND",
    roundBack: "BACK TO LIST",
    roundId: "Round id",
    roundAt: "Time",
    roundSpin: "Spin",
    roundBaseSpin: "Base spin",
    roundFreeSpin: "Free spin",
    roundNoWin: "No win",
    roundLine: (n) => `Line ${n + 1}`,
    roundScatterWin: "Scatters",
    roundRngDraws: "RNG draws",
    roundCapped: "Payout capped at the maximum",
    roundTapHint: "Tap a row to inspect the round",
    roundLoadFailed: "Could not load the round",

    insufficientFunds: "Insufficient funds",
    connectionLost: "Connection lost. Reconnecting…",
    connectionRestored: "Connection restored",
    roundInProgress: "Finish the current round",
    genericError: "Something went wrong",
    retry: "RETRY",

    sessionClosed: "Session closed by the operator",
    maintenance: "Maintenance in progress",
    realityCheck: "Reminder: you have been playing for a while",

    introPlay: "PLAY",
    introRtp: "Return to player (RTP)",
    introMaxWin: "Maximum win",
    introVolatility: "Volatility",
    introSkip: "Don't show again",

    demoMode: "DEMO MODE",
    rtpNote: (rtp) => `Theoretical return to player: ${rtp}%`,
    maxWinNote: (x) => `Maximum win: ${x}× the bet`,
    wildNote: "Substitutes for all symbols except SCATTER. Appears on reels 2, 3 and 4.",
    scatterNote: "3 or more SCATTERS anywhere trigger free spins.",
    wildMultNote: "During free spins each wild in a winning line applies a ×2 or ×3 multiplier.",
    linesNote: "Wins pay left to right on active lines, starting from reel one.",
    malfunctionNote: "Malfunction voids all pays and plays."
  }
};

export const symbols = {
  ru: {
    anchor: "Якорь «Сочи»", icecream: "Мороженое", shashlik: "Шашлык",
    hat: "Шляпа", wine: "Вино и виноград",
    gem_red: "Красный", gem_amber: "Янтарь", gem_green: "Зелёный",
    gem_aqua: "Бирюза", gem_purple: "Фиолетовый",
    wild: "Дикий", scatter: "Скаттер"
  },
  en: {
    anchor: "Sochi Anchor", icecream: "Ice cream", shashlik: "Shashlik",
    hat: "Sun hat", wine: "Wine & grapes",
    gem_red: "Red", gem_amber: "Amber", gem_green: "Green",
    gem_aqua: "Aqua", gem_purple: "Purple",
    wild: "Wild", scatter: "Scatter"
  }
};
