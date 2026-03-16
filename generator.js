/**
 * Генератор однофразового абсурдного рефрейминга.
 *
 * Архитектура:
 *   1. Нормализация input
 *   2. Проверка безопасности (safety check)
 *   3. Выбор семейства шаблона (family) с учётом cooldown
 *   4. Выбор пакета мира (world pack), совместимого с семейством
 *   5. Заполнение слотов элементами из словарей
 *   6. Опциональная вставка матерного усилителя (amplifier)
 *   7. Сборка 20 кандидатов
 *   8. Упрощённый скоринг и выбор лучшего
 *   9. Обновление истории (cooldown) в localStorage
 */

// ─────────────────────────────────────────────
// 1. ЗАГРУЗКА ДАННЫХ
// ─────────────────────────────────────────────

let DATA = null;

async function loadData() {
  if (DATA) return DATA;
  const resp = await fetch('data.json');
  DATA = await resp.json();
  return DATA;
}

// ─────────────────────────────────────────────
// 2. ИСТОРИЯ / COOLDOWN
// ─────────────────────────────────────────────
// Храним в localStorage последние использованные элементы.
// Каждый элемент — объект { id, usedAt } где usedAt — порядковый
// номер генерации (не дата, а счётчик вызовов).

const HISTORY_KEY = 'reframing_history';
const MAX_HISTORY = 50;       // помним последние 50 генераций
const COOLDOWN_HARD = 3;      // элемент, использованный ≤3 генерации назад — штраф 0 (не выбираем)
const COOLDOWN_SOFT = 8;      // от 4 до 8 — сниженный вес
const COOLDOWN_PENALTY = 0.15; // множитель веса в мягком cooldown

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || { counter: 0, entries: [] };
  } catch {
    return { counter: 0, entries: [] };
  }
}

function saveHistory(history) {
  // Обрезаем до MAX_HISTORY
  if (history.entries.length > MAX_HISTORY) {
    history.entries = history.entries.slice(-MAX_HISTORY);
  }
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

/**
 * Возвращает множитель веса элемента с учётом cooldown.
 *   0   — элемент заблокирован (использован слишком недавно)
 *   0.15 — мягкий штраф
 *   1   — без штрафа
 */
function cooldownWeight(elementId, history) {
  const current = history.counter;
  for (let i = history.entries.length - 1; i >= 0; i--) {
    const entry = history.entries[i];
    if (entry.id === elementId) {
      const age = current - entry.usedAt;
      if (age <= COOLDOWN_HARD) return 0;
      if (age <= COOLDOWN_SOFT) return COOLDOWN_PENALTY;
      return 1;
    }
  }
  return 1; // не найден в истории — полный вес
}

function recordUsage(history, ids) {
  history.counter++;
  for (const id of ids) {
    history.entries.push({ id, usedAt: history.counter });
  }
}

// ─────────────────────────────────────────────
// 3. УТИЛИТЫ СЛУЧАЙНОГО ВЫБОРА
// ─────────────────────────────────────────────

/** Взвешенный случайный выбор из массива объектов с полем _weight */
function weightedRandom(items) {
  const total = items.reduce((s, it) => s + it._weight, 0);
  if (total === 0) return null;
  let r = Math.random() * total;
  for (const it of items) {
    r -= it._weight;
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

/** Простой случайный элемент */
function randomPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Перемешать массив (Fisher-Yates) */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─────────────────────────────────────────────
// 4. НОРМАЛИЗАЦИЯ INPUT
// ─────────────────────────────────────────────

function normalizeInput(raw) {
  let s = raw.trim();
  // Убрать множественные пробелы
  s = s.replace(/\s+/g, ' ');
  // Убрать точку / восклицательный / вопросительный в конце — мы сами поставим
  s = s.replace(/[.!?…]+$/, '').trim();
  // Первую букву в нижний регистр (если не аббревиатура),
  // потому что фраза будет внутри предложения в кавычках
  if (s.length > 1 && s[0] === s[0].toUpperCase() && s[1] === s[1].toLowerCase()) {
    s = s[0].toLowerCase() + s.slice(1);
  }
  return s;
}

// ─────────────────────────────────────────────
// 5. БЕЗОПАСНОСТЬ
// ─────────────────────────────────────────────

function checkSafety(input, data) {
  const lower = input.toLowerCase();
  const safety = data.slots.safety;

  for (const word of safety.stop_words) {
    if (lower.includes(word)) return 'stop';
  }
  for (const word of safety.hate_markers) {
    if (lower.includes(word)) return 'hate';
  }
  return 'ok';
}

function safeFallback(input, data) {
  const templates = data.slots.safety.safe_fallback_templates;
  return randomPick(templates).replace('{input}', input);
}

// ─────────────────────────────────────────────
// 6. ВЫБОР СЕМЕЙСТВА И ПАКЕТА МИРА
// ─────────────────────────────────────────────

function pickFamily(data, history) {
  const families = data.families.map(f => ({
    ...f,
    _weight: (f.weight || 1) * cooldownWeight(f.id, history)
  }));
  return weightedRandom(families) || randomPick(data.families);
}

function pickWorldPack(data, family, history, profanityLevel) {
  const compatible = data.world_packs
    .filter(wp => family.compatible_packs.includes(wp.id))
    .filter(wp => profanityLevel >= wp.profanity_range[0] && profanityLevel <= wp.profanity_range[1])
    .map(wp => ({
      ...wp,
      _weight: cooldownWeight(wp.id, history)
    }));
  return weightedRandom(compatible) || randomPick(data.world_packs.filter(wp => family.compatible_packs.includes(wp.id)));
}

// ─────────────────────────────────────────────
// 7. ЗАПОЛНЕНИЕ СЛОТОВ
// ─────────────────────────────────────────────

/**
 * Для данного слота возвращает подходящий элемент из словаря.
 * Учитывает:
 *   - теги совместимости пакета мира (preferred_slots)
 *   - profanity_level (не берём слишком грубые элементы)
 *   - cooldown
 */
function pickSlot(slotName, data, worldPack, history, profanityLevel, gender) {
  const dict = data.slots[slotName];
  if (!dict || !Array.isArray(dict)) return null;

  // Какие теги предпочитает пакет мира для этого слота
  const preferredTags = (worldPack.preferred_slots && worldPack.preferred_slots[slotName]) || [];

  const candidates = dict.map(el => {
    let w = 1.0;

    // Фильтр по полу: если пол уже определён и у элемента есть пол — должны совпадать
    if (gender && el.gender && el.gender !== gender) return { ...el, _weight: 0 };

    // Cooldown
    w *= cooldownWeight(el.id, history);
    if (w === 0) return { ...el, _weight: 0 };

    // Фильтр по уровню мата: не берём элементы грубее текущего уровня
    if ((el.profanity || 0) > profanityLevel) return { ...el, _weight: 0 };

    // БОНУС за мат на высоких уровнях: чем выше profanityLevel,
    // тем сильнее система предпочитает матерные элементы
    const elProf = el.profanity || 0;
    if (profanityLevel >= 3 && elProf >= 2) {
      w *= 3.0; // тройной бонус матерным на макс. уровне
    } else if (profanityLevel >= 2 && elProf >= 1) {
      w *= 1.8;
    }

    // Бонус за совпадение тегов с пакетом мира
    if (preferredTags.length > 0 && el.tags) {
      const matchCount = el.tags.filter(t => preferredTags.includes(t)).length;
      if (matchCount > 0) {
        w *= (1 + matchCount * 0.7); // +70% за каждый совпавший тег
      } else {
        w *= 0.3; // штраф если ни одного тега не совпало
      }
    }

    return { ...el, _weight: w };
  });

  return weightedRandom(candidates);
}

// ─────────────────────────────────────────────
// 8. СБОРКА ОДНОГО КАНДИДАТА
// ─────────────────────────────────────────────

/**
 * Собирает одно предложение из шаблона, заполняя слоты.
 * Возвращает { text, usedIds, score } или null если не удалось собрать.
 */
function buildCandidate(family, data, worldPack, history, profanityLevel, quotedInput) {
  const usedIds = [family.id, worldPack.id];
  const slotValues = {};

  // Трекинг пола: первый слот с полем gender задаёт пол,
  // последующие слоты фильтруются по нему, глаголы берут text_f для женского
  let gender = null;

  // Заполняем каждый обязательный слот
  for (const slotName of family.required_slots) {
    const el = pickSlot(slotName, data, worldPack, history, profanityLevel, gender);
    if (!el || el._weight === 0) {
      // Если не нашли подходящий элемент — пробуем без учёта пакета
      const fallbackEl = pickSlotFallback(slotName, data, history, profanityLevel, gender);
      if (!fallbackEl) return null;
      if (!gender && fallbackEl.gender) gender = fallbackEl.gender;
      slotValues[slotName] = (gender === 'f' && fallbackEl.text_f) ? fallbackEl.text_f : fallbackEl.text;
      usedIds.push(fallbackEl.id);
    } else {
      if (!gender && el.gender) gender = el.gender;
      slotValues[slotName] = (gender === 'f' && el.text_f) ? el.text_f : el.text;
      usedIds.push(el.id);

      // Для carrier — подхватываем rel_clause
      if (el.rel_clause) {
        slotValues['rel_clause'] = el.rel_clause;
      }
    }
  }

  // Подставляем в шаблон
  let text = family.template;
  text = text.replace('{input}', quotedInput);

  for (const [key, val] of Object.entries(slotValues)) {
    text = text.replace(`{${key}}`, val);
  }

  // Если остались незаполненные слоты — провал
  if (/\{[a-z_]+\}/.test(text)) return null;

  // Опционально добавляем усилитель
  // На уровне 3 — в 65% случаев, на 2 — в 40%
  const ampChance = profanityLevel >= 3 ? 0.65 : 0.40;
  if (profanityLevel >= 2 && Math.random() < ampChance) {
    const ampResult = addAmplifier(text, data, profanityLevel, history);
    text = ampResult.text;
    if (ampResult.id) usedIds.push(ampResult.id);
  }

  // Опционально добавляем «Такая хуйня.» отдельным предложением в конец
  // На уровне 3 — в 30% случаев, на 2 — в 15%
  if (profanityLevel >= 2) {
    const thChance = profanityLevel >= 3 ? 0.30 : 0.15;
    if (Math.random() < thChance) {
      text = text.replace(/\.$/, '') + '. Такая хуйня.';
    }
  }

  // Убедимся что первая буква — заглавная
  text = text.charAt(0).toUpperCase() + text.slice(1);

  // Простой скоринг
  const score = scoreCandidate(text, usedIds, history);

  return { text, usedIds, score };
}

/** Запасной выбор слота без учёта пакета мира */
function pickSlotFallback(slotName, data, history, profanityLevel, gender) {
  const dict = data.slots[slotName];
  if (!dict || !Array.isArray(dict)) return null;

  const candidates = dict
    .filter(el => (el.profanity || 0) <= profanityLevel)
    .filter(el => !gender || !el.gender || el.gender === gender)
    .map(el => ({ ...el, _weight: Math.max(0.05, cooldownWeight(el.id, history)) }));

  return weightedRandom(candidates);
}

// ─────────────────────────────────────────────
// 9. УСИЛИТЕЛИ (AMPLIFIERS)
// ─────────────────────────────────────────────

/**
 * Вставляет усилитель ВНУТРЬ предложения — между частями конструкции,
 * но обязательно ДО цитаты пользователя (до «).
 *
 * Логика: берём часть текста до «, ищем в ней запятые или пробелы
 * после первых N слов, и вставляем туда филлер как вводное слово.
 * Пример: "Во время эфира, ёб твою мать, диктор зачитал: «...»"
 */
function addAmplifier(text, data, profanityLevel, history) {
  const amps = data.slots.amplifiers
    .filter(a => (a.profanity || 0) <= profanityLevel)
    .map(a => ({ ...a, _weight: (a.weight || 1.0) * cooldownWeight(a.id, history) }));

  const amp = weightedRandom(amps);
  if (!amp) return { text, id: null };

  // Нормализуем текст усилителя: убираем запятые/пробелы по краям,
  // чтобы потом обернуть в ", ... ," единообразно
  const ampClean = amp.text.replace(/^[,\s]+/, '').replace(/[,\s]+$/, '');

  // Ищем позицию «  — всё до неё это наша "зона вставки"
  const quoteStart = text.indexOf('«');
  if (quoteStart === -1) {
    // Нет кавычек — не вставляем (не должно случиться, но на всякий)
    return { text, id: null };
  }

  const before = text.slice(0, quoteStart);
  const after = text.slice(quoteStart);

  // Ищем все запятые в "before" — это естественные точки вставки
  const commaPositions = [];
  for (let i = 0; i < before.length; i++) {
    if (before[i] === ',') commaPositions.push(i);
  }

  let result;

  if (commaPositions.length > 0) {
    // Вставляем после случайной запятой
    const commaIdx = randomPick(commaPositions);
    const partBefore = before.slice(0, commaIdx + 1);
    const partAfter = before.slice(commaIdx + 1).trimStart();
    result = partBefore + ' ' + ampClean + ', ' + partAfter + after;
  } else {
    // Нет запятых — вставляем после первых 2-4 слов
    const words = before.trimEnd().split(/\s+/);
    if (words.length >= 3) {
      const splitAt = 2 + Math.floor(Math.random() * Math.min(2, words.length - 2));
      const partBefore = words.slice(0, splitAt).join(' ');
      const partAfter = words.slice(splitAt).join(' ');
      result = partBefore + ', ' + ampClean + ', ' + partAfter + after;
    } else {
      // Слишком короткое предложение — не вставляем
      return { text, id: null };
    }
  }

  // Гарантируем пробел перед «
  result = result.replace(/([^\s])«/g, '$1 «');

  return { text: result, id: amp.id };
}

// ─────────────────────────────────────────────
// 10. ДЕТЕКТОР ОДНОКОРЕННОГО МАТА
// ─────────────────────────────────────────────
// Матерные корни: если один корень встречается 2+ раз в фразе —
// это "охуенно охуевший от охуительного", звучит как мусор.

const MAT_ROOTS = [
  /охуе|охуи|охуё|охуительн/gi,   // охуенно, охуеть, охуевший, охуительный
  /пизд|опизд|наипизд/gi,          // пиздец, пиздато, опизденевший, наипиздейший
  /ёб[аоу|ёб]|еба|ебан|ебич|ебну|невъеб|въеб/gi,  // ебать, ёбаный, невъебенно
  /хуй|хуя|хуё|хуе[^д]/gi,        // нахуй, хуйня, хуяня (но не "хуед..." — несуществующее)
  /бляд|блядс/gi,                   // блядь, блядский
  /муда|мудо/gi,                     // мудак, мудологии
  /залуп/gi,                         // залупа, залупистый
  /дроч/gi,                          // дрочить, дрочащий
  /сьеб|съеб|сьёб|съёб/gi,          // съебался
  /пидр|педр|педик/gi                // педрила
];

/**
 * Считает сколько раз каждый матерный корень встречается в тексте.
 * Возвращает количество "лишних" повторов (0 = всё чисто).
 */
function countMatRootDupes(text) {
  let dupes = 0;
  for (const rx of MAT_ROOTS) {
    rx.lastIndex = 0;
    const matches = text.match(rx);
    if (matches && matches.length > 1) {
      dupes += matches.length - 1; // каждое повторение сверх первого = штраф
    }
  }
  return dupes;
}

// ─────────────────────────────────────────────
// 11. СКОРИНГ
// ─────────────────────────────────────────────

function scoreCandidate(text, usedIds, history) {
  // Anti-repeat: чем меньше пересечений с историей — тем лучше
  let repeatPenalty = 0;
  for (const id of usedIds) {
    const cw = cooldownWeight(id, history);
    if (cw < 1) repeatPenalty += (1 - cw);
  }
  const antiRepeat = Math.max(0, 1 - repeatPenalty / usedIds.length);

  // Brevity: штраф за длинные фразы (идеал — до 120 символов)
  const len = text.length;
  const brevity = len <= 120 ? 1.0 : Math.max(0.3, 1 - (len - 120) / 200);

  // Однокоренной мат: жёсткий штраф за повторы
  const matDupes = countMatRootDupes(text);
  const matClean = matDupes === 0 ? 1.0 : Math.max(0.05, 1 - matDupes * 0.4);

  // Randomness: небольшая случайная добавка для разнообразия
  const randomness = 0.5 + Math.random() * 0.5;

  return antiRepeat * 0.25 + brevity * 0.2 + matClean * 0.35 + randomness * 0.2;
}

// ─────────────────────────────────────────────
// 11. ГЛАВНАЯ ФУНКЦИЯ
// ─────────────────────────────────────────────

const NUM_CANDIDATES = 20;

/**
 * Генерирует одну абсурдную фразу-рефрейминг.
 *
 * @param {string} rawInput   — фраза пользователя
 * @param {number} profanityLevel — уровень мата (0-3), по умолчанию 2
 * @returns {Promise<string>} — одно предложение
 */
async function generate(rawInput, profanityLevel = 2) {
  const data = await loadData();
  const input = normalizeInput(rawInput);
  const history = getHistory();

  // Безопасность
  const safetyStatus = checkSafety(input, data);
  if (safetyStatus !== 'ok') {
    return safeFallback(input, data);
  }

  // Генерируем кандидатов
  const candidates = [];

  for (let i = 0; i < NUM_CANDIDATES; i++) {
    // Для каждого кандидата выбираем отдельное семейство и пакет
    const family = pickFamily(data, history);
    const worldPack = pickWorldPack(data, family, history, profanityLevel);
    if (!worldPack) continue;

    const candidate = buildCandidate(family, data, worldPack, history, profanityLevel, input);
    if (candidate) {
      candidates.push(candidate);
    }
  }

  if (candidates.length === 0) {
    // Совсем не получилось — грубый fallback
    return `Где-то во вселенной кто-то произнёс: «${input}» — и вселенная пожала плечами.`;
  }

  // Сортируем по score, берём лучшего
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  // Записываем в историю
  recordUsage(history, best.usedIds);
  saveHistory(history);

  return best.text;
}

// ─────────────────────────────────────────────
// 12. ЭКСПОРТ
// ─────────────────────────────────────────────
// В браузере — просто глобальная функция generate()
// Для тестов можно подключать как модуль

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { generate, normalizeInput, checkSafety };
}
