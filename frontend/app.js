"use strict";

/* global MahjongEngine */

const E = MahjongEngine;

/** 和了(ツモ/ロン)表示を、出してから自動的に消すまでの時間(ミリ秒) */
const WIN_BANNER_DURATION_MS = 1500;
/** ポン・カン・リーチ表示を、出してから自動的に消すまでの時間(ミリ秒) */
const CALL_BANNER_DURATION_MS = 1200;
/** リーチ後にツモ切りしか選べない場合、自動で切るまでの待ち時間(ミリ秒) */
const AUTO_TSUMOGIRI_DELAY_MS = 800;
/** 「自動和了」がオンのとき、ツモ・打牌で和了できる状態になってから自動でツモ・ロンするまでの待ち時間(ミリ秒) */
const AUTO_WIN_DELAY_MS = 1000;
/**
 * 手出し(ツモ切りでない打牌)を、その家の手牌が伏せて見えている側(相手視点)に
 * 一瞬だけヒントする演出で、伏せ牌のうちランダムな1枚を透明にしておく時間(ミリ秒)。
 * スライドなどのアニメーションではなく、単純な空白の表示・非表示の切り替え。
 */
const TEDASHI_GAP_MS = 150;
/**
 * 配牌の演出: 局の始めは手牌を伏せず空の状態から、親(東家)→子(南家)の順に交互に
 * 4枚・4枚・4枚・1枚ずつ(配られた順に左から)この間隔で表示していく。配り終えたら
 * 同じ間隔をおいて理牌(自動理牌がオンの場合)し、さらに同じ間隔をおいてから最初のツモを行う。
 */
const DEAL_STEP_MS = 300;
const DEAL_CHUNKS = [4, 4, 4, 1];
/** 局の結果画面を表示してから、確認が揃わなくても自動で次の局へ進むまでの時間(ミリ秒) */
const RESULT_AUTO_ADVANCE_MS = 15000;
/**
 * 持ち時間の既定値(秒)。perAction は打牌・選択のたびにリセットされる「打牌ごと」の時間、
 * bank は局が変わるたびにリセットされる「局ごと」の時間。null は持ち時間なし(無限)。
 */
const DEFAULT_TIME_CONTROL = { perAction: 5, bank: 20 };
/** 持ち時間の表示を更新・時間切れを確認する間隔(ミリ秒) */
const TURN_TIMER_TICK_MS = 200;

/** 持ち時間の設定を「5+20秒」「なし(無限)」のような文字列にする */
function timeControlLabel(tc) {
  if (!tc) return "なし(無限)";
  return `${tc.perAction}+${tc.bank}秒`;
}

/**
 * 和了画面・ログでの役の表示順(ユーザー指定)。役IDで並べ、ここに無い役は末尾に元の順で並べる。
 * 同じ役の派生(四暗刻のツモり形、鳴きの大三元)は元の役と同じ位置に置く。
 */
const YAKU_DISPLAY_ORDER = [
  "tenhou", "chiihou", "suukantsu", "suuankou_tanki", "daisuushi", "shousuushi",
  "chuuren_9men", "chuuren", "kokushi_13", "chinroutou", "tsuuiisou", "daichiishin", "daisuurin",
  "kaga_hyakumangoku", "hyakumangoku", "double_riichi", "riichi", "ippatsu", "haitei", "houtei",
  "menzen_tsumo", "daisangen", "daisangen_open", "suuankou_tsumo_shanpon", "kokushi_other", "yakuhai_seat", "yakuhai_round",
  "yakuhai_white", "yakuhai_green", "yakuhai_red", "honitsu", "chinitsu", "shousangen", "tanyao",
  "pinfu", "iipeiko", "ryanpeikou", "toitoi", "sankantsu", "chiitoitsu", "ittsuu",
  "chanta", "junchan", "honroutou", "sanankou", "sanshoku_doukou",
];
// 嶺上開花は(一覧に載っていない役よりも後ろの)常に最後に表示する
const YAKU_DISPLAY_LAST = ["rinshan"];

/**
 * 役満の倍数(成立した役満の yakumanMultiplier の合計)に応じた表記。
 * 1:役満 2:ダブル役満 3:トリプル役満 4:四倍役満 5:五倍役満 6:六倍役満(7以上も同様に「n倍役満」)
 */
const YAKUMAN_MULTIPLIER_LABELS = ["", "役満", "ダブル役満", "トリプル役満", "四倍役満", "五倍役満", "六倍役満"];
const KANJI_DIGITS = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
function yakumanMultiplierLabel(multiplier) {
  if (YAKUMAN_MULTIPLIER_LABELS[multiplier]) return YAKUMAN_MULTIPLIER_LABELS[multiplier];
  return (KANJI_DIGITS[multiplier] || String(multiplier)) + "倍役満";
}

function sortYakuForDisplay(yaku) {
  const rank = (y) => {
    const last = YAKU_DISPLAY_LAST.indexOf(y.id);
    if (last !== -1) return YAKU_DISPLAY_ORDER.length + 1 + last;
    const i = YAKU_DISPLAY_ORDER.indexOf(y.id);
    return i === -1 ? YAKU_DISPLAY_ORDER.length : i;
  };
  return yaku.map((y, i) => ({ y, i })).sort((a, b) => rank(a.y) - rank(b.y) || a.i - b.i).map((e) => e.y);
}

/** 河(捨て牌)の1段目・2段目を何枚で次の段に折り返すか(3段目は折り返さず伸ばす) */
const DISCARDS_PER_ROW = 6;

// ---------------- 牌山(山・王牌)の物理的な並び ----------------
//
// 実際の麻雀卓と同じように、全80枚を「2枚積み×20列」の山として各家の前に1つずつ、
// 計40列(80枚)積んだものとして描画する。牌は先頭の列から順に(1列につき上段→下段の順に)
// 取っていき、末尾7列(14枚)が王牌になる。
//
//   列番号:  0 ......................... 32 | 33  34  35  36  37 | 38  39
//            └─ 自摸山(配牌26枚+自摸40枚)─┘ └──── ドラ表示牌 ───┘ └嶺上牌┘
//                                              (37列目が最初のドラ)
//
// 南家の前に前半20列(0〜19)、東家の前に後半20列(20〜39)を置く。こうすると王牌
// (ドラ表示牌)は常に東家側の山の端に来るので、ドラ表示牌を正立した向きで読める。
const WALL_TOTAL_TILES = 80;
/** 1列(2枚積み)あたりの枚数 */
const WALL_TILES_PER_STACK = 2;
/** 1人の前に積む列数(20列×2段=40枚) */
const WALL_STACKS_PER_SIDE = 20;
/** 王牌の列数(7列=14枚) */
const DEAD_WALL_STACKS = 7;
/** 嶺上牌の列数(王牌の末尾2列=4枚) */
const RINSHAN_STACKS = 2;
/** 全体の列数(40列) */
const WALL_STACK_COUNT = WALL_TOTAL_TILES / WALL_TILES_PER_STACK;
/** 王牌を除いた、配牌・自摸に使われる部分の枚数(80-14=66枚) */
const LIVE_SECTION_TILES = WALL_TOTAL_TILES - DEAD_WALL_STACKS * WALL_TILES_PER_STACK;
/** 最初のドラ表示牌が乗っている列(嶺上牌2列の手前)。カンのたびに1列ずつ手前へ進む */
const FIRST_DORA_STACK = WALL_STACK_COUNT - RINSHAN_STACKS - 1;
/**
 * 嶺上牌を取っていく順番(牌の通し番号)。王牌の末尾の列から、上段→下段の順に取る。
 * 通し番号 p は「列 = floor(p/2)、p が偶数なら上段・奇数なら下段」を表す。
 */
const RINSHAN_TILE_POSITIONS = [78, 79, 76, 77];

// ---------------- 入力デバイス判定(マウス/タッチ) ----------------
//
// PCのマウス操作は従来通りクリック1回で打牌できるようにし、スマートフォン等の
// タッチ操作では誤タップ防止のため「1回目のタップで牌を浮かせる(選択)→2回目の
// タップで実際に打牌する」という二段階操作にする。
//
// 実際に使われた入力の種類(PointerEvent.pointerType: "mouse"/"touch"/"pen")を
// 操作のたびに記録しておき、直前の入力がタッチ/ペンだったかどうかで判定する。
// タッチ対応の有無を機種であらかじめ決め打ちするのではなく、実際にその操作が
// マウスで行われたかタッチで行われたかをその都度見ているため、タッチ対応PCの
// ように両方使える環境でも、実際に使った方式に応じて正しく切り替わる。
let lastPointerType = "mouse";
if (typeof document !== "undefined" && typeof window !== "undefined" && window.PointerEvent) {
  document.addEventListener(
    "pointerdown",
    (e) => {
      lastPointerType = e.pointerType || "mouse";
    },
    true
  );
}
/** 直近の操作がタッチ(またはペン)によるものかどうか */
function isTouchLikeInput() {
  return lastPointerType === "touch" || lastPointerType === "pen";
}

// ---------------- 効果音・発声 ----------------
//
// 効果音は録音した音声ファイル(frontend/sounds/*.mp3。ビルド時に MAHJONG_SOUND_FILES として
// 埋め込まれる)を使う:
//   dahai1〜3     ツモ音・打牌音(ランダム。直前と同じ音は続けない)
//   dahai_riichi  リーチ宣言牌の打牌音
//   riichibou1〜3 リーチ棒を出す音(ランダム)
//   fuuro         鳴いた(ポン・カン)時の音
//   tenbou1〜4    和了画面(翻数に応じて)・点数のやり取りがある流局・流し役満(tenbou4)の音
//   sentakushi_piron 選択肢(ツモ・リーチ・ポン・ロンなど)が出た時
//   press / cancel   ボタンを押した時(戻る・キャンセルなどは cancel)
//   Jankis_Lair_full ロビー・待機画面などのBGM(対局が始まるまでループ再生)
// 音声ファイルが無い・読み込み前の場合は、打牌音・ツモ音は合成音で代わりに鳴らす。
// 選択肢が出た時の通知音・和了時の手牌公開の音は合成音、発声(ポン・カン・リーチ・ロン・ツモ)は
// ブラウザの音声読み上げ(日本語)。これらも同じ名前(choice / reveal / ポン 等)の音声ファイルを
// 置けばそちらが優先される。
const SOUND_SAMPLES = Object.assign(
  {},
  typeof MAHJONG_SOUND_FILES !== "undefined" ? MAHJONG_SOUND_FILES : {}
);

/**
 * フェルトマットを張った卓に、硬い樹脂製の牌を打ちつける「トンッ(ドスッ)」という音を
 * 1回分合成して、音の波形(-1〜1)を返す。次の要素を足し合わせる。
 *   1. 卓の重さ: マットの下の天板まで衝撃が伝わる低く重い「ドン」(音の中心)
 *   2. 天板の中低音の「コッ」という鳴り
 *   3. 牌そのものの響き: 硬い樹脂の塊の共鳴。フェルトに当たるので高い音は吸われて
 *      すぐ止まり、やや低めの「カッ」として少しだけ混ざる
 *   4. 当たった瞬間の打撃音: フェルト越しなので鋭さは丸め、こもった短いノイズにする
 *   5. フェルトの上ではほとんど跳ねないので、跳ね返りはごく小さい2打目だけ
 * 高さ・強さは毎回少しずつ変え、同じ音の繰り返しに聞こえないようにする。
 * @param {number} sampleRate
 * @param {() => number} rand 0〜1の乱数
 * @returns {Float32Array}
 */
function synthesizeTileClack(sampleRate, rand) {
  const dur = 0.18;
  const n = Math.floor(sampleRate * dur);
  const out = new Float32Array(n);
  const jitter = (v, amount) => v * (1 + (rand() * 2 - 1) * amount);
  const TWO_PI = 2 * Math.PI;

  // 牌の共鳴(やや低め。フェルトに当たるので短く止まる)
  const base = jitter(1300, 0.06);
  const modes = [
    { ratio: 1.0, amp: 0.42, tau: 0.01 },
    { ratio: 1.47, amp: 0.36, tau: 0.0075 },
    { ratio: 2.09, amp: 0.2, tau: 0.0055 },
    { ratio: 2.76, amp: 0.1, tau: 0.004 },
  ].map((m) => ({
    freq: base * jitter(m.ratio, 0.03),
    amp: jitter(m.amp, 0.25),
    tau: jitter(m.tau, 0.2),
    phase: rand() * TWO_PI,
  }));
  // 卓(天板)の低い鳴りと中低音の鳴り。あまり低すぎるとスマホのスピーカーでは鳴らない
  // (小さくこもって聞こえる)ため、重さは150Hz前後とその倍音、中低音の「コッ」で出す。
  const bodyFreq = jitter(150, 0.1);
  const knockFreq = jitter(520, 0.1);

  /** 減衰する正弦波を書き込む(先頭 1ms はなめらかに立ち上げてプツッという音を防ぐ) */
  const addDecay = (s0, freq, amp, tau, phase, sweep) => {
    const len = Math.min(n - s0, Math.floor(sampleRate * tau * 7));
    const atk = Math.floor(sampleRate * 0.001);
    let ph = phase;
    for (let i = 0; i < len; i++) {
      // sweep: 当たった直後は少し高く、すぐ本来の高さに落ち着く(重い物がぶつかった感じ)
      const f = freq * (1 + sweep * Math.exp(-i / (sampleRate * 0.006)));
      ph += (TWO_PI * f) / sampleRate;
      const a = i < atk ? i / atk : 1;
      out[s0 + i] += Math.sin(ph) * Math.exp(-i / (sampleRate * tau)) * amp * a;
    }
  };

  /** 時刻 start(秒)に、強さ gain の1打を書き込む。damp は響きを短くする倍率 */
  const strike = (start, gain, damp) => {
    const s0 = Math.floor(start * sampleRate);
    // 1. 卓の重さ(音の中心)。長く響くと「ボーン」になるので短めに止める
    addDecay(s0, bodyFreq, 0.8 * gain, 0.019 * damp, 0, 0.35);
    addDecay(s0, bodyFreq * 2.02, 0.35 * gain, 0.013 * damp, rand() * TWO_PI, 0.3);
    // 2. 天板の中低音の「コッ」
    addDecay(s0, knockFreq, 0.62 * gain, 0.011 * damp, rand() * TWO_PI, 0.15);
    // 3. 牌の響き
    for (const m of modes) addDecay(s0, m.freq, m.amp * gain, m.tau * damp, m.phase, 0);
    // 4. 打撃の瞬間: フェルトでこもった短いノイズ(強めのローパス)
    const snapTau = 0.0035 * damp;
    const snapLen = Math.min(n - s0, Math.floor(sampleRate * snapTau * 6));
    let lp1 = 0;
    let lp2 = 0;
    for (let i = 0; i < snapLen; i++) {
      lp1 += ((rand() * 2 - 1) - lp1) * 0.22;
      lp2 += (lp1 - lp2) * 0.22;
      out[s0 + i] += lp2 * 2.6 * Math.exp(-i / (sampleRate * snapTau)) * gain;
    }
  };

  strike(0.001, 1.0, 1.0);
  // 5. フェルトの上なので跳ね返りはごく小さい
  strike(0.011 + rand() * 0.008, 0.1 + rand() * 0.06, 0.5);

  // 最大値をそろえ、最後をなめらかに消す
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const norm = peak > 0 ? 0.9 / peak : 1;
  const fade = Math.floor(sampleRate * 0.02);
  for (let i = 0; i < n; i++) {
    const f = i > n - fade ? (n - i) / fade : 1;
    out[i] *= norm * f;
  }
  return out;
}

/**
 * 和了画面で鳴らす点棒の音の段階(1〜4)。5翻まで→1、10翻まで→2、12翻まで→3、
 * 役満以上(数え役満=13翻以上を含む)→4。
 */
function tenbouSoundLevel(scoreResult) {
  if (!scoreResult) return 1;
  const tier = scoreResult.tier;
  if (tier && tier.kind === "yakuman") return 4;
  let han = typeof scoreResult.totalHan === "number" ? scoreResult.totalHan : null;
  if (han == null && tier) {
    if (tier.kind === "points") han = tier.han;
    else if (tier.kind === "fixed") han = { mangan: 5, haneman: 7, baiman: 9, sanbaiman: 11 }[tier.tier] || 5;
  }
  if (han == null) return 1;
  if (han >= 13) return 4;
  if (han >= 11) return 3;
  if (han >= 6) return 2;
  return 1;
}

const MahjongSound = (() => {
  const STORAGE_KEY = "mahjong_sound_settings";
  const DEFAULTS = { se: true, voice: true, volume: 0.8, muted: false, bgm: true, bgmVolume: 0.5 };
  let settings = Object.assign({}, DEFAULTS);
  try {
    const raw = typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY);
    if (raw) settings = Object.assign(settings, JSON.parse(raw));
  } catch (e) {
    /* ignore */
  }
  const listeners = new Set();

  let ctx = null;
  const sampleBuffers = {}; // 音声ファイルをデコードしたもの(名前 -> AudioBuffer)
  const sampleOffsets = {}; // 音声ファイル先頭の無音を飛ばして鳴らすための再生開始位置(秒)
  let jaVoice = null;

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
      /* ignore */
    }
    for (const cb of listeners) cb(settings);
  }

  function audioContext() {
    if (ctx) return ctx;
    const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return null;
    try {
      ctx = new AC();
    } catch (e) {
      ctx = null;
    }
    return ctx;
  }

  function pickJapaneseVoice() {
    if (typeof speechSynthesis === "undefined") return;
    const voices = speechSynthesis.getVoices() || [];
    jaVoice = voices.find((v) => /^ja(-|_|$)/i.test(v.lang)) || null;
  }
  if (typeof speechSynthesis !== "undefined") {
    pickJapaneseVoice();
    if (typeof speechSynthesis.addEventListener === "function") {
      speechSynthesis.addEventListener("voiceschanged", pickJapaneseVoice);
    }
  }

  // スマホ(iOS Safari・Android Chrome)では、音を出す準備(AudioContext の開始・読み上げの
  // 起動)は「ユーザーの操作の中」でしか許可されない。しかもタッチ操作では、指を置いた瞬間
  // (pointerdown/touchstart)は操作として認められず、指を離した時(touchend)やタップの完了
  // (click)でないといけない。そのため、操作として認められるイベントのたびに準備を試み、
  // 実際に準備ができる(AudioContext が running になる)までやめないようにする。
  let speechWarmed = false;
  function unlock() {
    const c = audioContext();
    if (c) {
      if (c.state !== "running") {
        c.resume().catch(() => {});
        try {
          const buf = c.createBuffer(1, 1, 22050);
          const src = c.createBufferSource();
          src.buffer = buf;
          src.connect(c.destination);
          src.start(0);
        } catch (e) {
          /* ignore */
        }
      }
      decodeSamples();
    }
    if (!speechWarmed && typeof speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined") {
      try {
        // 一度も発声していないと、iOS では操作の外(相手の打牌など)からの発声が鳴らないため、
        // 操作の中で無音の発声を1回しておく
        const u = new SpeechSynthesisUtterance(" ");
        u.volume = 0;
        speechSynthesis.speak(u);
        speechWarmed = true;
      } catch (e) {
        /* ignore */
      }
    }
    applyBgm();
    if ((!c || c.state === "running") && speechWarmed) removeUnlockListeners();
  }
  // 音声ファイルのデコード(読み込み)は再生の許可が無くてもできるので、ページを開いた時点で
  // 済ませておく(最初に押したボタンの音から間に合うように)。再生そのものは最初の操作まで行わない。
  if (typeof window !== "undefined") {
    setTimeout(() => {
      try {
        decodeSamples();
      } catch (e) {
        /* ignore */
      }
    }, 0);
  }
  const UNLOCK_EVENTS = ["click", "touchend", "pointerup", "keydown"];
  function removeUnlockListeners() {
    for (const type of UNLOCK_EVENTS) document.removeEventListener(type, unlock, true);
  }
  if (typeof document !== "undefined") {
    for (const type of UNLOCK_EVENTS) document.addEventListener(type, unlock, true);
  }

  function decodeSamples() {
    const c = audioContext();
    if (!c) return;
    for (const [name, url] of Object.entries(SOUND_SAMPLES)) {
      if (!url || name === BGM_NAME || sampleBuffers[name] !== undefined) continue;
      sampleBuffers[name] = null; // デコード中
      try {
        const base64 = url.slice(url.indexOf(",") + 1);
        const bin = atob(base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        c.decodeAudioData(bytes.buffer).then(
          (buf) => {
            sampleBuffers[name] = buf;
            sampleOffsets[name] = leadingSilence(buf);
          },
          () => delete sampleBuffers[name]
        );
      } catch (e) {
        delete sampleBuffers[name];
      }
    }
  }

  /**
   * 音声ファイルの先頭にある無音の長さ(秒)。MP3 は変換の都合で先頭に数十〜百数十ミリ秒の
   * 無音が入り、そのまま鳴らすと打牌から音が遅れて聞こえる(ファイルごとに遅れ方も違う)ため、
   * 音が始まる少し手前から鳴らす。
   */
  function leadingSilence(buf) {
    const data = buf.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
    const threshold = peak * 0.02;
    for (let i = 0; i < data.length; i++) {
      if (Math.abs(data[i]) > threshold) return Math.max(0, i / buf.sampleRate - 0.005);
    }
    return 0;
  }

  function playSample(name, vol) {
    const c = audioContext();
    const buf = sampleBuffers[name];
    if (!c || !buf) return false;
    if (c.state !== "running") c.resume().catch(() => {});
    const src = c.createBufferSource();
    src.buffer = buf;
    const gain = c.createGain();
    gain.gain.value = vol;
    src.connect(gain).connect(c.destination);
    src.start(0, sampleOffsets[name] || 0);
    // 動作確認用: window.__mahjongSoundLog に配列を入れておくと、鳴らした音の名前を記録する
    if (typeof window !== "undefined" && Array.isArray(window.__mahjongSoundLog)) window.__mahjongSoundLog.push(name);
    return true;
  }

  /** names の中からランダムに1つ選ぶ(avoid と同じものは、他に候補があれば避ける) */
  function pickRandom(names, avoid) {
    const candidates = names.filter((n) => n !== avoid);
    const list = candidates.length > 0 ? candidates : names;
    return list[Math.floor(Math.random() * list.length)];
  }

  const BGM_NAME = "Jankis_Lair_full";
  const DAHAI_SOUNDS = ["dahai1", "dahai2", "dahai3"];
  const RIICHIBOU_SOUNDS = ["riichibou1", "riichibou2", "riichibou3"];
  /** 直前に鳴らしたツモ音・打牌音(同じ音が続かないようにするため) */
  let lastDahai = null;

  /** 牌を卓に置く「タンッ」という音を合成する(短いノイズの破裂音+低い胴鳴り) */
  function synthDiscard(vol) {
    const c = runningContext(() => synthDiscard(vol));
    if (!c) return;
    const samples = synthesizeTileClack(c.sampleRate, Math.random);
    const buf = c.createBuffer(1, samples.length, c.sampleRate);
    buf.getChannelData(0).set(samples);
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    g.gain.value = vol;
    src.connect(g).connect(c.destination);
    src.start();
  }

  /** 減衰する短い音(サイン波など)を1つ鳴らす */
  function tone(c, t, freq, dur, vol, type = "sine") {
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(c.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** 短いノイズの「カチッ」(牌どうしが当たる音)。打牌音より軽く高い */
  function click(c, t, vol, freq = 3600, dur = 0.03) {
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
    const src = c.createBufferSource();
    src.buffer = buf;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = freq;
    bp.Q.value = 2;
    const g = c.createGain();
    g.gain.value = vol;
    src.connect(bp).connect(g).connect(c.destination);
    src.start(t);
  }

  /** 実際に鳴らせる状態の AudioContext(まだ開始できていなければ開始を試みて null) */
  function runningContext(retry) {
    const c = audioContext();
    if (!c) return null;
    if (c.state !== "running") {
      c.resume().then(() => {
        if (c.state === "running") retry();
      }, () => {});
      return null;
    }
    return c;
  }

  /** 選択肢が出た: 控えめな2音の通知音 */
  function synthChoice(vol) {
    const c = runningContext(() => synthChoice(vol));
    if (!c) return;
    const t = c.currentTime;
    tone(c, t, 988, 0.16, 0.22 * vol, "triangle");
    tone(c, t + 0.09, 1319, 0.22, 0.22 * vol, "triangle");
  }

  /** 和了して手牌を公開: 牌を端から順に倒していく「パタパタッ」 */
  function synthReveal(vol) {
    const c = runningContext(() => synthReveal(vol));
    if (!c) return;
    const t = c.currentTime;
    for (let i = 0; i < 14; i++) {
      const at = t + i * 0.028 + Math.random() * 0.006;
      click(c, at, (0.55 + Math.random() * 0.2) * vol, 1900 + Math.random() * 700, 0.045);
    }
    tone(c, t + 14 * 0.028, 180, 0.12, 0.35 * vol);
  }

  function speakText(text, vol) {
    if (typeof speechSynthesis === "undefined" || typeof SpeechSynthesisUtterance === "undefined") return;
    try {
      // 前の発声が残っていれば打ち切る(何も鳴っていない時に cancel すると、iOS Safari では
      // 直後の発声まで捨てられてしまうことがあるため、鳴っている時だけにする)
      if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "ja-JP";
      if (jaVoice) u.voice = jaVoice;
      u.rate = 1.15;
      u.pitch = 1.05;
      u.volume = vol;
      speechSynthesis.speak(u);
    } catch (e) {
      /* ignore */
    }
  }

  /** ツモ音・打牌音(dahai1〜3 からランダム、直前と同じ音は避ける)。riichi ならリーチ宣言牌の音 */
  function playDahai(cfg, riichi) {
    if (cfg.muted || !cfg.se || cfg.volume <= 0) return;
    if (riichi && playSample("dahai_riichi", cfg.volume)) return;
    const name = pickRandom(DAHAI_SOUNDS, lastDahai);
    if (playSample(name, cfg.volume)) {
      lastDahai = name;
      return;
    }
    synthDiscard(cfg.volume); // 音声ファイルが使えない場合の代わり
  }

  function playDiscard(cfg) {
    playDahai(cfg, false);
  }

  function playVoice(word, cfg) {
    if (cfg.muted || !cfg.voice || cfg.volume <= 0) return;
    if (!playSample(word, cfg.volume)) speakText(word, cfg.volume);
  }

  /** 効果音(打牌音以外)を鳴らす。delayMs 後に鳴らす(同時に鳴る音と重ならないよう少しずらす) */
  function playSe(name, synth, delayMs) {
    const cfg = settings;
    if (cfg.muted || !cfg.se || cfg.volume <= 0) return;
    const run = () => {
      if (!playSample(name, cfg.volume)) synth(cfg.volume);
    };
    if (delayMs > 0) setTimeout(run, delayMs);
    else run();
  }

  // ---- BGM ----
  // 長い曲なので、効果音のように全体をデコードしてメモリに展開はせず、audio 要素で再生する。
  // 音量はスマホ(iOS)でも効くよう、Web Audio の GainNode を通して調整する。
  let bgmEl = null;
  let bgmGain = null;
  let bgmWanted = false;
  let bgmRestart = false;

  function bgmVolume() {
    return settings.muted || !settings.bgm ? 0 : Math.max(0, Math.min(1, settings.bgmVolume));
  }

  function ensureBgmElement() {
    if (bgmEl || !SOUND_SAMPLES[BGM_NAME] || typeof Audio === "undefined") return bgmEl;
    bgmEl = new Audio(SOUND_SAMPLES[BGM_NAME]);
    bgmEl.loop = true;
    bgmEl.preload = "auto";
    const c = audioContext();
    if (c && typeof c.createMediaElementSource === "function") {
      try {
        const node = c.createMediaElementSource(bgmEl);
        bgmGain = c.createGain();
        node.connect(bgmGain).connect(c.destination);
      } catch (e) {
        bgmGain = null;
      }
    }
    return bgmEl;
  }

  /** BGM を今の状況(流すべき画面か・設定・画面が表示中か)に合わせて再生/停止する */
  function applyBgm() {
    const vol = bgmVolume();
    const visible = typeof document === "undefined" || document.visibilityState !== "hidden";
    const shouldPlay = bgmWanted && vol > 0 && visible;
    if (!shouldPlay) {
      if (bgmEl && !bgmEl.paused) bgmEl.pause();
      return;
    }
    const el = ensureBgmElement();
    if (!el) return;
    if (bgmGain) {
      bgmGain.gain.value = vol;
      el.volume = 1;
    } else {
      el.volume = vol;
    }
    const c = audioContext();
    if (c && c.state !== "running") c.resume().catch(() => {});
    if (el.paused) {
      if (bgmRestart) {
        try {
          el.currentTime = 0;
        } catch (e) {
          /* ignore */
        }
        bgmRestart = false;
      }
      const p = el.play();
      if (p && typeof p.catch === "function") p.catch(() => {}); // まだ操作前で再生が許可されていない等
    }
  }

  if (typeof document !== "undefined") {
    // 別のアプリ・タブに切り替えている間は止め、戻ったら再開する
    document.addEventListener("visibilitychange", applyBgm);

    // ボタンを押した時の音(戻る・キャンセル・やめる・いいえは cancel、それ以外は press)。
    // 牌(button.tile)は打牌・ツモの音が別に鳴るので除く。
    const CANCEL_LABELS = new Set(["戻る", "キャンセル", "やめる", "いいえ"]);
    document.addEventListener(
      "click",
      (e) => {
        const b = e.target && e.target.closest ? e.target.closest("button") : null;
        // data-sound="none" のボタン(「盤面を見る」など)も鳴らさない
        if (b && !b.disabled && !b.classList.contains("tile") && b.dataset.sound !== "none") {
          const label = (b.textContent || "").trim();
          playFile(b.dataset.sound === "cancel" || CANCEL_LABELS.has(label) ? "cancel" : "press", 0);
        }
        // 操作のたびに、流すべき BGM が(再生の許可待ちで)止まっていれば再生を試みる
        if (bgmWanted && (!bgmEl || bgmEl.paused)) applyBgm();
      },
      true
    );
  }

  /** 音声ファイルだけで鳴らす効果音(ファイルが無ければ鳴らさない) */
  function playFile(name, delayMs) {
    const cfg = settings;
    if (cfg.muted || !cfg.se || cfg.volume <= 0) return;
    const run = () => playSample(name, cfg.volume);
    if (delayMs > 0) setTimeout(run, delayMs);
    else run();
  }

  return {
    /** 打牌音(riichi: リーチ宣言牌の打牌) */
    discard(riichi = false) {
      playDahai(settings, riichi);
    },
    /** ツモ(自分が牌を引いた)。打牌音と同じ dahai1〜3 から選ぶ */
    draw(delayMs = 0) {
      const cfg = settings;
      if (delayMs > 0) setTimeout(() => playDahai(cfg, false), delayMs);
      else playDahai(cfg, false);
    },
    /** リーチ棒を出す音(riichibou1〜3 からランダム) */
    riichiStick(delayMs = 0) {
      playFile(pickRandom(RIICHIBOU_SOUNDS, null), delayMs);
    },
    /** 鳴いた(ポン・カン)時の音 */
    fuuro(delayMs = 0) {
      playFile("fuuro", delayMs);
    },
    /** 点棒の音(level: 1〜4。和了画面の翻数・点数のやり取りがある流局) */
    tenbou(level, delayMs = 0) {
      const n = Math.max(1, Math.min(4, level | 0));
      playFile(`tenbou${n}`, delayMs);
    },
    /** 選択肢(ツモ・リーチ・カン・ポン・ロンなど)が出た */
    choice(delayMs = 0) {
      playSe("sentakushi_piron", synthChoice, delayMs);
    },
    /** 配牌で牌が配られる音(dahai1) */
    deal() {
      const cfg = settings;
      if (cfg.muted || !cfg.se || cfg.volume <= 0) return;
      if (!playSample("dahai1", cfg.volume)) synthDiscard(cfg.volume);
    },
    /**
     * BGM を流すべき画面か(ロビー・待機画面などは true、対局画面は false)を知らせる。
     * 同じ値のまま呼ばれても何もしないので、画面が切り替わっても曲は途切れない。
     */
    setBgmWanted(wanted) {
      if (bgmWanted === !!wanted) return;
      bgmWanted = !!wanted;
      // 対局が始まって止めた曲は、次にロビーへ戻った時に最初から流す
      if (!bgmWanted) bgmRestart = true;
      applyBgm();
    },
    /** 和了して手牌を公開した */
    reveal(delayMs = 0) {
      playSe("reveal", synthReveal, delayMs);
    },
    /** 発声(word: "ポン" | "カン" | "リーチ" | "ロン" | "ツモ") */
    voice(word) {
      playVoice(word, settings);
    },
    /** オプション画面の試聴用: 保存前の設定(opts)で打牌音と発声を1回ずつ鳴らす(消音中でも鳴らす) */
    preview(opts) {
      // ボタンを押した操作の中で直接鳴らす(タイマー等で遅らせると、スマホでは操作の外と
      // みなされて鳴らないことがある)。読み上げは準備に少し時間がかかるので、打牌音と
      // 同時に呼んでも実際には打牌音の後に聞こえる。
      unlock();
      const cfg = Object.assign({}, settings, opts, { muted: false });
      playDiscard(cfg);
      playVoice("リーチ", cfg);
    },
    getSettings() {
      return Object.assign({}, settings);
    },
    update(patch) {
      settings = Object.assign({}, settings, patch);
      save();
      applyBgm();
    },
    /** 設定の変化を購読する。戻り値で解除 */
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
})();
window.MahjongSound = MahjongSound;

// ---------------- 牌の見た目(ユーザー提供のタイル画像を使って描画する) ----------------
//
// 牌の絵柄は、牌ごとに用意された画像(styles.cssに
// data:image/png;base64,... として埋め込み済みの背景画像クラス .timg-*)を
// そのまま表示する。枠線も画像に含まれているため、フォントや自前のSVG描画には
// 一切頼らず、常に同じ見た目になる。

/** 牌の種類から、対応する画像クラス名(styles.cssの.timg-*)を求める */
function tileImageClass(kind) {
  if (kind.kind === "honor") return "timg-" + kind.honor;
  return "timg-" + kind.suit + kind.rank;
}
const HONOR_LABEL = { east: "東", south: "南", west: "西", north: "北", white: "白", green: "發", red: "中" };

function tileTitle(kind) {
  if (kind.kind === "honor") return HONOR_LABEL[kind.honor];
  const suitLabel = { man: "萬", pin: "筒", sou: "索" }[kind.suit];
  return kind.rank + suitLabel;
}

function windLabel(w) {
  return HONOR_LABEL[w] || w;
}

// 場風(roundWind)や字牌そのものの表示には windLabel をそのまま使う。
// 一方、プレイヤー識別子(Seat: "east"/"south")を「〜家」として表示する場合は、
// Seat自体は固定のプレイヤースロットに過ぎず、実際の自風(東家/南家)は
// その局の親が誰かによって変わるため、必ず MahjongApp#seatLabel を経由する。

// ---------------- 外から届いた対局データの検査 ----------------
//
// オンライン対戦の相手・観戦・読み込んだ牌譜のファイルから届く局面(state)は、改造したクライアントや
// 手で書き換えたファイルから送られてくる可能性がある。形が正しくないデータは画面に使わない
// (想定外の値で画面が壊れたり、文字列が画面に紛れ込んだりしないように)。

const VALID_SEATS = ["east", "south"];
const VALID_WINDS = ["east", "south", "west", "north"];
const VALID_HONORS = ["east", "south", "west", "north", "white", "green", "red"];
const VALID_PHASES = ["waiting_for_players", "dealing", "draw", "discard", "call_window", "kan_replacement", "round_end", "game_end"];

function isValidTileKind(k) {
  if (!k || typeof k !== "object") return false;
  if (k.kind === "honor") return VALID_HONORS.includes(k.honor);
  if (k.kind !== "number" || !Number.isInteger(k.rank)) return false;
  if (k.suit === "man") return k.rank >= 1 && k.rank <= 9;
  return (k.suit === "pin" || k.suit === "sou") && (k.rank === 1 || k.rank === 9);
}

/** 牌。kind が null の牌は伏せた牌(相手の手牌・牌山など、中身を知らされていない牌) */
function isValidTile(t) {
  return (
    !!t && typeof t === "object" && typeof t.id === "string" && t.id.length > 0 && t.id.length <= 32 &&
    (t.kind === null || isValidTileKind(t.kind)) &&
    (t.isRedDora === undefined || typeof t.isRedDora === "boolean")
  );
}

function isValidTileList(list, max) {
  return Array.isArray(list) && list.length <= max && list.every(isValidTile);
}

/** 真偽値の項目(false の場合に省かれていることもある) */
function isOptionalBool(v) {
  return v === undefined || typeof v === "boolean";
}

function isValidScore(n) {
  return typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 10000000;
}

function isValidPlayerState(p, seat) {
  if (!p || typeof p !== "object" || p.seat !== seat) return false;
  if (!isValidTileList(p.hand, 14) || !isValidScore(p.score)) return false;
  if (p.drawnTile !== null && !isValidTile(p.drawnTile)) return false;
  if (!Array.isArray(p.melds) || p.melds.length > 4) return false;
  for (const m of p.melds) {
    if (!m || !["triplet", "kan_open", "kan_closed"].includes(m.type) || !isValidTileList(m.tiles, 4) || m.tiles.length < 3) return false;
    if (m.calledTile != null && !isValidTile(m.calledTile)) return false;
  }
  if (!Array.isArray(p.discards) || p.discards.length > 60) return false;
  for (const d of p.discards) {
    if (!d || !isValidTile(d.tile) || !isOptionalBool(d.isRiichiDeclaration) || !isOptionalBool(d.isCalled)) return false;
  }
  for (const f of ["isRiichi", "isDoubleRiichi", "hasIppatsuChance", "isTemporaryFuriten"]) {
    if (!isOptionalBool(p[f])) return false;
  }
  if (p.forbiddenDiscardKind != null && !isValidTileKind(p.forbiddenDiscardKind)) return false;
  return true;
}

/** 和了の内容(lastWin)として最低限正しい形か(null は和了なし) */
function isValidLastWin(w) {
  return w === null || w === undefined || (!!w && typeof w === "object" && VALID_SEATS.includes(w.seat) && !!w.scoreResult && typeof w.scoreResult === "object");
}

/** オンライン対戦で相手・観戦先から届く対局データ一式として正しい形か */
function isValidGamePayload(g) {
  return !!g && typeof g === "object" && isValidGameState(g.state) && isValidLastWin(g.lastWin) && (g.log === undefined || Array.isArray(g.log));
}

/** 局面(GameState)として正しい形か */
function isValidGameState(s) {
  if (!s || typeof s !== "object") return false;
  if (!VALID_PHASES.includes(s.phase) || !VALID_WINDS.includes(s.roundWind)) return false;
  if (s.roundNumber !== 1 && s.roundNumber !== 2) return false;
  for (const f of ["overallRoundIndex", "riichiSticks", "kanCount"]) {
    if (!Number.isInteger(s[f]) || s[f] < 0 || s[f] > 1000) return false;
  }
  if (s.roundSerial !== undefined && (!Number.isInteger(s.roundSerial) || s.roundSerial < 0)) return false;
  for (const f of ["startingDealer", "dealer", "currentTurn"]) {
    if (!VALID_SEATS.includes(s[f])) return false;
  }
  const w = s.wall;
  if (!w || typeof w !== "object") return false;
  for (const f of ["liveWall", "doraIndicatorTiles", "revealedDoraIndicators", "uraDoraIndicatorTiles", "deadWallDraws"]) {
    if (!isValidTileList(w[f], 80)) return false;
  }
  if (!s.players || !VALID_SEATS.every((seat) => isValidPlayerState(s.players[seat], seat))) return false;
  const ld = s.lastDiscard;
  if (ld !== null && (!ld || !isValidTile(ld.tile) || !VALID_SEATS.includes(ld.from))) return false;
  const r = s.roundEndReason;
  if (r !== null && (!r || !["tsumo", "ron", "exhaustive_draw", "abortive_draw"].includes(r.type))) return false;
  const g = s.gameEndReason;
  if (g !== null && g !== undefined && (!g || !["all_rounds_complete", "bust"].includes(g.type))) return false;
  return true;
}

// ---------------- 理牌(手牌の並び順) ----------------

const SUIT_SORT_ORDER = { man: 0, pin: 1, sou: 2 };
const HONOR_SORT_ORDER = { east: 0, south: 1, west: 2, north: 3, white: 4, green: 5, red: 6 };

/** 自動理牌の並び順: 萬子1-9 → 筒子1・9 → 索子1・9 → 字牌(東南西北白發中) */
function tileSortKey(kind) {
  if (!kind) return 999; // 伏せ牌(中身を知らされていない牌)は並べ替えない
  if (kind.kind === "number") {
    return SUIT_SORT_ORDER[kind.suit] * 100 + kind.rank;
  }
  return 300 + HONOR_SORT_ORDER[kind.honor];
}

// ---------------- 牌DOM生成 ----------------

/**
 * @param {object} opts
 * @param {boolean} [opts.armed] タッチ操作で「1回目のタップ」により浮いている(選択中)状態か。
 * @param {Function|null} [opts.onArm] タッチ操作の1回目のタップで呼ぶコールバック(牌を浮かせるだけ)。
 */
function makeTileEl(
  tile,
  { faceDown = false, onClick = null, highlight = false, armed = false, onArm = null, dimmed = false } = {}
) {
  // 中身の無い牌(サーバーが伏せて送ってきた相手の手牌・牌山など)は常に裏向きで描く
  if (!tile.kind) faceDown = true;
  const el = document.createElement("button");
  el.type = "button";
  el.className = faceDown
    ? "tile tile-back" + (highlight ? " tile-selectable" : "")
    : "tile tile-img " + tileImageClass(tile.kind) + (highlight ? " tile-selectable" : "");
  if (armed) el.classList.add("tile-armed");
  if (dimmed) el.classList.add("tile-dimmed");
  el.dataset.tileId = tile.id;
  if (!faceDown) el.title = tileTitle(tile.kind);
  el.disabled = !onClick;
  if (onClick) {
    el.addEventListener("click", () => {
      // タッチ/ペン操作の1回目のタップは、誤タップ防止のため牌を浮かせる(選択)だけにし、
      // 実際の打牌は同じ牌をもう一度タップするまで待つ。マウス操作は従来通り1クリックで打牌する。
      if (isTouchLikeInput() && !armed && onArm) {
        onArm();
        return;
      }
      onClick();
    });
  }
  return el;
}

// ---------------- 副露(鳴き)面子の見た目 ----------------

/** 90度右向きに倒した牌を1枚だけ入れる箱(倒した牌の見た目上の幅・高さに合わせて固定サイズにする) */
function makeRotatedTileBox(tile) {
  const box = document.createElement("div");
  box.className = "meld-rotated";
  box.appendChild(makeTileEl(tile));
  return box;
}

/**
 * 副露した面子1つ分のDOMを組み立てる。
 *
 * - ポン・大明槓: 左から2枚目を90度右向きに倒す
 * - 加槓: ポンで倒れていた牌(2枚目)の位置に、加槓で足した4枚目を隙間なく上に重ねて表示する
 * - 暗槓: 1枚目・4枚目を裏向きに表示する(2・3枚目は表向きのまま)
 */
// 横向きに倒した牌の幅(牌の縦横比 221:149)。styles.css の 1.481 と揃える。
const ROTATED_TILE_UNITS = 1.481;

/**
 * スマートフォン横向きの判定(styles.css・shell-ws.html と同じ条件)。
 * 横向きでは卓を「左: 名前・持ち点 / 中央: 手牌・河 / 右: ドラ・設定・操作ボタン」の
 * 3列レイアウト(renderTableLandscape)に切り替える。
 */
const LANDSCAPE_PHONE_MQ =
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(max-height: 480px) and (orientation: landscape)")
    : null;
function isLandscapePhone() {
  return !!(LANDSCAPE_PHONE_MQ && LANDSCAPE_PHONE_MQ.matches);
}
// 手牌(+ツモ牌の枠)の幅は常に固定(--base-tile-w)のまま変えず、面子(鳴いた牌)だけを
// 縮小して1行に収める。そのため、手牌側が必要とする幅(handUnits: 牌の枚数ぶん、
// handFixedPx: ツモ牌との区切り線など牌の大きさによらない余白)と、面子側が必要とする幅
// (meldUnits: 横向きの牌は約1.48枚ぶんとして数えた枚数、meldFixedPx: 手牌と面子の最小間隔・
// 面子どうしの間隔)を分けて返す。styles.css 側で、面子に収まる牌幅 =
// (行の幅 - handUnits*base-tile-w - handFixedPx - meldFixedPx) / meldUnits を求め、
// 通常の面子の牌幅(base-tile-w × --meld-ratio。スマホ縦向きのみ75%)より小さくなる場合だけそちらを使う
// (手牌側の牌幅は常に base-tile-w のまま)。
//
// reserveDrawSlot: ツモ牌の枠(1枚ぶん+区切り線)を幅の計算に含めるか。通常は
// ツモ牌が無くても常に true(枠だけ空けておく)。ただしポン直後(まだ打牌していない間)は
// この打牌の次に自分がツモるのは相手の手番を挟んだ後なので、この枠を確保する意味がなく、
// 確保したままだとぎりぎりの行幅で鳴いた面子だけが一瞬小さく縮んで見えてしまう。
// そのため呼び出し側(render 側の描画)で false を渡し、枠ぶんの幅を空けない。
function handRowUnits(handCount, melds, reserveDrawSlot = true) {
  const handUnits = handCount + (reserveDrawSlot ? 1 : 0); // +1 はツモ牌の枠
  const handFixedPx = reserveDrawSlot ? 4 : 0; // .draw-separator(styles.css の幅と一致させる)
  let meldUnits = 0;
  let meldFixedPx = 0;
  if (melds.length > 0) {
    meldFixedPx = 10 + 3 * (melds.length - 1); // 手牌と面子の最小間隔 + 面子どうしの間隔(3px、styles.css の .melds gap と一致させる)
    for (const m of melds) {
      if (m.type === "kan_closed") meldUnits += 4;
      else if (m.type === "kan_open" && m.viaKakan) meldUnits += 2 + ROTATED_TILE_UNITS;
      else meldUnits += m.tiles.length - 1 + ROTATED_TILE_UNITS;
    }
  }
  return { handUnits, handFixedPx, meldUnits, meldFixedPx };
}

function renderMeldGroup(meld) {
  const el = document.createElement("div");
  el.className = "meld";
  const tiles = meld.tiles;

  if (meld.type === "kan_closed") {
    tiles.forEach((t, idx) => {
      el.appendChild(makeTileEl(t, { faceDown: idx === 0 || idx === 3 }));
    });
    return el;
  }

  if (meld.type === "kan_open" && meld.viaKakan) {
    // tiles = [元のポンの1枚目, 元のポンで倒れていた2枚目, 元のポンの3枚目, 加槓で足した4枚目]
    el.appendChild(makeTileEl(tiles[0]));
    const stack = document.createElement("div");
    stack.className = "meld-rotated-stack";
    stack.appendChild(makeRotatedTileBox(tiles[3])); // 上: 加槓で足した牌
    stack.appendChild(makeRotatedTileBox(tiles[1])); // 下: 元々ポンで倒れていた牌
    el.appendChild(stack);
    el.appendChild(makeTileEl(tiles[2]));
    return el;
  }

  // ポン(3枚)・大明槓(4枚): 左から2枚目だけを倒す
  tiles.forEach((t, idx) => {
    el.appendChild(idx === 1 ? makeRotatedTileBox(t) : makeTileEl(t));
  });
  return el;
}

// ---------------- ゲームコントローラ ----------------

class MahjongApp {
  /**
   * @param {{autoStart?: boolean}} [options] - autoStart: false にすると、
   *   コンストラクタが自動で newGame() を呼ばない(オンライン対戦コントローラ
   *   `OnlineMahjongApp` が、ルームの状態が揃うまでゲーム開始を遅らせるために使う)。
   */
  constructor(root, options = {}) {
    this.root = root;
    // 画面の向きが変わったら、縦向き用/横向き用のレイアウトを描き直す。
    // 卓が破棄された(root から外れた)後は自分で登録を解除する。
    if (LANDSCAPE_PHONE_MQ && LANDSCAPE_PHONE_MQ.addEventListener) {
      const onLayoutChange = () => {
        if (this._destroyed || !this.root.isConnected) {
          LANDSCAPE_PHONE_MQ.removeEventListener("change", onLayoutChange);
          return;
        }
        if (this.state) this.render();
      };
      LANDSCAPE_PHONE_MQ.addEventListener("change", onLayoutChange);
    }
    /** 退室してロビーへ戻る処理(指定されていれば卓の右下に「退室」ボタンを出す) */
    this.onExit = options.onExit || null;
    /** 退室の確認ダイアログを表示中か */
    this.confirmingExit = false;
    /**
     * 結果画面に出す、その局の結果による点数の増減 {east, south}(対局中は null)。
     * 局の途中で最後に見た点数(_preResultScores)と、結果画面になった時点の点数の差。
     * 途中で供託したリーチ棒(-1000)は含まず、和了者が受け取った供託は含む。
     */
    this.roundScoreChange = null;
    this._preResultScores = null;
    /** 対局終了画面で「新しい対局を始める」を選んだか(両家揃ったら新しい対局を始める) */
    this.rematchVotes = { east: false, south: false };
    this.showOpponentHand = false;
    this.log = [];
    /** 自動理牌するか。オフにすると手動でドラッグして並べ替えられる */
    this.autoSort = true;
    /**
     * 「鳴き無し」。オンにすると、相手の捨て牌に対するポン・カンの選択肢を出さず、
     * 自動で見送る(ロンできる場合は通常どおりロンの選択肢を出す。自分の手番での
     * 暗槓・加槓も従来どおり行える)。この画面で操作しているSeatにだけ適用する。
     */
    this.noCall = false;
    /**
     * 「自動和了」。オンにすると、この画面で操作しているSeatがツモ和了・ロン
     * できる状態になったとき、ボタンを押さなくても自動で和了する。
     */
    this.autoWin = false;
    /** 自動和了の予約タイマーと、その対象局面を表すキー(同じ局面で二重に予約しないため) */
    this._autoWinTimer = null;
    this._autoWinKey = null;
    /**
     * 「ツモ切り」。オンにすると、この画面で操作しているSeatの手番で、ツモ和了・暗槓など
     * 選択の余地がない限り、ツモった牌をそのまま自動で打牌する(リーチ中は従来どおり
     * このトグルに関係なく自動でツモ切りする)。
     */
    this.autoTsumogiri = false;
    /**
     * 持ち時間 { perAction, bank }(秒)。null なら持ち時間なし。オンライン対戦ではホストの
     * 設定を対局データと一緒に配信し、相手側もそれに合わせる。
     */
    this.timeControl = options.timeControl !== undefined ? options.timeControl : DEFAULT_TIME_CONTROL;
    /** 各家の「局ごと」の残り時間(ミリ秒)。局が変わるたびに満タンに戻す */
    this._bankMs = { east: 0, south: 0 };
    /** 残り時間を満タンに戻した局(roundKey())。null なら次の render() で必ず戻す */
    this._timerRoundKey = null;
    /** いま時間を計っている判断 { key, seat, kind, startedAt, bankAtStart, fired } */
    this._decision = null;
    this._turnTimerInterval = null;
    /** 局が変わったタイミングを検出するための直近の局キー(roundKey())。
     *  「鳴き無し」「ツモ切り」を次局に持ち越さずオフへ戻すために render() で使う
     *  (「自動理牌」「自動和了」は持ち越すのでここでは触らない)。 */
    this._roundTogglesResetIndex = null;
    /** 手動理牌で決めた並び順(牌IDの配列)。自動理牌中は使わない */
    this.handOrder = { east: [], south: [] };
    /** ドラッグ直後のクリックを打牌として扱わないためのフラグ */
    this.suppressNextClick = false;
    /** タッチ操作で「1回目のタップ」により浮いている(選択中の)牌のID。打牌が確定したら都度クリアする */
    this.armedTileId = null;
    /** 「相手の手牌を表示(確認用)」トグルを出すか。オンライン対戦では
     *  相手の手牌は本物の対戦相手のものなので、このトグルは出さない。 */
    this.allowPeekToggle = true;
    this.lastWin = null;
    /** 和了表示(ツモ/ロン)を出した時刻。WIN_BANNER_DURATION_MS 経ったら自動的に表示を消すために使う */
    this.winBannerShownAt = null;
    this._winBannerTimer = null;
    /** 直近のポン/カン { seat, kind: "ポン" | "カン" }。和了表示と同様、一定時間で自動的に消える */
    this.lastCall = null;
    this.callBannerShownAt = null;
    this._callBannerTimer = null;
    /** 流局(荒牌平局)の結果。setExhaustiveDrawOutcome() 参照 */
    this.lastExhaustiveOutcome = null;
    this.exhaustiveDrawShownAt = null;
    this._exhaustiveDrawTimer = null;
    /** リーチ後の自動ツモ切り用のタイマーと、その対象のツモ牌ID */
    this._autoTsumogiriTimer = null;
    this._autoTsumogiriTileId = null;
    /**
     * 手出し(ツモ切りでない打牌)を相手視点で伏せて見せた瞬間、その家の手牌背面の
     * 1枚をランダムに一瞬だけ透明にする演出のためのタイマー(doDiscard 参照)。
     */
    this._tedashiRevealTimer = null;
    /**
     * 局の結果画面での「確認」状態。両家が確認するか、表示から RESULT_AUTO_ADVANCE_MS
     * 経過した時点で次の局へ進む(実際に nextRound() を呼ぶのは canAct("nextRound") の側だけ)。
     */
    this.roundConfirmations = { east: false, south: false };
    this._resultTimer = null;
    this._resultCountdownTimer = null;
    this._resultDeadline = null;
    if (options.autoStart !== false) {
      this.newGame();
    }
  }

  /**
   * 新しい対局の起家(最初の親)にする Seat。ローカル対戦・CPU対戦は常に east
   * (CPU対戦は人が座る家を変えて起家を選ぶ)。オンライン対戦はルーム作成時の設定で決める。
   */
  chooseStartingDealer() {
    return "east";
  }

  newGame() {
    const { wall } = E.buildWall();
    const revealed = E.revealNextDoraIndicator(wall);
    const dealer = this.chooseStartingDealer();
    // 配牌は親(東家)から順に配る
    const { wall: dealtWall, hands } = E.dealInitialHands(revealed, [dealer, E.otherSeat(dealer)]);

    this.state = {
      gameId: "local",
      phase: "draw",
      roundWind: "east",
      roundNumber: 1,
      overallRoundIndex: 1,
      // 配牌ごとの通し番号(フロント側で管理)。連荘では overallRoundIndex が変わらないため、
      // 「局が変わった」ことの判定(持ち時間・トグルのリセット)にはこちらを使う。
      roundSerial: 1,
      riichiSticks: 0,
      startingDealer: dealer,
      dealer,
      kanCount: 0,
      fourKanAbortivePending: false,
      wall: dealtWall,
      players: {
        east: Object.assign({}, E.createInitialPlayerState("east", 45000), { hand: hands.east }),
        south: Object.assign({}, E.createInitialPlayerState("south", 45000), { hand: hands.south }),
      },
      currentTurn: dealer,
      lastDiscard: null,
      roundEndReason: null,
      totalRounds: 8,
      startingScore: 45000,
      gameEndReason: null,
    };
    this.pendingRiichi = false;
    this.revealUraDora = false;
    this.setLastWin(null);
    this.setLastCall(null);
    this.handOrder = { east: [], south: [] };
    this.roundConfirmations = { east: false, south: false };
    this.rematchVotes = { east: false, south: false };
    // 「鳴き無し」「ツモ切り」は新しい対局の開始時にもオフへ戻す。render() 側の
    // 次局判定(_roundTogglesResetIndex)もここで初期化しておく(初回 render() で
    // 誤って「局が変わった」と判定してオフに戻されること自体は無害だが、その前に
    // 明示的にオフにしておくことで意図をはっきりさせる)。
    this.noCall = false;
    this.autoTsumogiri = false;
    this._roundTogglesResetIndex = this.roundKey();
    this._timerRoundKey = null;
    this.clearResultTimers();
    this.addLog(`新しい対局を開始しました(起家: ${this.playerName(dealer)})`);
    this.publish();
  }

  addLog(msg) {
    this.log.unshift(msg);
    if (this.log.length > 30) this.log.pop();
  }

  /**
   * lastWin(ツモ/ロン和了の内容)を設定する。設定と同時に、和了表示(ツモ/ロンの文字)を
   * WIN_BANNER_DURATION_MS 後に自動で消すタイマーを仕掛ける。オンライン対戦で相手から届いた
   * lastWin を反映する場合もこれを通す(ローカルで和了を宣言した場合と同じタイミングで
   * 消えるように)。
   */
  setLastWin(win) {
    this.lastWin = win;
    if (this._winBannerTimer) {
      clearTimeout(this._winBannerTimer);
      this._winBannerTimer = null;
    }
    if (win) {
      this.winBannerShownAt = Date.now();
      this._winBannerTimer = setTimeout(() => {
        this._winBannerTimer = null;
        this.render();
      }, WIN_BANNER_DURATION_MS);
    } else {
      this.winBannerShownAt = null;
    }
  }

  /**
   * lastExhaustiveOutcome(流局の結果)を設定する。setLastWin と同様、設定と同時に
   * WIN_BANNER_DURATION_MS 後に画面全体を暗くした「流局」表示を自動的に消す
   * タイマーを仕掛ける(それまでは isExhaustiveDrawRevealing() が true になり、
   * 結果のボックスはまだ出ない)。オンライン対戦で相手から届いた結果を反映する
   * 場合もこれを通す。
   */
  setExhaustiveDrawOutcome(outcome) {
    this.lastExhaustiveOutcome = outcome;
    if (this._exhaustiveDrawTimer) {
      clearTimeout(this._exhaustiveDrawTimer);
      this._exhaustiveDrawTimer = null;
    }
    if (outcome) {
      this.exhaustiveDrawShownAt = Date.now();
      this._exhaustiveDrawTimer = setTimeout(() => {
        this._exhaustiveDrawTimer = null;
        this.render();
      }, WIN_BANNER_DURATION_MS);
    } else {
      this.exhaustiveDrawShownAt = null;
    }
  }

  /**
   * lastCall(ポン/カンの内容)を設定する。setLastWin と同様、表示から
   * CALL_BANNER_DURATION_MS 後に自動で消えるタイマーを仕掛ける。
   */
  setLastCall(call) {
    // オンライン対戦では相手の画面にも同じ表示を出すため lastCall を配信するが、
    // 「同じポン/カン/リーチの再受信」と「新しいポン/カン/リーチ」を区別できないと、
    // 無関係な状態更新が届くたびに表示が出し直されてしまう。1回ごとに固有の
    // 通し番号(seq)を持たせ、受信側はこれが変わった時だけ表示するようにする。
    this.lastCall = call ? Object.assign({}, call, { seq: call.seq != null ? call.seq : Date.now() }) : null;
    if (this._callBannerTimer) {
      clearTimeout(this._callBannerTimer);
      this._callBannerTimer = null;
    }
    if (call) {
      this.callBannerShownAt = Date.now();
      this._callBannerTimer = setTimeout(() => {
        this._callBannerTimer = null;
        this.render();
      }, CALL_BANNER_DURATION_MS);
    } else {
      this.callBannerShownAt = null;
    }
  }

  /** Seat(固定のプレイヤー識別子)から、その局における実際の自風の「〜家」表示を得る */
  seatLabel(seat) {
    return windLabel(E.seatWindOf(this.state, seat));
  }

  /**
   * 画面の得点表示などに使う「プレイヤー名」。ローカル対戦(同一画面ホットシート)には
   * 個別のプレイヤー名という概念がないため、従来通り「東家」「南家」を返す。
   * オンライン対戦(自前サーバー方式)では OnlineMahjongApp がこれをオーバーライドし、
   * ルーム入室時に入力された実際のプレイヤー名を返す。
   */
  playerName(seat) {
    return `${this.seatLabel(seat)}家`;
  }

  // ---------------- オンライン対戦向けフック ----------------
  //
  // ローカル対戦(同画面ホットシート)では両方のSeatを同じ画面から操作できるため、
  // 以下はすべて「常に許可」でよい。OnlineMahjongApp はこれらだけをオーバーライドし、
  // 「今どちらのSeatが操作してよいか」をネットワーク越しの自分のSeatと突き合わせる。

  /** 画面の下側(自分側)に表示するSeat。ローカル対戦では常に east を自分側として描画する。 */
  selfSeat() {
    return "east";
  }

  /** 画面の上側(相手側)に表示するSeat。 */
  opponentSeat() {
    return "south";
  }

  /**
   * 「今この操作をしてよいか」を判定するフック。
   *
   * kind: "discard"(打牌フェーズの操作全般) | "callWindow"(ロン・ポン・カン・スルー) |
   *       "nextRound"(次局へ進める) | "newGame"(新しい対局を始める) |
   *       "autoAdvance"(自動ツモ・自動スルーの進行)
   * seat: その操作を行う(行いうる)Seat。nextRound/newGame では省略される。
   *
   * ローカル対戦では両Seatとも自分が操作するので常に true。
   */
  canAct(kind, seat) {
    return true;
  }

  /**
   * 状態が変化した後の「確定した結果を反映する」呼び出し。ローカル対戦ではただ再描画するだけ。
   * オンライン対戦では、ここで共有ドキュメントへ書き込む(そのうえで即座に再描画もする)。
   *
   * ゲームの状態が実際に進んだタイミングなので、タッチ操作で浮かせていた牌の選択も
   * ここでリセットする(打牌が確定した/手番が変わった等の後に、古い選択が残らないように)。
   */
  publish() {
    this.armedTileId = null;
    this.render();
  }

  /**
   * タッチ操作の1回目のタップ: 牌を浮かせて選択状態にするだけで、まだ打牌はしない
   * (誤タップ防止)。同じ牌をもう一度タップすると、makeTileEl 側の判定で実際の
   * 打牌(onClick)が呼ばれる。別の牌をタップした場合は、そちらが新たに選択状態になる。
   */
  armTile(tileId) {
    this.armedTileId = tileId;
    this.render();
  }

  // ---------------- 理牌 ----------------

  /**
   * 表示する手牌の並びを決める。ツモ牌はここには含めない(常に一番右へ別枠で表示する)。
   *
   * 自動理牌中は毎回ソートし直す。手動理牌中は記憶しておいた並び順を尊重しつつ、
   * そこに無い牌(打牌後に手牌へ合流したツモ牌など)は右端に足す。
   */
  orderedHand(seat) {
    const hand = this.state.players[seat].hand;
    if (this._dealAnim) {
      // 配牌の演出中: 配られた順(左から)に並べる。まだ配っていない牌は renderHand() で
      // 見えなくする(場所は確保したまま)。配り終えた後の「理牌」の段階で、自動理牌がオンなら並べ替える。
      if (this._dealAnim.sorted && this.autoSort) {
        return [...hand].sort((a, b) => tileSortKey(a.kind) - tileSortKey(b.kind));
      }
      return [...hand];
    }
    if (this.autoSort) {
      return [...hand].sort((a, b) => tileSortKey(a.kind) - tileSortKey(b.kind));
    }

    const byId = new Map(hand.map((t) => [t.id, t]));
    const ordered = [];
    for (const id of this.handOrder[seat]) {
      const tile = byId.get(id);
      if (tile) {
        ordered.push(tile);
        byId.delete(id);
      }
    }
    // 並び順を記憶していない牌(新しく手牌に加わった牌)は右端へ
    for (const tile of hand) {
      if (byId.has(tile.id)) ordered.push(tile);
    }
    return ordered;
  }

  /** その手牌をドラッグで並べ替えてよいか(手動理牌中で、かつ伏せられていない手牌のみ) */
  canReorderHand(seat) {
    if (this.autoSort) return false;
    const isHidden = !this.showOpponentHand && this.hiddenSeatFor() === seat;
    return !isHidden;
  }

  setAutoSort(enabled) {
    if (!enabled) {
      // 自動→手動へ切り替えた瞬間に並びが変わらないよう、今の表示順を引き継ぐ
      for (const seat of ["east", "south"]) {
        this.handOrder[seat] = this.orderedHand(seat).map((t) => t.id);
      }
    }
    this.autoSort = enabled;
    this.render();
  }

  /**
   * 手牌のドラッグ並べ替えを有効にする。
   * ドラッグ中は再描画せずDOMを直接動かし、離した時点で並び順を確定させる
   * (再描画するとポインタ操作の対象要素が作り直されてしまうため)。
   */
  enableHandDrag(handTilesWrap, seat) {
    // クリック(打牌)とドラッグ(並べ替え)を区別するための移動量のしきい値。
    // 小さすぎるとマウス/指の僅かなブレだけでドラッグ扱いになり、
    // 打牌のクリックが誤って並べ替えとして吸収されてしまうため、余裕を持たせる。
    const DRAG_THRESHOLD_PX = 40;

    let draggingId = null;
    let startX = 0;
    let startY = 0;
    let moved = false;

    const tileEls = () => Array.from(handTilesWrap.querySelectorAll(".tile[data-tile-id]"));

    let pointerId = null;

    handTilesWrap.addEventListener("pointerdown", (ev) => {
      const el = ev.target.closest(".tile[data-tile-id]");
      if (!el) return;
      draggingId = el.dataset.tileId;
      pointerId = ev.pointerId;
      startX = ev.clientX;
      startY = ev.clientY;
      moved = false;
      this.suppressNextClick = false;
      // ここでは見た目を一切変えない・ポインタも奪わない。
      // 押しただけの単純なクリック(打牌)の場合、ここで牌を浮かせてしまうと
      // 指/マウスの位置に対して牌の見た目がずれ、離した瞬間に牌の外に
      // カーソルが外れて click が発火しなくなる(=打牌できなくなる)ため、
      // 「実際にしきい値を超えてドラッグと確定した瞬間」まで先送りする。
    });

    handTilesWrap.addEventListener("pointermove", (ev) => {
      if (draggingId === null) return;
      if (!moved) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD_PX) return; // 手ブレはクリック扱いのまま
        moved = true;
        // ここで初めてドラッグ確定。見た目の変更とポインタキャプチャもこの時点で行う。
        handTilesWrap.setPointerCapture(pointerId);
        const draggedEl = tileEls().find((el) => el.dataset.tileId === draggingId);
        if (draggedEl) draggedEl.classList.add("tile-dragging");
      }

      const els = tileEls();
      const dragEl = els.find((el) => el.dataset.tileId === draggingId);
      const others = els.filter((el) => el.dataset.tileId !== draggingId);

      // ポインタのX座標が、どの牌と牌の間に来ているかを調べる
      let insertAt = others.length;
      for (let i = 0; i < others.length; i++) {
        const rect = others[i].getBoundingClientRect();
        if (ev.clientX < rect.left + rect.width / 2) {
          insertAt = i;
          break;
        }
      }
      handTilesWrap.insertBefore(dragEl, others[insertAt] || null);
    });

    const finish = () => {
      if (draggingId === null) return;
      const dragEl = handTilesWrap.querySelector(".tile-dragging");
      if (dragEl) dragEl.classList.remove("tile-dragging");
      if (moved) {
        this.handOrder[seat] = tileEls().map((el) => el.dataset.tileId);
        this.suppressNextClick = true; // 並べ替え終わりのクリックで打牌しない
      }
      draggingId = null;
      moved = false;
    };

    handTilesWrap.addEventListener("pointerup", finish);
    handTilesWrap.addEventListener("pointercancel", finish);
  }

  currentHandWithDraw(seat) {
    const p = this.state.players[seat];
    return p.drawnTile ? p.hand.concat([p.drawnTile]) : p.hand.slice();
  }

  // ---------------- アクション ----------------

  /**
   * 相手の捨て牌に対してロン・ポン・カンができるかをまとめて調べる。
   * call_window の表示判定と、後述の自動スルー判定の両方で使う共通ロジック。
   */
  /**
   * 「鳴き無し」がこのSeatに適用されるか。
   * オンライン対戦では自分が操作しているSeatにだけ効く(相手の鳴きを勝手に見送らせない)。
   */
  isNoCallFor(seat) {
    return this.noCall && this.canAct("callWindow", seat);
  }

  computeCallOptions(seat, discardTile) {
    const player = this.state.players[seat];
    const context = E.buildWinContext(this.state, seat, discardTile, false);
    const canRon = E.canDeclareRon(
      player.hand,
      player.melds,
      player.discards.map((d) => d.tile),
      E.isMissedRonFuriten(player),
      discardTile,
      context
    );
    const canPon = E.canDeclarePon(
      player.hand,
      discardTile,
      player.isRiichi,
      this.state.wall.liveWall.length,
      this.state.fourKanAbortivePending
    );
    const canMinkan = E.canDeclareMinkan(
      player.hand,
      discardTile,
      player.isRiichi,
      this.state.wall.liveWall.length,
      this.state.kanCount
    );
    // 「鳴き無し」中はポン・カンを最初から無かったことにする。こうすることで、
    // 選択肢が出ないだけでなく autoAdvance() 側でも自動的にスルーされる
    // (ロンだけは通常どおり残る)。
    if (this.isNoCallFor(seat)) {
      return { canRon, canPon: false, canMinkan: false };
    }
    return { canRon, canPon, canMinkan };
  }

  /**
   * 人の操作を必要としない進行を自動で行う。
   *
   * - 手番プレイヤーのツモ動作は常に自動(クリック不要)
   * - 相手の捨て牌に対してロン・ポン・カンのいずれも起こり得ない場合のスルーも自動
   *
   * ロン・ポン・カンのいずれかが発生し得る捨て牌に対してだけ、call_window を残して
   * 画面を止め、人の判断を待つ。render() の先頭から毎回呼び出す。
   *
   * 戻り値: 実際に状態を1回以上進めた(=何かを書き換えた)か。オンライン対戦では、
   * ここでの自動進行(自動ツモ・自動スルー)も本来のプレイヤー操作と同じく共有
   * ドキュメントへ配信しなければならないため、render() 側がこの戻り値を見て
   * afterAutoAdvance() フックを呼ぶ(ローカル対戦では使わない)。
   */
  autoAdvance() {
    // 配牌の演出中は、最初のツモ(親の自摸)をまだ行わない
    if (this._dealAnim) return false;
    let changed = false;
    while (true) {
      // オンライン対戦では、この局面を進める権利を持つSeat側の画面だけが実際に
      // 状態を進めて書き込む(そうでない側はここで抜け、相手側の書き込みが
      // 共有ドキュメント経由で届くのを待つ)。ローカル対戦では canAct は常に true。
      if (!this.canAct("autoAdvance", this.activeSeat())) break;

      if (this.state.phase === "draw") {
        if (this.state.wall.liveWall.length === 0) {
          this.snapshotPreResultScores();
          const outcome = E.resolveExhaustiveDraw(this.state);
          this.state = outcome.state;
          this.setExhaustiveDrawOutcome(outcome);
          const tenpaiLabel = outcome.tenpaiSeats.map((s) => this.seatLabel(s)).join("・") || "なし";
          this.addLog(`流局(牌山が尽きました)。聴牌: ${tenpaiLabel}`);
          if (outcome.nagashiYakumanSeats.length > 0) {
            this.addLog(`流し役満成立: ${outcome.nagashiYakumanSeats.map((s) => this.seatLabel(s)).join("・")}`);
          }
          changed = true;
          break;
        }
        const seat = this.state.currentTurn;
        this.state = E.drawTile(this.state);
        this.addLog(`${this.seatLabel(seat)}家がツモりました`);
        changed = true;
        continue;
      }

      if (this.state.phase === "call_window") {
        const discard = this.state.lastDiscard;
        const seat = E.otherSeat(discard.from);
        const { canRon, canPon, canMinkan } = this.computeCallOptions(seat, discard.tile);
        if (canRon || canPon || canMinkan) break;
        this.state = E.passDiscard(this.state);
        this.logAbortiveDrawIfAny();
        changed = true;
        continue;
      }

      break;
    }
    return changed;
  }

  doDiscard(tile) {
    if (this._tedashiTimer) return; // 手出し演出中の二重打牌を防ぐ
    const seat = this.state.currentTurn;
    const player = this.state.players[seat];
    const isTedashi = !player.drawnTile || player.drawnTile.id !== tile.id;
    const declaredRiichi = this.pendingRiichi;

    const finalize = () => {
      this.state = E.discardTile(this.state, tile, this.pendingRiichi);
      this.addLog(`${this.seatLabel(seat)}家が ${tileTitle(tile.kind)} を打牌${declaredRiichi ? "(リーチ)" : ""}しました`);
      this.pendingRiichi = false;
      if (declaredRiichi) {
        // ポン・カンと同様、リーチ宣言時にも本人の手牌側に大きな文字を短時間表示する。
        this.setLastCall({ seat, kind: "リーチ" });
      }
      this.publish();
    };

    // 手出し(ツモ切りでない打牌)で、かつその家の手牌がいま伏せて(相手視点で)表示
    // されている場合だけ、打牌が確定する直前のごく短い間、伏せ牌のうちランダムな
    // 1枚を透明にして「今のは手出しだった」というヒントを与える(スライドではなく
    // レイアウトを変えない単純な空白表示)。自分自身の手番中は自分の手牌が伏せられる
    // ことはない(実際の手牌が見えているのでヒントも不要)ため、実質的にはオンライン
    // 対戦の受信側(online-shared.js の _onRoomDoc)でこの仕組みが使われる。
    if (isTedashi && this.hiddenSeatFor() === seat) {
      this._tedashiGap = { seat, index: Math.floor(Math.random() * player.hand.length) };
      this.render();
      this._tedashiTimer = setTimeout(() => {
        this._tedashiTimer = null;
        this._tedashiGap = null;
        finalize();
      }, TEDASHI_GAP_MS);
      return;
    }

    finalize();
  }

  doTsumo() {
    const seat = this.state.currentTurn;
    const wasRiichi = this.state.players[seat].isRiichi;
    this.snapshotPreResultScores();
    const { state, scoreResult, dora } = E.declareTsumo(this.state, seat);
    this.state = state;
    this.revealUraDora = wasRiichi;
    this.setLastWin({ seat, kind: "ツモ和了", scoreResult, dora });
    this.addLog(`${this.seatLabel(seat)}家がツモ和了! ${this.formatWin(scoreResult, dora)}`);
    this.publish();
  }

  doRon() {
    const discard = this.state.lastDiscard;
    const winner = E.otherSeat(discard.from);
    const wasRiichi = this.state.players[winner].isRiichi;
    this.snapshotPreResultScores();
    const { state, scoreResult, dora } = E.declareRon(this.state, winner, discard.tile);
    this.state = state;
    this.revealUraDora = wasRiichi;
    this.setLastWin({ seat: winner, kind: "ロン和了", scoreResult, dora });
    this.addLog(`${this.seatLabel(winner)}家がロン和了! ${this.formatWin(scoreResult, dora)}`);
    this.publish();
  }

  /**
   * 4回目のカン(四槓子の場合を除く)の打牌がロンされなかった場合、途中流局(四開槓)になる。
   * その他の保険的な途中流局のケースも含め、状態遷移の直後に呼び、必要ならログへ残す。
   */
  logAbortiveDrawIfAny() {
    if (this.state.phase === "round_end" && this.state.roundEndReason && this.state.roundEndReason.type === "abortive_draw") {
      this.addLog(`途中流局(${this.state.roundEndReason.reason})になりました`);
    }
  }

  doPass() {
    // ロンできたのに見送った場合は同巡内の一時的フリテンを立てる
    const discard = this.state.lastDiscard;
    const seat = E.otherSeat(discard.from);
    const { canRon } = this.computeCallOptions(seat, discard.tile);
    if (canRon) {
      this.state = E.markMissedRon(this.state, seat);
    }
    this.state = E.passDiscard(this.state);
    this.logAbortiveDrawIfAny();
    this.publish();
  }

  doPon(seat) {
    const discard = this.state.lastDiscard;
    const key = E.tileKindKey(discard.tile.kind);
    const matches = this.state.players[seat].hand.filter((t) => E.tileKindKey(t.kind) === key);
    const wasFourKanPending = this.state.fourKanAbortivePending;
    this.state = E.callPon(this.state, seat, [matches[0], matches[1]]);
    if (wasFourKanPending) {
      this.logAbortiveDrawIfAny();
    } else {
      this.setLastCall({ seat, kind: "ポン" });
      this.addLog(`${this.seatLabel(seat)}家がポンしました(${tileTitle(discard.tile.kind)})`);
    }
    this.publish();
  }

  doMinkan(seat) {
    const discard = this.state.lastDiscard;
    const key = E.tileKindKey(discard.tile.kind);
    const matches = this.state.players[seat].hand.filter((t) => E.tileKindKey(t.kind) === key);
    this.state = E.performMinkan(this.state, seat, [matches[0], matches[1], matches[2]]);
    this.setLastCall({ seat, kind: "カン" });
    this.addLog(`${this.seatLabel(seat)}家が大明槓しました(${tileTitle(discard.tile.kind)})`);
    this.logAbortiveDrawIfAny();
    this.publish();
  }

  doAnkan(kind) {
    const seat = this.state.currentTurn;
    this.state = E.performAnkan(this.state, kind);
    this.setLastCall({ seat, kind: "カン" });
    this.addLog(`${this.seatLabel(seat)}家が暗槓しました(${tileTitle(kind)})`);
    this.logAbortiveDrawIfAny();
    this.publish();
  }

  doKakan(kind) {
    const seat = this.state.currentTurn;
    this.state = E.performKakan(this.state, kind);
    this.setLastCall({ seat, kind: "カン" });
    this.addLog(`${this.seatLabel(seat)}家が加槓しました(${tileTitle(kind)})`);
    this.logAbortiveDrawIfAny();
    this.publish();
  }

  nextRound() {
    // 結果画面以外から(タイマーの二重発火などで)呼ばれても局を飛ばさない
    if (!this.state || this.state.phase !== "round_end") return;
    this.clearResultTimers();
    this.roundConfirmations = { east: false, south: false };
    let tenpaiSeats = [];
    if (this.state.roundEndReason && this.state.roundEndReason.type === "exhaustive_draw" && this.lastExhaustiveOutcome) {
      tenpaiSeats = this.lastExhaustiveOutcome.tenpaiSeats;
    }
    const continues = E.determineDealerContinuation(this.state, tenpaiSeats);
    const prevSerial = this.state.roundSerial || 0;
    this.state = Object.assign({}, E.advanceRound(this.state, continues), { roundSerial: prevSerial + 1 });
    this.revealUraDora = false;
    this.setLastWin(null);
    this.setLastCall(null);
    this.addLog(
      this.state.phase === "game_end"
        ? "対局が終了しました"
        : `次局: ${windLabel(this.state.roundWind)}${this.state.roundNumber}局(親: ${this.seatLabel(this.state.dealer)}家)`
    );
    this.publish();
  }

  /** 和了ログに添えるドラの内訳。ドラが1枚も乗らなかった場合は何も表示しない。 */
  /** 成立した役とドラを「役名1・役名2・ドラ2」の形に並べる */
  formatYakuNames(scoreResult, dora) {
    return this.yakuNameList(scoreResult, dora).join("・");
  }

  /** 表示順に並べた役名(+ドラ)の配列 */
  yakuNameList(scoreResult, dora) {
    const names = sortYakuForDisplay(scoreResult.yaku).map((y) => y.name);
    // 役満・ダブル役満(役そのもので確定した役満)はドラを翻数計算に使わないため、
    // ドラの数は併記しない。数え役満(翻数を数えた結果13翻以上になったもの)は
    // ドラも翻数に含まれているため、従来通り表示する。
    // scoreResult.totalHan は「翻数で点数帯が決まった場合」だけ入っている値なので、
    // これが無い(undefined)ときが、役そのもので確定した役満・ダブル役満にあたる。
    const isPureYakuman = scoreResult.tier && scoreResult.tier.kind === "yakuman" && scoreResult.totalHan === undefined;
    if (!isPureYakuman) {
      if (dora && dora.dora > 0) names.push(`ドラ${dora.dora}`);
      if (dora && dora.uraDora > 0) names.push(`裏ドラ${dora.uraDora}`);
    }
    return names;
  }

  /**
   * 「a飜b符 c点」、満貫以上なら「a飜b符 満貫 c点」の形にする。
   *
   * 役満や三槓子のように翻数ではなく役そのもので点数が決まる場合は、
   * 翻数・符が存在しないため点数帯と点数だけを出す。
   */
  formatScore(scoreResult) {
    if (!scoreResult.tier) return `${scoreResult.points}点`;

    const tier = scoreResult.tier;
    const points = `${scoreResult.points}点`;

    // 翻数で点数帯が決まった場合のみ「a飜b符」を出せる
    const han = tier.kind === "points" ? tier.han : scoreResult.totalHan;
    const fu = tier.kind === "points" ? tier.fu : scoreResult.fu;
    // 国士無双(13面待ち以外、8翻)を含む場合は符の概念が無いため「a飜 c点」とする
    const isKokushi = (scoreResult.yaku || []).some((y) => y.id === "kokushi_other");
    const hanFu = han === undefined ? "" : isKokushi ? `${han}飜 ` : `${han}飜${fu}符 `;

    if (tier.kind === "points") {
      return `${hanFu}${points}`;
    }
    if (tier.kind === "fixed") {
      const tierNames = { mangan: "満貫", haneman: "跳満", baiman: "倍満", sanbaiman: "三倍満" };
      return `${hanFu}${tierNames[tier.tier]} ${points}`;
    }
    // 数え役満(翻数で到達したもの)と、役そのものによる役満を区別して表示する
    const yakumanLabel = han !== undefined ? "数え役満" : yakumanMultiplierLabel(tier.multiplier);
    return `${hanFu}${yakumanLabel} ${points}`;
  }

  /** 和了の内容をひとまとめにした表示(役の羅列 + 翻数符 + 点数) */
  formatWin(scoreResult, dora) {
    return `${this.formatYakuNames(scoreResult, dora)} ${this.formatScore(scoreResult)}`;
  }

  // ---------------- 描画 ----------------

  render() {
    // 局が変わったら「鳴き無し」「ツモ切り」は次局へ持ち越さずオフに戻す
    // (「自動理牌」「自動和了」は持ち越すのでここでは触らない)。
    if (this.state && this.roundKey() !== this._roundTogglesResetIndex) {
      this._roundTogglesResetIndex = this.roundKey();
      this.noCall = false;
      this.autoTsumogiri = false;
    }
    // 局の始まりなら配牌の演出を始める(演出中は最初のツモを待たせる)
    this.updateDealAnimation();
    // 人の操作を待たずに進めてよいフェーズ(ツモ動作・鳴き/和了不可のスルー)を先に解消する。
    const advanced = this.autoAdvance();
    // 結果画面での点数の増減は、送信(afterAutoAdvance)より前に確定させておく
    this.trackRoundScoreChange();
    if (advanced) this.afterAutoAdvance();
    // 持ち時間: 局・判断の切り替わりを反映してから描画する(表示に残り時間を出すため)
    this.syncTurnTimer();
    this.root.innerHTML = "";
    this.root.appendChild(this.renderTable());
    this.appendExitConfirm();
    // リーチ後でツモ切りしか選べない場合は、少し待ってから自動で打牌する
    this.scheduleAutoTsumogiri();
    this.scheduleAutoWin();
    this.syncResultTimer();
    this.playSoundsForChanges();
    // 牌譜の記録(CPU対戦・オンライン対戦・観戦。状態が変わった時だけ1コマ増える)
    if (this.kifuRecorder) this.kifuRecorder.capture(this);
    // 対局ログ(内部的には引き続き記録するが、画面表示は不要とのことなので非表示にする)
  }

  // ---------------- 配牌の演出 ----------------

  /** その配牌を識別する値(局の通し番号+最初のドラ表示牌。再戦で局番号が同じでも区別できる) */
  dealKey() {
    const s = this.state;
    if (!s) return null;
    const dora = s.wall && s.wall.revealedDoraIndicators && s.wall.revealedDoraIndicators[0];
    return `${this.roundKey()}:${dora ? dora.id : "-"}`;
  }

  /** 配牌の直後で、まだ誰もツモっていない局面か */
  isFreshDeal() {
    const s = this.state;
    if (!s || s.phase !== "draw" || !s.players) return false;
    return ["east", "south"].every((seat) => {
      const p = s.players[seat];
      return p && p.hand.length === 13 && !p.drawnTile && p.discards.length === 0 && p.melds.length === 0;
    });
  }

  /** 配牌の演出で、いま seat に何枚配り終えているか */
  dealtCountFor(seat) {
    const anim = this._dealAnim;
    if (!anim) return 13;
    let count = 0;
    let step = 0;
    for (const n of DEAL_CHUNKS) {
      for (const who of anim.order) {
        if (step >= anim.step) return count;
        if (who === seat) count += n;
        step++;
      }
    }
    return count;
  }

  /**
   * 局の始まりを検知したら配牌の演出を始める(render() の最初に呼ぶ)。
   * 演出中に局が変わった・対局が進んだ(相手の打牌が届いた等)場合は演出を打ち切る。
   * 途中から画面を開いた(再接続・観戦開始)場合は、配牌直後の局面でなければ演出しない。
   */
  updateDealAnimation() {
    const s = this.state;
    if (!s || !s.players) return;
    const key = this.dealKey();
    if (this._dealAnim) {
      const progressed =
        s.phase === "round_end" ||
        s.phase === "game_end" ||
        ["east", "south"].some((seat) => s.players[seat].discards.length > 0 || s.players[seat].melds.length > 0);
      if (this._dealAnim.key !== key || progressed) this._dealAnim = null;
    }
    if (key === this._dealSeenKey) return;
    this._dealSeenKey = key;
    if (this.isFreshDeal()) this.startDealAnimation(key);
  }

  startDealAnimation(key) {
    const s = this.state;
    const dealer = s.dealer || s.currentTurn || "east";
    const order = [dealer, dealer === "east" ? "south" : "east"];
    this._dealAnim = { key, step: 0, sorted: false, order };
    // 自動理牌がオフの場合に備え、手動の並び順も配られた順で作り直す(前の局の並び順は使わない)
    this.handOrder = {
      east: s.players.east.hand.map((t) => t.id),
      south: s.players.south.hand.map((t) => t.id),
    };
    const totalSteps = DEAL_CHUNKS.length * order.length;
    const alive = () => !this._destroyed && this.root.isConnected && this._dealAnim && this._dealAnim.key === key;
    for (let step = 1; step <= totalSteps; step++) {
      setTimeout(() => {
        if (!alive()) return;
        this._dealAnim.step = step;
        MahjongSound.deal();
        this.render();
      }, step * DEAL_STEP_MS);
    }
    // 配り終えたら理牌
    setTimeout(() => {
      if (!alive()) return;
      this._dealAnim.step = totalSteps;
      this._dealAnim.sorted = true;
      this.render();
    }, (totalSteps + 1) * DEAL_STEP_MS);
    // 理牌の後、最初のツモ(持ち時間の計測もここから)
    setTimeout(() => {
      if (!alive()) return;
      this._dealAnim = null;
      this.render();
    }, (totalSteps + 2) * DEAL_STEP_MS);
  }

  /**
   * 前回の描画からの変化に応じて、打牌音・発声を鳴らす。
   * 操作した場所(自分の操作・CPU・オンラインの相手・観戦)を問わず同じ判定で鳴るよう、
   * 個々の操作の中ではなく、描画のたびに状態を比べて判断する。最初の描画(対局画面を
   * 開いた・再接続した・観戦を始めた直後)は記録するだけで鳴らさない(途中の局面の
   * 発声が遅れて鳴らないように)。
   */
  playSoundsForChanges() {
    const s = this.state;
    if (!s || !s.players || !s.players.east || !s.players.south) return;
    const me = this.selfSeat();
    const mine = s.players[me];
    // 操作ボタン(ツモ・リーチ・カン・ポン・ロン・スルーなど)が出ているか。出ているボタンは
    // 自分が操作できる時だけ描かれる(相手の番・観戦中は出ない)。
    const hasChoices = !!this.root.querySelector(".side-actions button");
    const inResult = s.phase === "round_end" || s.phase === "game_end";
    const outcome = this.lastExhaustiveOutcome;
    const snap = {
      round: this.roundKey(),
      discards: { east: s.players.east.discards.length, south: s.players.south.discards.length },
      callSeq: this.lastCall ? this.lastCall.seq : null,
      win: this.lastWin ? `${this.lastWin.seat}:${this.lastWin.kind}` : null,
      me,
      drawn: {
        east: s.players.east.drawnTile ? s.players.east.drawnTile.id : null,
        south: s.players.south.drawnTile ? s.players.south.drawnTile.id : null,
      },
      sticks: { east: this.hasRiichiStick("east"), south: this.hasRiichiStick("south") },
      // 和了画面(結果のボックス)が出ている間の識別子。「ロン」「ツモ」の大きい文字だけの間は含めない
      winResult:
        inResult && this.lastWin && !this.isWinRevealing() ? `${this.roundKey()}:${this.lastWin.seat}:${this.lastWin.kind}` : null,
      // 流局の結果のボックスが出ている間の識別子と、鳴らす点棒の音
      //   流し役満あり → tenbou4 / 聴牌者とノーテン者がいる(ノーテン罰符のやり取りがある) → tenbou1
      drawPayment: null,
      // 同じ判断の局面の間は、描き直しても通知音を繰り返さないための識別子
      choiceKey: hasChoices
        ? [
            this.roundKey(), s.phase,
            s.players.east.discards.length, s.players.south.discards.length,
            s.players.east.melds.length, s.players.south.melds.length,
            mine && mine.drawnTile ? mine.drawnTile.id : "-",
          ].join(":")
        : null,
    };
    if (
      inResult &&
      !this.lastWin &&
      s.roundEndReason &&
      s.roundEndReason.type === "exhaustive_draw" &&
      !this.isExhaustiveDrawRevealing() &&
      outcome
    ) {
      const nagashi = Array.isArray(outcome.nagashiYakumanSeats) && outcome.nagashiYakumanSeats.length > 0;
      const payment = Array.isArray(outcome.tenpaiSeats) && outcome.tenpaiSeats.length === 1;
      if (nagashi || payment) snap.drawPayment = `${this.roundKey()}:${nagashi ? 4 : 1}`;
    }
    const prev = this._soundSnap;
    this._soundSnap = snap;
    if (!prev || this._destroyed) return;
    const sameRound = prev.round === snap.round;
    // 同じ描画の中で複数の音が鳴る場合(相手の打牌の直後に自分がツモる等)は、
    // 聞き分けられるよう少しずつずらして鳴らす
    let delay = 0;
    // 打牌(リーチ宣言牌なら専用の音)
    if (sameRound) {
      const discarder = ["east", "south"].find((seat) => snap.discards[seat] > prev.discards[seat]);
      if (discarder) {
        const list = s.players[discarder].discards;
        const last = list[list.length - 1];
        MahjongSound.discard(!!(last && last.isRiichiDeclaration));
        delay += 220;
      }
    }
    // リーチ棒を出した(リーチ宣言牌がロンされずに通り、供託が確定した時)
    if (sameRound) {
      for (const seat of ["east", "south"]) {
        if (snap.sticks[seat] && !prev.sticks[seat]) {
          MahjongSound.riichiStick(delay);
          delay += 200;
        }
      }
    }
    // ツモった時は音を鳴らさない(打牌・鳴き・和了などの時だけ鳴らす)
    // ポン・カン・リーチの宣言(鳴いた時は副露の音も)
    if (snap.callSeq != null && snap.callSeq !== prev.callSeq && this.lastCall) {
      if (this.lastCall.kind === "ポン" || this.lastCall.kind === "カン") MahjongSound.fuuro();
      MahjongSound.voice(this.lastCall.kind);
    }
    if (snap.win && snap.win !== prev.win) {
      MahjongSound.voice(String(this.lastWin.kind).startsWith("ツモ") ? "ツモ" : "ロン");
      // 発声(「ロン」「ツモ」)の後に、手牌を倒して公開する音
      MahjongSound.reveal(450);
    }
    // 和了画面が出た: 翻数に応じた点棒の音
    if (snap.winResult && snap.winResult !== prev.winResult) {
      MahjongSound.tenbou(tenbouSoundLevel(this.lastWin.scoreResult));
    }
    // 流局で点数のやり取りがある(流し役満なら tenbou4、ノーテン罰符なら tenbou1)
    if (snap.drawPayment && snap.drawPayment !== prev.drawPayment) {
      MahjongSound.tenbou(snap.drawPayment.endsWith(":4") ? 4 : 1);
    }
    if (snap.choiceKey && snap.choiceKey !== prev.choiceKey && !snap.win) {
      MahjongSound.choice(delay);
    }
  }


  /**
   * autoAdvance() が実際に状態を進めた直後に呼ばれるフック。ローカル対戦では
   * render() 内で完結するので何もしなくてよい。オンライン対戦では、この
   * 自動進行(自動ツモ・自動スルー)の結果も共有ドキュメントへ配信する必要があるため
   * OnlineMahjongApp がオーバーライドする。
   */
  afterAutoAdvance() {}

  // ---------------- 結果画面の確認・自動進行 ----------------

  /** 結果画面の確認ボタン。自分の確認を記録し、両家揃っていれば次の局へ進める。 */
  confirmRound(seat) {
    if (!this.state || this.state.phase !== "round_end" || this.roundConfirmations[seat]) return;
    this.roundConfirmations = Object.assign({}, this.roundConfirmations, { [seat]: true });
    this.publish();
    this.maybeAdvanceRound();
  }

  /** 相手側が自動で「新しい対局を始める」を選ぶ家か(CPU戦のCPUなど) */
  autoRematchSeat() {
    return false;
  }

  /** 対局終了画面で「新しい対局を始める」を選ぶ。両家揃えば新しい対局を始める。 */
  voteRematch(seat) {
    if (!this.state || this.state.phase !== "game_end" || this.rematchVotes[seat]) return;
    this.rematchVotes = Object.assign({}, this.rematchVotes, { [seat]: true });
    this.publish();
    this.maybeStartRematch();
  }

  /** 両家が新しい対局を選んでいて、自分が開始担当(オンラインではホスト)なら newGame() する */
  maybeStartRematch() {
    if (!this.state || this.state.phase !== "game_end") return;
    const v = this.rematchVotes || {};
    const agreed = ["east", "south"].every((s) => v[s] || this.autoRematchSeat(s));
    if (agreed && this.canAct("newGame")) this.newGame();
  }

  /** 対局終了画面の最終順位(点数の高い順、同点なら起家側を上に) */
  renderFinalStandings() {
    const wrap = document.createElement("div");
    wrap.className = "result-scores final-standings";
    const first = this.state.startingDealer || "east";
    const seats = [first, first === "east" ? "south" : "east"].sort(
      (a, b) => this.state.players[b].score - this.state.players[a].score
    );
    seats.forEach((seat, i) => {
      const row = document.createElement("div");
      row.className = "result-score-row final-row" + (i === 0 ? " final-top" : "");
      const rank = document.createElement("span");
      rank.className = "final-rank";
      const tied = i > 0 && this.state.players[seat].score === this.state.players[seats[0]].score;
      rank.textContent = `${tied ? 1 : i + 1}位`;
      const name = document.createElement("span");
      name.className = "result-score-name";
      name.textContent = this.playerName(seat);
      const total = document.createElement("span");
      total.className = "result-score-total";
      total.textContent = `${this.state.players[seat].score}点`;
      row.appendChild(rank);
      row.appendChild(name);
      row.appendChild(total);
      wrap.appendChild(row);
    });
    return wrap;
  }

  /** 両家の確認が揃っていて、自分が次局送りの担当なら nextRound() する。 */
  maybeAdvanceRound() {
    if (!this.state || this.state.phase !== "round_end") return;
    const c = this.roundConfirmations;
    if (c.east && c.south && this.canAct("nextRound")) this.nextRound();
  }

  /**
   * render() のたびに呼ぶ。結果画面(round_end)に入った時点で5秒タイマーを1回だけ張り、
   * 結果画面を抜けたら解除する。タイマーは各クライアントでローカルに張るが、
   * 実際に nextRound() するのは canAct("nextRound") の側だけ(他方は表示用)。
   */
  syncResultTimer() {
    const inResult = !!this.state && this.state.phase === "round_end";
    if (!inResult) {
      this.clearResultTimers();
      return;
    }
    if (this._resultDeadline !== null) return;
    // 和了直後の手牌公開中・流局直後の暗転演出中(結果のボックスをまだ出していない間)は
    // カウントを始めない
    if (this.isWinRevealing() || this.isExhaustiveDrawRevealing()) return;
    this._resultDeadline = Date.now() + RESULT_AUTO_ADVANCE_MS;
    this._resultTimer = setTimeout(() => {
      this._resultTimer = null;
      if (this.state && this.state.phase === "round_end" && this.canAct("nextRound")) this.nextRound();
    }, RESULT_AUTO_ADVANCE_MS);
    this._resultCountdownTimer = setInterval(() => this.updateResultCountdown(), 250);
    this.updateResultCountdown();
  }

  clearResultTimers() {
    if (this._resultTimer) clearTimeout(this._resultTimer);
    if (this._resultCountdownTimer) clearInterval(this._resultCountdownTimer);
    this._resultTimer = null;
    this._resultCountdownTimer = null;
    this._resultDeadline = null;
  }

  resultCountdownText() {
    if (this._resultDeadline === null) return `${Math.ceil(RESULT_AUTO_ADVANCE_MS / 1000)}秒後に次の局へ`;
    const sec = Math.max(0, Math.ceil((this._resultDeadline - Date.now()) / 1000));
    return sec > 0 ? `${sec}秒後に次の局へ` : "次の局へ進みます…";
  }

  updateResultCountdown() {
    const el = this.root && this.root.querySelector(".result-countdown");
    if (el) el.textContent = this.resultCountdownText();
  }

  /**
   * 卓の中央に表示する情報(局・山の残り枚数・供託・東家/南家の得点)をまとめたパネルを作る。
   * 実物の麻雀卓のように、自分側(画面下)は正立、相手側(画面上)は上下反転させて表示することで、
   * 卓を挟んで向かい合っているような見た目にする。
   */
  renderCenterInfo() {
    const center = document.createElement("div");
    center.className = "table-center";

    const opponentSeat = this.opponentSeat();
    const selfSeat = this.selfSeat();

    center.appendChild(this.renderCenterSeatInfo(opponentSeat, "table-center-seat-top"));

    const middle = document.createElement("div");
    middle.className = "table-center-middle";

    const roundInfo = document.createElement("div");
    roundInfo.className = "round-info";
    // 局の情報はオンライン対戦では相手から届いた値なので、HTML として解釈させない(textContent で組み立てる)
    [
      [`${windLabel(this.state.roundWind)}${this.state.roundNumber}局`, "round-badge"],
      [`山 残り${this.state.wall.liveWall.length}枚`, ""],
      [`供託 ${this.state.riichiSticks}本`, ""],
    ].forEach(([text, cls], i) => {
      if (i > 0) roundInfo.appendChild(document.createTextNode(" "));
      const span = document.createElement("span");
      if (cls) span.className = cls;
      span.textContent = text;
      roundInfo.appendChild(span);
    });
    middle.appendChild(roundInfo);

    center.appendChild(middle);
    center.appendChild(this.renderCenterSeatInfo(selfSeat, "table-center-seat-bottom"));

    return center;
  }

  /**
   * 中央パネルに表示する、ある一方の家(東家/南家)の名前・得点ラベル。
   * プレイヤー名はオンライン対戦では相手が入力した文字列が混じるため、innerHTML ではなく
   * textContent で組み立てて、任意のHTMLが差し込まれない(XSS対策)ようにする。
   */
  /**
   * このプレイヤーのリーチ宣言牌が、まだロンされるかどうか未確定(供託の1000点も
   * まだ引かれていない)状態かどうか。ロンされずに決着した時点(見送り・ポン・カン)で
   * 初めて供託されるため、それまではリーチ棒のグラフィックを表示しない。
   */
  isRiichiStickPending(seat) {
    const ld = this.state.lastDiscard;
    return !!(ld && ld.from === seat && ld.isRiichiDeclaration);
  }

  /** リーチ棒(供託済み)を表示する家か */
  hasRiichiStick(seat) {
    return this.state.players[seat].isRiichi && !this.isRiichiStickPending(seat);
  }

  /** 中央パネルで光らせる「手番の家」。鳴き判断中は判断する側、局の結果表示中はなし。 */
  activeTurnSeat() {
    const s = this.state;
    if (!s) return null;
    if (s.phase === "draw" || s.phase === "discard" || s.phase === "kan_replacement") return s.currentTurn;
    if (s.phase === "call_window") return s.currentTurn === "east" ? "south" : "east";
    return null;
  }

  renderCenterSeatInfo(seat, extraClass) {
    const wrap = document.createElement("div");
    wrap.className = "table-center-seat" + (extraClass ? ` ${extraClass}` : "");
    if (this.activeTurnSeat() === seat) {
      wrap.classList.add("table-center-seat-active");
      // 再描画でアニメーションが頭から始まらないよう、時計に位相を合わせる(周期2.4秒)。
      // まだDOMに挿入されていない(レイアウトされていない)要素に animation-delay を
      // 設定すると、一部のモバイルブラウザ(iOS Safari 等)でアニメーションが最初の
      // フレームのまま固まって点滅しなくなることがあるため、挿入後の次フレームで設定する。
      requestAnimationFrame(() => {
        wrap.style.animationDelay = `-${Date.now() % 2400}ms`;
      });
    }
    const seatName = `${this.seatLabel(seat)}家`;
    const playerName = this.playerName(seat);

    // 「東家」等の家名と、プレイヤー名(オンライン対戦のみ)を別の行に分けて表示する。
    // 名前列は幅が狭いため、1行にまとめて表示すると長いプレイヤー名が変な位置で
    // 折り返されてしまう。行を分けたうえで、それぞれ1行に収まりきらない場合は
    // 折り返さず「…」で省略する。
    const nameEl = document.createElement("span");
    nameEl.className = "table-center-seat-name";
    const seatNameEl = document.createElement("span");
    seatNameEl.className = "table-center-seat-name-seat";
    seatNameEl.textContent = seatName;
    nameEl.appendChild(seatNameEl);
    // ローカル対戦ではプレイヤー名が「東家」等と同じになるため、二重に出さない。
    if (playerName && playerName !== seatName) {
      const playerNameEl = document.createElement("span");
      playerNameEl.className = "table-center-seat-name-player";
      playerNameEl.textContent = playerName;
      nameEl.appendChild(playerNameEl);
    }
    wrap.appendChild(nameEl);

    // リーチ中はバッジではなく、供託に出した1000点棒そのものをここに置いて示す
    // (リーチ者のみ)。親バッジ・リーチバッジは廃止。
    const stickSlot = document.createElement("span");
    stickSlot.className = "table-center-stick-slot";
    if (!this._landscape && this.hasRiichiStick(seat)) {
      const stick = document.createElement("span");
      stick.className = "riichi-stick";
      stick.title = "リーチ棒(1000点)";
      stickSlot.appendChild(stick);
    }
    wrap.appendChild(stickSlot);

    const scoreEl = document.createElement("span");
    scoreEl.className = "table-center-seat-score";
    scoreEl.textContent = `${this.state.players[seat].score}点`;
    wrap.appendChild(scoreEl);
    return wrap;
  }

  /**
   * いま牌山のどこまでが取られているかを求める。
   *
   * - 前(先頭の列)からは、配牌26枚とその後の自摸で取られていく。
   * - カンをすると、嶺上牌を王牌の末尾から1枚取り、その補充として自摸山の末尾1枚が
   *   王牌側へ回る(engine側も liveWall の末尾を1枚削っている)。末尾から回った牌は
   *   卓上から無くなるわけではないので、見た目としては減らさない。
   *
   * したがって「前から取られた枚数」は liveWall の残り枚数とカン回数から逆算できる。
   */
  wallConsumption() {
    const wall = this.state.wall;
    const kanCount = Math.max(0, RINSHAN_TILE_POSITIONS.length - wall.deadWallDraws.length);
    const frontTaken = Math.max(0, LIVE_SECTION_TILES - wall.liveWall.length - kanCount);
    return { frontTaken, kanCount };
  }

  /**
   * 手牌と河の間に表示する、その家の前に積まれた山(牌山)。
   *
   * 実際の麻雀と同じく2枚積み×20列で、各列は上段の牌から先に取られていく
   * (下段は上段が無くなった後に残る)。山を構成する牌そのもの(どの列を
   * 東家・南家どちらが取るか)は、東家が列0〜19、南家が列20〜39という
   * 固定の割り当て(どちらの視点で見ても同じ盤面になる必要があるため、
   * 自分/相手ではなく実際の家で決める)。
   *
   * 一方、画面上での見た目の向き(列を右から取るか左から取るか)は、
   * 「自分側(画面下)は右端から取られて左へ、相手側(画面上)は左端から
   * 取られて右へ進み、卓全体としては時計回りに一周しながら減っていくように
   * 見える」という自分中心の見た目を常に保ちたいので、実際の家ではなく
   * 「画面下(自分)に表示している家かどうか」で反転させる。こうすることで、
   * ローカル対戦(常に自分=東家)だけでなく、オンライン対戦で自分が南家に
   * なった場合でも、山の向きが逆転して見えることがない。
   */
  renderWallStack(seat) {
    const { frontTaken, kanCount } = this.wallConsumption();
    const revealed = this.state.wall.revealedDoraIndicators;
    const takenRinshan = RINSHAN_TILE_POSITIONS.slice(0, kanCount);

    /** 通し番号pの牌が、まだ卓上に積まれたまま残っているか */
    const isPresent = (p) => p >= frontTaken && !takenRinshan.includes(p);

    const wrap = document.createElement("div");
    wrap.className = "wall-row" + (seat === this.opponentSeat() ? " wall-row-opponent" : "");

    // 山を構成する牌の割り当ては東家=列0〜19、南家=列20〜39で固定(両者の
    // 画面で同じ盤面になるようにするため、自分/相手ではなく実際の家で決める)。
    const first = seat === "east" ? 0 : WALL_STACKS_PER_SIDE;
    const stacks = [];
    for (let i = 0; i < WALL_STACKS_PER_SIDE; i++) stacks.push(first + i);
    // 見た目の向き(反転するかどうか)だけは、実際の家ではなく「画面下(自分)側か」で決める。
    if (seat === this.selfSeat()) stacks.reverse();

    for (const stack of stacks) {
      const upperPos = stack * WALL_TILES_PER_STACK;
      const lowerPos = upperPos + 1;
      const upperPresent = isPresent(upperPos);
      const lowerPresent = isPresent(lowerPos);

      const slot = document.createElement("div");
      slot.className = "wall-slot";
      if (!upperPresent && !lowerPresent) {
        // 取られてしまった列。詰めて寄ってこないよう、場所だけ空けておく。
        slot.classList.add("wall-slot-empty");
        wrap.appendChild(slot);
        continue;
      }

      // 上段が残っていて、その列がめくり済みのドラ表示牌なら表向きに見せる。
      // ドラ表示牌は FIRST_DORA_STACK の列から順に手前(小さい番号)の列へ進む
      // (この列は上段が取られること自体が無いカン以外では起こらないため、
      // ドラ表示牌は常に上段側にのみ現れる)。
      const doraOrder = FIRST_DORA_STACK - stack + 1;
      const doraTile =
        upperPresent && doraOrder >= 1 && doraOrder <= revealed.length ? revealed[doraOrder - 1] : null;

      // 上段(先に取られる側)を先に描画し、下段はその後ろに少し覗く形で重ねる。
      // 上段だけが取られた場合は下段のみが残り、そのぶん低い位置に見える。
      if (upperPresent) {
        const topEl = document.createElement("div");
        if (doraTile) {
          topEl.className = "wall-tile wall-tile-top wall-tile-dora tile-img " + tileImageClass(doraTile.kind);
          topEl.title = `${tileTitle(doraTile.kind)}(ドラ: ${tileTitle(E.doraFromIndicator(doraTile.kind))})`;
        } else {
          topEl.className = "wall-tile wall-tile-top wall-tile-back";
        }
        slot.appendChild(topEl);
      }
      if (lowerPresent) {
        const bottomEl = document.createElement("div");
        bottomEl.className = "wall-tile wall-tile-bottom wall-tile-back";
        slot.appendChild(bottomEl);
      }
      wrap.appendChild(slot);
    }

    return wrap;
  }

  renderHand(seat, { interactive }) {
    const wrap = document.createElement("div");
    // 対戦相手側の手牌は、対面で打っているような立体感・奥行きを出すため少し小さく表示する。
    wrap.className = "hand-row" + (seat === this.opponentSeat() ? " hand-row-opponent" : "");

    // 和了(ツモ/ロン)した本人の手牌側にだけ、大きな文字を短時間表示する。
    const banner = this.renderWinBanner(seat);
    if (banner) wrap.appendChild(banner);

    // ポン・カン・リーチをした本人の手牌側にも、同様に大きな文字を短時間表示する。
    const callBanner = this.renderCallBanner(seat);
    if (callBanner) wrap.appendChild(callBanner);

    const player = this.state.players[seat];
    // 和了(ツモ・ロン)で局が終わったときは、次の局に進むまで和了者本人の手牌だけを公開する。
    const revealForWin = this.state.phase === "round_end" && !!this.lastWin && this.lastWin.seat === seat;
    // 流局(荒牌平局)のときは、聴牌していた側だけが実際の麻雀と同じく手牌を公開する。
    const revealForTenpai = this.exhaustiveDrawTenpaiSeats().includes(seat);
    const shouldHide =
      !revealForWin && !revealForTenpai && !this.showOpponentHand && this.hiddenSeatFor() === seat;
    // 対戦相手の手牌が公開されている場合は、オンライン対戦と同様に常に上下反転させて
    // 表示する(相手の実際の手番であっても、対面で見ているような向きに統一する)。
    const shouldFlip = seat === this.opponentSeat() && !shouldHide;
    // 相手の手牌が伏せられている(非公開の)通常時は、左右だけを反転させて表示する
    // (伏せ牌なので絵柄自体に違いは出ないが、相手側の河・山と向きを揃えるため)。
    const shouldHideFlip = seat === this.opponentSeat() && shouldHide;

    const tilesWrap = document.createElement("div");
    tilesWrap.className =
      "tiles" + (shouldFlip ? " tiles-flipped" : "") + (shouldHideFlip ? " tiles-hidden-flipped" : "");

    // 手牌・ツモ牌・鳴いた面子(副露)は、折り返さない1行に並べる:
    //   [手牌][区切り][ツモ牌の枠][余白][面子(行の右端)]
    // ツモ牌の枠はツモ牌が無いときも空の枠として常に確保するため、ツモ牌の有無で
    // 面子の位置がズレることはない。面子は margin-left: auto で常に行の右端
    // (=自分の手牌なら画面右端、対戦相手の手牌なら上下反転・鏡写しの結果として画面左端)に置く。
    // 1行に収まりきらない場合だけ、行ごとに牌の大きさを縮める(--hand-units / --hand-fixed-px を
    // CSS に渡し、styles.css の --hand-tile-w で計算する。詳細は handRowUnits() 参照)。
    const handAndDrawWrap = document.createElement("div");
    handAndDrawWrap.className = "hand-and-draw";

    // 手牌とツモ牌は別のコンテナに分ける。
    // ツモ牌は理牌の対象にせず、常に一番右へ独立して置く。
    const handTilesWrap = document.createElement("div");
    handTilesWrap.className = "hand-tiles";

    // 手出し(ツモ切りでない打牌)を相手視点にヒントする演出(doDiscard/online-shared.js
    // 参照)が、いまこの家のこのインデックスの伏せ牌を一瞬だけ透明にしたいかどうか。
    const gapIndex =
      this._tedashiGap && this._tedashiGap.seat === seat && shouldHide ? this._tedashiGap.index : -1;

    // リーチ済みの場合、手牌からの選択打牌はできない(ツモ切りのみ許可)。
    // まだリーチしていない手番でリーチを宣言しようとしている場合(pendingRiichi)は、
    // 聴牌を維持できる牌だけ選択可能にする。
    this.orderedHand(seat).forEach((tile, idx) => {
      const canDiscard =
        interactive && (this.state.phase === "discard" || this.state.phase === "kan_replacement") && !player.isRiichi;
      const isValidRiichiTile =
        !this.pendingRiichi || this.riichiOptionIds().has(tile.id);
      const isKuikaeForbidden = this.isForbiddenKuikaeTile(player, tile);
      const onClick =
        canDiscard && isValidRiichiTile && !isKuikaeForbidden
          ? () => {
              if (this.suppressNextClick) {
                this.suppressNextClick = false;
                return;
              }
              this.doDiscard(tile);
            }
          : null;
      const el = makeTileEl(tile, {
        faceDown: shouldHide,
        onClick,
        highlight: !!onClick,
        armed: !!onClick && this.armedTileId === tile.id,
        onArm: onClick ? () => this.armTile(tile.id) : null,
        // リーチ宣言中は、宣言牌にできない牌を暗くして、選べる牌を目立たせる
        dimmed: this.pendingRiichi && canDiscard && !onClick,
      });
      if (this.canReorderHand(seat)) el.classList.add("tile-draggable");
      if (idx === gapIndex) el.classList.add("tile-tedashi-gap");
      // 配牌の演出中、まだ配っていない牌は見えなくする(手牌の行が縮まないよう場所は残す)
      if (this._dealAnim && !this._dealAnim.sorted && idx >= this.dealtCountFor(seat)) {
        el.classList.add("tile-undealt");
      }
      handTilesWrap.appendChild(el);
    });
    handAndDrawWrap.appendChild(handTilesWrap);

    if (this.canReorderHand(seat)) {
      this.enableHandDrag(handTilesWrap, seat);
    }

    if (player.drawnTile && !this._dealAnim) {
      const t = player.drawnTile;
      const canDiscard = interactive && (this.state.phase === "discard" || this.state.phase === "kan_replacement");
      // リーチ済みならツモった牌は無条件で打牌可能(ツモ切り)。
      // リーチ宣言中(pendingRiichi)は聴牌を維持できる場合のみ。
      const isValidRiichiTile = player.isRiichi || !this.pendingRiichi || this.riichiOptionIds().has(t.id);
      const isKuikaeForbidden = this.isForbiddenKuikaeTile(player, t);
      const onClick = canDiscard && isValidRiichiTile && !isKuikaeForbidden ? () => this.doDiscard(t) : null;
      const sep = document.createElement("span");
      sep.className = "draw-separator";
      handAndDrawWrap.appendChild(sep);
      const drawnEl = makeTileEl(t, {
        faceDown: shouldHide,
        onClick,
        highlight: !!onClick,
        armed: !!onClick && this.armedTileId === t.id,
        onArm: onClick ? () => this.armTile(t.id) : null,
        dimmed: this.pendingRiichi && canDiscard && !onClick,
      });
      handAndDrawWrap.appendChild(drawnEl);
    } else if (!player.forbiddenDiscardKind) {
      // ツモ牌が無いときも、通常はツモ牌1枚ぶんの枠(と区切り)を空けておく。
      // ただしポン直後(まだ打牌していない間)は、この打牌の後もう一度ツモが
      // 挟まることはない(次にツモるのは相手の手番を挟んだ後)ので、この枠は
      // 確保しない。ポンした面子を含めた行の幅がぎりぎりで、この1枠ぶんを
      // 空けたままだと鳴いた牌だけが一瞬小さく縮んで見えてしまうため。
      const sep = document.createElement("span");
      sep.className = "draw-separator";
      handAndDrawWrap.appendChild(sep);
      const slot = document.createElement("span");
      slot.className = "draw-slot-empty";
      handAndDrawWrap.appendChild(slot);
    }
    tilesWrap.appendChild(handAndDrawWrap);
    // ポン直後(打牌前)は上と同じ理由でツモ牌の枠ぶんを幅の計算にも含めない。
    const reserveDrawSlot = !!player.drawnTile || !player.forbiddenDiscardKind;
    const units = handRowUnits(this.orderedHand(seat).length, player.melds, reserveDrawSlot);
    tilesWrap.style.setProperty("--hand-units", String(units.handUnits));
    tilesWrap.style.setProperty("--hand-fixed-px", units.handFixedPx + "px");
    tilesWrap.style.setProperty("--meld-units", String(units.meldUnits || 1));
    tilesWrap.style.setProperty("--meld-fixed-px", units.meldFixedPx + "px");

    // 鳴いた面子は、同じ行の右端(相手側は上下反転の結果、画面左端)に表示する。
    if (player.melds.length > 0) {
      const meldsWrap = document.createElement("div");
      meldsWrap.className = "melds";
      for (const m of player.melds) {
        meldsWrap.appendChild(renderMeldGroup(m));
      }
      tilesWrap.appendChild(meldsWrap);
    }

    wrap.appendChild(tilesWrap);

    // リーチ中であることは、中央パネルに置かれるリーチ棒(供託に出した1000点棒)で示す。
    // 手牌の下のバッジは廃止した。

    return wrap;
  }

  hiddenSeatFor() {
    // 手番中のプレイヤーの手牌は見せ、相手は伏せる(同一画面でのホットシート対戦を想定した簡易表示)
    return E.otherSeat(this.activeSeat());
  }

  activeSeat() {
    if (this.state.phase === "call_window") return E.otherSeat(this.state.lastDiscard.from);
    return this.state.currentTurn;
  }

  riichiOptionIds() {
    if (!this._riichiOptionsCache) return new Set();
    return new Set(this._riichiOptionsCache.map((t) => t.id));
  }

  /**
   * いま河の中で「ポン・カン・ロンの選択肢が出ている対象」として縁を光らせる牌のID。
   *
   * 選択肢を出している側の画面にだけ表示する(捨てた側の画面に出すと、相手が
   * 鳴ける牌かどうかが分かってしまうため)。該当が無ければ null。
   */
  callTargetTileId() {
    if (this.state.phase !== "call_window" || !this.state.lastDiscard) return null;
    const seat = E.otherSeat(this.state.lastDiscard.from);
    if (!this.canAct("callWindow", seat)) return null;
    const { canRon, canPon, canMinkan } = this.computeCallOptions(seat, this.state.lastDiscard.tile);
    if (!canRon && !canPon && !canMinkan) return null;
    return this.state.lastDiscard.tile.id;
  }

  /** 喰い替え禁止: ポンした直後、そのポンに使った牌と同じ種類は打牌できない。 */
  isForbiddenKuikaeTile(player, tile) {
    if (!player.forbiddenDiscardKind) return false;
    return E.tileKindKey(tile.kind) === E.tileKindKey(player.forbiddenDiscardKind);
  }

  /**
   * 捨て牌(河)を描画する。1段目・2段目は6枚で折り返し、3段目は折り返さず伸ばす。
   *
   * 各段は「枚数に関わらず一定の幅の箱」として置く(1・2段目は6枚ぶん、3段目は8枚ぶん)。
   * 段の幅を中身の枚数に合わせて変えてしまうと、相手側の河は180度回転して表示される
   * 関係で、捨てるたびに既に置いた牌の位置まで左右に動いてしまうため。
   * 幅を固定したうえで、相手側だけ段の箱を右端に寄せる(=回転後は左端に来る)ことで、
   * 東家の1枚目と南家の6枚目が画面上の同じ位置に並ぶ。
   */
  renderDiscards(seat) {
    const wrap = document.createElement("div");
    // 対戦相手側の河は、対面で打っているような没入感を出すため上下反転(180度回転)させて表示する。
    wrap.className = "discard-row" + (seat === this.opponentSeat() ? " discard-row-opponent" : "");

    const linesWrap = document.createElement("div");
    linesWrap.className = "discard-lines";

    // 鳴かれた牌は捨て牌データ(isCalled)自体は保持したまま、河の見た目からだけ取り除く
    // (フリテン・流し役満などの判定は元の discards 配列全体を見て行うため、ここでは表示のみ変える)。
    // 横向きに置く牌を決める: リーチ宣言牌は横向き。横向きの牌が鳴かれて河から消えた場合は、
    // いつリーチしたか分かるよう、その家の次の打牌を代わりに横向きにする(それも鳴かれたら
    // さらに次の打牌…と続く)。横向きの牌が河に残った時点で、以降は通常どおり縦向き。
    const sidewaysIds = new Set();
    let carrySideways = false;
    for (const d of this.state.players[seat].discards) {
      const sideways = d.isRiichiDeclaration || carrySideways;
      if (sideways) sidewaysIds.add(d.tile.id);
      carrySideways = sideways && d.isCalled;
    }
    const discards = this.state.players[seat].discards.filter((d) => !d.isCalled);
    // ポン・カン・ロンの選択肢が出ている間だけ、その対象の捨て牌の縁を光らせる。
    const callTargetId = this.callTargetTileId();

    // 1段目・2段目は6枚で折り返し、3段目に到達したらそれ以降は折り返さず並べ続ける。
    // 段(行)は捨て牌が0枚の対局開始時から常に3段分を確保しておく(空でも div 自体は作る)。
    // これにより、6枚捨てて次の段に進むたびに河の高さが変わって手牌表示が下へズレる、
    // ということが起きないようにしている。
    const rowChunks = [
      discards.slice(0, DISCARDS_PER_ROW),
      discards.slice(DISCARDS_PER_ROW, DISCARDS_PER_ROW * 2),
      discards.slice(DISCARDS_PER_ROW * 2),
    ];

    for (const chunk of rowChunks) {
      const lineEl = document.createElement("div");
      lineEl.className = "discard-line tiles-small";
      // 段の位置(3枚目と4枚目の境目を卓の中心に合わせる)はCSS側で決めている。
      // 先頭3枚にリーチ宣言牌が含まれる段では境目がその牌の幅の差だけずれるが、
      // 段をずらして補正すると1枚目・7枚目・13枚目の縦の並びが崩れるため、そのままにする。
      for (const d of chunk) {
        let el;
        if (sidewaysIds.has(d.tile.id)) {
          // リーチ宣言牌は実際の麻雀と同様に横向きにして河に置く(横向きであること自体が
          // リーチ宣言牌の目印なので、縁のハイライトなどは付けない)。
          // 横向きの見た目分の幅(牌の縦横入れ替え)を持つ箱に入れることで、
          // レイアウト上もその分の幅がきちんと確保され、以降に捨てた牌と重ならないようにする。
          el = makeRotatedTileBox(d.tile);
        } else {
          el = makeTileEl(d.tile);
        }
        if (callTargetId && d.tile.id === callTargetId) {
          // 横向きのリーチ宣言牌の場合は、外側の箱ではなく中の牌そのものを光らせる
          const tileEl = el.classList.contains("tile") ? el : el.querySelector(".tile");
          if (tileEl) tileEl.classList.add("tile-call-target");
        }
        lineEl.appendChild(el);
      }
      linesWrap.appendChild(lineEl);
    }

    wrap.appendChild(linesWrap);
    return wrap;
  }

  /**
   * 流局(牌山が尽きた荒牌平局)で局が終わっている場合の、聴牌していたSeatの一覧。
   * それ以外(和了・途中流局・対局中)では空配列を返す。
   */
  exhaustiveDrawTenpaiSeats() {
    const reason = this.state.roundEndReason;
    if (this.state.phase !== "round_end") return [];
    if (!reason || reason.type !== "exhaustive_draw") return [];
    if (!this.lastExhaustiveOutcome) return [];
    return this.lastExhaustiveOutcome.tenpaiSeats || [];
  }

  /**
   * 自摸直後に取りうる行動(ツモ和了・リーチ宣言牌・暗槓・加槓)を求める。
   * 行動ボタンの描画と、リーチ後の自動ツモ切り判定の両方から使う。
   */
  drawActionOptionsFor(seat) {
    const player = this.state.players[seat];
    const context = E.buildWinContext(this.state, seat, player.drawnTile, true);
    return E.getDrawActionOptions(
      this.currentHandWithDraw(seat),
      player.melds,
      player.score,
      this.state.wall.liveWall.length,
      player.isRiichi,
      player.hand,
      context,
      !!player.forbiddenDiscardKind,
      this.state.kanCount
    );
  }

  /**
   * 「自動和了」がオンで、この画面で操作しているSeatが和了できる局面なら、少し待ってから
   * 自動でツモ・ロンする。render() の最後に毎回呼ぶ。局面が変わっていれば
   * 予約を取り消し、同じ局面には二重に予約しない。
   * 戻り値の action は、実行時点で同じ局面のままか(key が一致するか)を確かめてから呼ぶ。
   */
  autoWinAction() {
    if (!this.autoWin) return null;
    const phase = this.state.phase;
    if (phase === "discard" || phase === "kan_replacement") {
      const seat = this.state.currentTurn;
      const player = this.state.players[seat];
      if (!player.drawnTile || !this.canAct("discard", seat)) return null;
      if (!this.drawActionOptionsFor(seat).canTsumo) return null;
      return { key: `tsumo:${seat}:${player.drawnTile.id}`, run: () => this.doTsumo() };
    }
    if (phase === "call_window" && this.state.lastDiscard) {
      const discard = this.state.lastDiscard;
      const seat = E.otherSeat(discard.from);
      if (!this.canAct("callWindow", seat)) return null;
      if (!this.computeCallOptions(seat, discard.tile).canRon) return null;
      return { key: `ron:${seat}:${discard.tile.id}`, run: () => this.doRon() };
    }
    return null;
  }

  scheduleAutoWin() {
    const cancel = () => {
      if (this._autoWinTimer) clearTimeout(this._autoWinTimer);
      this._autoWinTimer = null;
      this._autoWinKey = null;
    };
    const action = this.autoWinAction();
    if (!action) return cancel();
    if (this._autoWinTimer && this._autoWinKey === action.key) return; // 予約済み
    cancel();
    this._autoWinKey = action.key;
    this._autoWinTimer = setTimeout(() => {
      this._autoWinTimer = null;
      this._autoWinKey = null;
      if (this._destroyed) return;
      // 待っている間に局面が変わっていないか(オフにされていないかも含めて)確認してから和了する
      const current = this.autoWinAction();
      if (current && current.key === action.key) current.run();
    }, AUTO_WIN_DELAY_MS);
  }

  /**
   * リーチ後で「ツモ切り」以外に選べる行動が無い場合、または「ツモ切り」トグルがオンの場合、
   * 少し待ってからツモった牌をそのまま自動で打牌する。
   * ツモ和了できる場合や暗槓できる場合は選択の余地があるため自動では切らない。
   *
   * render() の最後に毎回呼ぶ。状況が変わっていれば予約を取り消し、同じツモ牌に対して
   * 二重に予約しないようにする(和了表示のタイマーなどで再描画されても、そのたびに
   * 待ち時間が延びてしまわないようにするため)。
   */
  scheduleAutoTsumogiri() {
    const cancel = () => {
      if (this._autoTsumogiriTimer) {
        clearTimeout(this._autoTsumogiriTimer);
        this._autoTsumogiriTimer = null;
      }
      this._autoTsumogiriTileId = null;
    };

    const seat = this.state.currentTurn;
    const player = this.state.players[seat];
    const canDiscardNow = this.state.phase === "discard" || this.state.phase === "kan_replacement";
    if (!canDiscardNow || !player || !player.drawnTile || !(player.isRiichi || this.autoTsumogiri)) return cancel();
    // オンライン対戦では、自分が操作している側の画面だけが実際に打牌する。
    if (!this.canAct("discard", seat)) return cancel();

    const options = this.drawActionOptionsFor(seat);
    if (options.canTsumo || options.ankanKinds.length > 0) return cancel();

    const tile = player.drawnTile;
    if (this._autoTsumogiriTimer && this._autoTsumogiriTileId === tile.id) return; // 予約済み
    cancel();
    this._autoTsumogiriTileId = tile.id;
    this._autoTsumogiriTimer = setTimeout(() => {
      this._autoTsumogiriTimer = null;
      this._autoTsumogiriTileId = null;
      // 待っている間に局面が変わっていないか確認してから切る
      const current = this.state.players[this.state.currentTurn];
      const stillSame =
        (this.state.phase === "discard" || this.state.phase === "kan_replacement") &&
        this.state.currentTurn === seat &&
        current.drawnTile &&
        current.drawnTile.id === tile.id;
      if (stillSame) this.doDiscard(current.drawnTile);
    }, AUTO_TSUMOGIRI_DELAY_MS);
  }

  /**
   * 局の途中は点数を記録し続け、結果画面(round_end / game_end)になった最初の時点で
   * 直前の点数との差を「この局の点数のやり取り」として確定する。
   */
  /** 局を終わらせる処理(和了・流局)の直前に、その時点の点数を「結果の直前の点数」として記録する */
  // ---------------- 持ち時間 ----------------

  /**
   * 配牌ごとに変わるキー。連荘では overallRoundIndex が変わらないため、フロント側で
   * 振っている通し番号 roundSerial を優先する(古いデータで無い場合だけ overallRoundIndex)。
   */
  roundKey() {
    if (!this.state) return null;
    return this.state.roundSerial != null ? `s${this.state.roundSerial}` : `i${this.state.overallRoundIndex}`;
  }

  /**
   * いま「この画面で操作する家」が判断を求められていて、持ち時間を計るべき局面なら
   * { key, seat, kind } を返す。kind は "discard"(打牌・ツモ和了・リーチ・カンの判断)、
   * "call"(ロン・ポン・カン・スルーの判断)。
   * key は判断ごとに変わり、変わった時点で「打牌ごと」の時間が満タンに戻る
   * (打牌・ポン・カンなど選択肢を選ぶと局面が変わるため、それぞれでリセットされる)。
   */
  currentDecision() {
    if (!this.timeControl || !this.state) return null;
    const s = this.state;
    if (s.phase === "discard" || s.phase === "kan_replacement") {
      const seat = s.currentTurn;
      if (!this.canAct("discard", seat) || this._tedashiTimer) return null;
      const p = s.players[seat];
      const key = [
        "d", this.roundKey(), seat, s.phase, p.hand.length, p.melds.length, p.discards.length,
        p.drawnTile ? p.drawnTile.id : "-",
      ].join(":");
      return { key, seat, kind: "discard" };
    }
    if (s.phase === "call_window" && s.lastDiscard) {
      const seat = E.otherSeat(s.lastDiscard.from);
      if (!this.canAct("callWindow", seat)) return null;
      const { canRon, canPon, canMinkan } = this.computeCallOptions(seat, s.lastDiscard.tile);
      if (!canRon && !canPon && !canMinkan) return null;
      const key = ["c", this.roundKey(), seat, s.lastDiscard.tile.id, s.players[s.lastDiscard.from].discards.length].join(":");
      return { key, seat, kind: "call" };
    }
    return null;
  }

  /** 計測中の判断の残り時間 { perMs, bankMs }(打牌ごと・局ごと)。計測中でなければ null */
  turnTimeRemaining() {
    const d = this._decision;
    if (!d || !this.timeControl) return null;
    const elapsed = Date.now() - d.startedAt;
    const perTotal = this.timeControl.perAction * 1000;
    const perMs = Math.max(0, perTotal - elapsed);
    const bankMs = Math.max(0, d.bankAtStart - Math.max(0, elapsed - perTotal));
    return { perMs, bankMs };
  }

  /**
   * render() のたびに呼ぶ。局が変わっていれば両家の「局ごと」の時間を満タンに戻し、
   * 判断の局面が変わっていれば、前の判断で使った「局ごと」の時間を確定させてから
   * 新しい判断の計測を始める(「打牌ごと」の時間は判断ごとに満タンから)。
   */
  syncTurnTimer() {
    if (!this.state) return;
    const rk = this.roundKey();
    if (rk !== this._timerRoundKey) {
      this._timerRoundKey = rk;
      const bank = this.timeControl ? this.timeControl.bank * 1000 : 0;
      this._bankMs = { east: bank, south: bank };
      this._decision = null;
    }
    const next = this.currentDecision();
    const cur = this._decision;
    if (cur && (!next || next.key !== cur.key)) {
      const rem = this.turnTimeRemaining();
      if (rem) this._bankMs[cur.seat] = rem.bankMs;
      this._decision = null;
    }
    if (next && !this._decision) {
      this._decision = Object.assign({}, next, {
        startedAt: Date.now(),
        bankAtStart: this._bankMs[next.seat] || 0,
        fired: false,
      });
    }
    if (this._decision) this.startTurnTimer();
    else this.stopTurnTimer();
  }

  startTurnTimer() {
    if (this._turnTimerInterval) return;
    this._turnTimerInterval = setInterval(() => this.tickTurnTimer(), TURN_TIMER_TICK_MS);
  }

  stopTurnTimer() {
    if (this._turnTimerInterval) clearInterval(this._turnTimerInterval);
    this._turnTimerInterval = null;
  }

  tickTurnTimer() {
    // 卓が破棄された(ロビーへ戻った等)後は止める
    if (this._destroyed || !this.root.isConnected) return this.stopTurnTimer();
    const d = this._decision;
    const rem = this.turnTimeRemaining();
    if (!d || !rem) return this.stopTurnTimer();
    this.updateTurnTimerDisplay(rem);
    if (rem.perMs > 0 || rem.bankMs > 0 || d.fired) return;
    d.fired = true;
    this._bankMs[d.seat] = 0;
    this.onTurnTimeout(d);
  }

  /**
   * 持ち時間を使い切ったときの自動操作。和了できる場合は和了を優先する。
   *   打牌の判断: ツモ和了できればツモ。できなければ、ツモ牌があればツモ切り、
   *     無ければ(ポンの後など)手牌の一番右の牌を切る。
   *   ロン・ポン・カンの判断: ロンできればロン。できなければスルー。
   */
  onTurnTimeout(d) {
    const s = this.state;
    if (d.kind === "call") {
      if (s.phase !== "call_window" || !s.lastDiscard) return;
      this.addLog(`${this.seatLabel(d.seat)}家の持ち時間が切れました`);
      const { canRon } = this.computeCallOptions(d.seat, s.lastDiscard.tile);
      if (canRon) this.doRon();
      else this.doPass();
      return;
    }
    if (s.phase !== "discard" && s.phase !== "kan_replacement") return;
    const player = s.players[d.seat];
    this.pendingRiichi = false; // リーチ宣言牌を選んでいる途中でも、宣言はしない
    if (player.drawnTile && this.drawActionOptionsFor(d.seat).canTsumo) {
      this.addLog(`${this.seatLabel(d.seat)}家の持ち時間が切れました`);
      this.doTsumo();
      return;
    }
    let tile = player.drawnTile;
    if (!tile) {
      // 喰い替えで切れない牌は飛ばして、右から順に切れる牌を探す
      const ordered = this.orderedHand(d.seat);
      for (let i = ordered.length - 1; i >= 0; i--) {
        if (!this.isForbiddenKuikaeTile(player, ordered[i])) {
          tile = ordered[i];
          break;
        }
      }
    }
    if (!tile) return;
    this.addLog(`${this.seatLabel(d.seat)}家の持ち時間が切れました`);
    this.doDiscard(tile);
  }

  /** 残り時間を「打牌ごと+局ごと」の形(秒、切り上げ)で表す */
  turnTimerText(rem) {
    return `${Math.ceil(rem.perMs / 1000)}+${Math.ceil(rem.bankMs / 1000)}`;
  }

  /** 持ち時間の表示要素(計測中でなければ null)。卓の下側の空きスペースに置く */
  renderTurnTimer() {
    const rem = this.turnTimeRemaining();
    if (!rem) return null;
    const wrap = document.createElement("div");
    wrap.className = "turn-timer";
    const label = document.createElement("div");
    label.className = "turn-timer-label";
    label.textContent = "持ち時間";
    const value = document.createElement("div");
    value.className = "turn-timer-value";
    wrap.appendChild(label);
    wrap.appendChild(value);
    this.applyTurnTimerDisplay(wrap, rem);
    return wrap;
  }

  applyTurnTimerDisplay(wrap, rem) {
    const value = wrap.querySelector(".turn-timer-value");
    if (value) value.textContent = this.turnTimerText(rem);
    // 「打牌ごと」を使い切って「局ごと」を減らしている間は色を変えて知らせる
    wrap.classList.toggle("turn-timer-bank", rem.perMs <= 0);
  }

  updateTurnTimerDisplay(rem) {
    const wrap = this.root.querySelector(".turn-timer");
    if (wrap) this.applyTurnTimerDisplay(wrap, rem);
  }

  snapshotPreResultScores() {
    if (!this.state || !this.state.players) return;
    this._preResultScores = { east: this.state.players.east.score, south: this.state.players.south.score };
    this.roundScoreChange = null;
  }

  trackRoundScoreChange() {
    if (!this.state || !this.state.players) return;
    const scores = { east: this.state.players.east.score, south: this.state.players.south.score };
    const phase = this.state.phase;
    if (phase !== "round_end" && phase !== "game_end") {
      this._preResultScores = scores;
      this.roundScoreChange = null;
      return;
    }
    if (!this.roundScoreChange && this._preResultScores) {
      this.roundScoreChange = {
        east: scores.east - this._preResultScores.east,
        south: scores.south - this._preResultScores.south,
      };
    }
  }

  /** 結果画面の「Player1 37000点 -8000点 / Player2 53000点 +8000点」の表示 */
  renderResultScoreChanges() {
    if (!this.roundScoreChange) return null;
    const wrap = document.createElement("div");
    wrap.className = "result-scores";
    for (const seat of ["east", "south"]) {
      const delta = this.roundScoreChange[seat] || 0;
      const row = document.createElement("div");
      row.className = "result-score-row";
      const name = document.createElement("span");
      name.className = "result-score-name";
      name.textContent = this.playerName(seat);
      const total = document.createElement("span");
      total.className = "result-score-total";
      total.textContent = `${this.state.players[seat].score}点`;
      const diff = document.createElement("span");
      diff.className = "result-score-delta " + (delta > 0 ? "plus" : delta < 0 ? "minus" : "zero");
      diff.textContent = delta > 0 ? `+${delta}点` : delta < 0 ? `${delta}点` : "±0点";
      row.appendChild(name);
      row.appendChild(total);
      row.appendChild(diff);
      wrap.appendChild(row);
    }
    return wrap;
  }

  /** 退室の確認ダイアログ(表示中なら #app の最前面に置く)。サブクラスが重ねる表示の後にも呼び直せる。 */
  appendExitConfirm() {
    if (!this.confirmingExit) return;
    if (!this._exitConfirmEl) this._exitConfirmEl = this.renderExitConfirm();
    this.root.appendChild(this._exitConfirmEl);
  }

  /** 確認文に添える補足(オンライン対戦では相手への影響を書く) */
  exitConfirmNote() {
    return "";
  }

  renderExitConfirm() {
    const overlay = document.createElement("div");
    overlay.className = "connection-overlay exit-confirm";
    const box = document.createElement("div");
    box.className = "connection-overlay-box";
    const p = document.createElement("p");
    p.textContent = "対局から退室しますか？";
    box.appendChild(p);
    const note = this.exitConfirmNote();
    if (note) {
      const n = document.createElement("p");
      n.className = "exit-confirm-note";
      n.textContent = note;
      box.appendChild(n);
    }
    const row = document.createElement("div");
    row.className = "result-confirm-row";
    row.appendChild(this.button("はい", () => this.exitGame(), "primary"));
    row.appendChild(
      this.button("いいえ", () => {
        this.confirmingExit = false;
        this._exitConfirmEl = null;
        this.render();
      })
    );
    box.appendChild(row);
    overlay.appendChild(box);
    return overlay;
  }

  /** 退室を確定する(ロビーへ戻る)。オンライン対戦ではサブクラスで相手への通知を足す。 */
  exitGame() {
    this.confirmingExit = false;
    if (typeof this.destroy === "function") this.destroy();
    this._destroyed = true;
    if (this.onExit) this.onExit();
  }

  /**
   * 河の右側のスペースに置く操作ボタン(ツモ・リーチ・カン・ポン・ロンなど)。
   *
   * 以前は画面下のボックスにまとめていたが、卓の外に操作欄があると視線が大きく動くため、
   * 自分の河のすぐ右へ移した。局の結果(和了・流局・対局終了)は卓の中央に重ねて出すので
   * ここでは扱わない。操作できることが牌そのものの見た目で分かる場面
   * (打牌・リーチ宣言牌の選択)には、説明の文章を置かない。
   */
  renderSideActions() {
    const wrap = document.createElement("div");
    wrap.className = "side-actions";

    // 局の結果表示中(和了・流局・対局終了)は、卓中央のボックス側にボタンを出す。
    if (this.state.phase === "round_end" || this.state.phase === "game_end") return wrap;

    // "draw" フェーズは autoAdvance() が render() の先頭で必ず解消するため、
    // ここに描画が来ることはない(ツモ動作は常に自動)。

    if (this.state.phase === "discard" || this.state.phase === "kan_replacement") {
      const seat = this.state.currentTurn;
      if (!this.canAct("discard", seat)) {
        return wrap;
      }
      const player = this.state.players[seat];
      const options = this.drawActionOptionsFor(seat);
      this._riichiOptionsCache = options.riichiDiscardOptions;

      if (options.canTsumo) {
        wrap.appendChild(this.button("ツモ", () => this.doTsumo(), "primary"));
      }
      if (!player.isRiichi && options.riichiDiscardOptions.length > 0) {
        wrap.appendChild(
          (() => {
            // 押す前は金色の塗り、押した後(宣言牌を選んでいる間)は金色の縁取り
            // 押している間(宣言牌を選んでいる間)は、押すと取り消せることが分かるよう「キャンセル」と表示する
            const b = this.button(this.pendingRiichi ? "キャンセル" : "リーチ", () => {
              this.pendingRiichi = !this.pendingRiichi;
              this.render();
            }, this.pendingRiichi ? undefined : "primary");
            b.classList.add("btn-riichi");
            b.classList.toggle("btn-toggle-active", !!this.pendingRiichi);
            return b;
          })()
        );
      }
      // リーチ宣言牌を選んでいる間(リーチボタンを押した状態)は暗槓を押せないようにする。
      // ボタンを取り除くと縦に並んだ他のボタン(リーチなど)の位置がずれるため、
      // 場所は残したまま見えなくする(リーチをキャンセルすれば再び表示される)。
      for (const kind of options.ankanKinds) {
        const b = this.button(`暗槓 ${tileTitle(kind)}`, () => this.doAnkan(kind));
        b.classList.add("btn-wide"); // 文字が長いので、横向きの2列表示では1行を占有する
        if (this.pendingRiichi) {
          b.disabled = true;
          b.classList.add("btn-placeholder");
          b.setAttribute("aria-hidden", "true");
          b.tabIndex = -1;
        }
        wrap.appendChild(b);
      }
      for (const kind of options.kakanKinds) {
        const b = this.button(`加槓 ${tileTitle(kind)}`, () => this.doKakan(kind));
        b.classList.add("btn-wide");
        wrap.appendChild(b);
      }
      // リーチ中: ツモ切りしか選べない場合はボタンを出さない(scheduleAutoTsumogiri が自動で切る)。
      // ツモ和了・暗槓を選べる場合だけ、それらを選ばずにツモ切りする選択肢を「スルー」として出す。
      if (player.isRiichi && player.drawnTile && (options.canTsumo || options.ankanKinds.length > 0)) {
        wrap.appendChild(this.button("スルー", () => this.doDiscard(player.drawnTile)));
      }
      return wrap;
    }

    if (this.state.phase === "call_window") {
      // ここに到達するのは、ロン・ポン・カンのいずれかが実際に発生し得る場合のみ
      // (それ以外は autoAdvance() が自動でスルーして次のツモまで進めている)。
      // 対象の捨て牌は河の中で縁が光っているため、どの牌に対する選択肢かの説明は置かない。
      const discard = this.state.lastDiscard;
      const seat = E.otherSeat(discard.from);
      // 選択肢は自分が操作できる家の分だけ調べる(オンライン対戦では相手の手牌は伏せ牌で届くため)
      if (this.canAct("callWindow", seat)) {
        const { canRon, canPon, canMinkan } = this.computeCallOptions(seat, discard.tile);
        if (canRon) wrap.appendChild(this.button("ロン", () => this.doRon(), "primary"));
        if (canPon) wrap.appendChild(this.button("ポン", () => this.doPon(seat)));
        if (canMinkan) wrap.appendChild(this.button("カン", () => this.doMinkan(seat)));
        wrap.appendChild(this.button("スルー", () => this.doPass()));
      }
      return wrap;
    }

    return wrap;
  }

  /**
   * 局の結果(和了・流局)と対局終了を、卓の中央に重ねて表示するボックス。
   * 背景は中央パネルと同じ色を少しだけ透かしたもので、下の河や中央パネルが透けて見える。
   * 該当する局面でなければ null を返す。
   */
  /**
   * ツモ・ロン和了の直後で、公開した手牌と「ツモ」「ロン」の大きい文字だけを見せている間か
   * (WIN_BANNER_DURATION_MS = 1.5秒)。この間は和了画面(結果のボックス)をまだ出さず、
   * 次の局へ進む15秒のカウントも始めない。1.5秒後に setLastWin() のタイマーが描き直す。
   */
  isWinRevealing() {
    return (
      !!this.lastWin &&
      !!this.winBannerShownAt &&
      Date.now() - this.winBannerShownAt < WIN_BANNER_DURATION_MS
    );
  }

  /**
   * 流局(荒牌平局)の直後で、聴牌者の手牌を公開しつつ画面全体を暗くして
   * 「流局」の文字だけを見せている間か(WIN_BANNER_DURATION_MS = 1.5秒)。
   * この間は結果のボックスをまだ出さず、次の局へ進む15秒のカウントも始めない。
   * 途中流局(四開槓など)はこの演出の対象外(手牌を公開しないため)。
   */
  isExhaustiveDrawRevealing() {
    return (
      !!this.state.roundEndReason &&
      this.state.roundEndReason.type === "exhaustive_draw" &&
      !!this.exhaustiveDrawShownAt &&
      Date.now() - this.exhaustiveDrawShownAt < WIN_BANNER_DURATION_MS
    );
  }

  /**
   * 流局直後、聴牌者の手牌(既に公開済み)はそのままに、画面全体を暗くして
   * 中央に「流局」の文字だけを表示する演出。renderTable()/renderTableLandscape()
   * から、卓(.table)の最後の子として重ねて呼ぶ。
   */
  renderExhaustiveDrawReveal() {
    if (!this.isExhaustiveDrawRevealing()) return null;
    const overlay = document.createElement("div");
    overlay.className = "exhaustive-draw-reveal";
    const text = document.createElement("div");
    text.className = "exhaustive-draw-reveal-text";
    text.textContent = "流局";
    overlay.appendChild(text);
    return overlay;
  }

  renderResultOverlay() {
    if (this.state.phase !== "round_end" && this.state.phase !== "game_end") return null;
    if (this.isWinRevealing() || this.isExhaustiveDrawRevealing()) return null;

    const box = document.createElement("div");
    box.className = "result-overlay";
    const addLine = (text, className) => {
      const el = document.createElement("p");
      el.className = className;
      el.textContent = text;
      box.appendChild(el);
    };

    if (this.state.phase === "game_end") {
      const reason = this.state.gameEndReason;
      addLine(
        reason && reason.type === "bust"
          ? `${this.seatLabel(reason.bustedPlayer)}家がトビました`
          : "全8局が終了しました",
        "result-heading"
      );
      addLine("対局終了", "result-main");
      addLine("最終結果", "result-heading final-heading");
      box.appendChild(this.renderFinalStandings());
      // 対局終了時に残っていた供託の行き先(最終結果の点数には加算済み)
      const bonus = reason && reason.riichiBonus;
      if (bonus && bonus.points > 0) {
        addLine(
          reason.type === "bust"
            ? `トビ終了により、供託の${bonus.points}点は${this.playerName(bonus.seat)}の持ち点へ加算されました。`
            : `供託の${bonus.points}点は起家取りのため、${this.playerName(bonus.seat)}の持ち点へ加算されました。`,
          "result-note"
        );
      }

      // 新しい対局を始めるか、対局を終了するかを選ぶ。新しい対局は両家が選んだら始まる
      // (CPU戦ではCPUは常に続行を選ぶので、押せばすぐ始まる)。
      const v = this.rematchVotes || {};
      const mySeats = ["east", "south"].filter((s) => this.canAct("confirm", s));
      const multi = mySeats.length > 1;
      const row = document.createElement("div");
      row.className = "result-confirm-row";
      for (const s of mySeats) {
        const label = (multi ? `${this.seatLabel(s)}家 ` : "") + (v[s] ? "新しい対局を待っています" : "新しい対局を始める");
        const b = this.button(label, () => this.voteRematch(s), v[s] ? undefined : "primary");
        b.disabled = !!v[s];
        row.appendChild(b);
      }
      if (this.onExit) {
        row.appendChild(this.button(this.gameEndExitLabel(), () => this.exitGame()));
      }
      box.appendChild(row);
      const other = ["east", "south"].find((s) => !mySeats.includes(s) && !this.autoRematchSeat(s));
      if (other) {
        box.appendChild(this.waitingHint(v[other] ? "相手: 新しい対局を希望しています" : "相手: 選択待ち"));
      }
      box.appendChild(this.renderPeekBoardButton(box));
      return box;
    }

    if (this.lastWin) {
      const { seat, kind, scoreResult, dora } = this.lastWin;
      addLine(`${this.seatLabel(seat)}家の${kind}`, "result-heading");
      {
        // 役が多く改行される場合も役名の途中で折り返さないよう、役名ごとに折り返し不可の要素にする。
        const el = document.createElement("p");
        el.className = "result-main";
        this.yakuNameList(scoreResult, dora).forEach((name, i, arr) => {
          const span = document.createElement("span");
          span.className = "yaku-name";
          span.textContent = name + (i < arr.length - 1 ? "・" : "");
          el.appendChild(span);
        });
        box.appendChild(el);
      }
      addLine(this.formatScore(scoreResult), "result-score");
      box.appendChild(this.renderResultDoraIndicators(scoreResult));
    } else if (this.state.roundEndReason && this.state.roundEndReason.type === "exhaustive_draw") {
      const tenpaiSeats = this.exhaustiveDrawTenpaiSeats();
      const nagashi = (this.lastExhaustiveOutcome && this.lastExhaustiveOutcome.nagashiYakumanSeats) || [];
      addLine("流局", "result-heading");
      nagashi.forEach((s) => addLine(`${this.playerName(s)}　流し役満`, "result-main"));
      // 対戦相手 → 自分の順に、それぞれ実際のプレイヤー名で聴牌/不聴を表示する。
      // 流し役満の行がある場合は、その下の行との間に少し余白を空けて区切る。
      [this.opponentSeat(), this.selfSeat()].forEach((s, i) => {
        const cls = i === 0 && nagashi.length > 0 ? "result-main result-main-spaced" : "result-main";
        addLine(`${this.playerName(s)} ${tenpaiSeats.includes(s) ? "聴牌" : "不聴"}`, cls);
      });
    } else if (this.state.roundEndReason && this.state.roundEndReason.type === "abortive_draw") {
      addLine("途中流局", "result-heading");
      addLine(this.state.roundEndReason.reason, "result-main");
    }

    const scoreChanges = this.renderResultScoreChanges();
    if (scoreChanges) box.appendChild(scoreChanges);

    // 確認ボタン: 自分が操作できる家の分だけ出す(ホットシートでは両家分、CPU戦・オンラインでは自分の分)。
    const c = this.roundConfirmations || {};
    const mySeats = ["east", "south"].filter((s) => this.canAct("confirm", s));
    const multi = mySeats.length > 1;
    const btnRow = document.createElement("div");
    btnRow.className = "result-confirm-row";
    for (const s of mySeats) {
      const label = (multi ? `${this.seatLabel(s)}家 ` : "") + (c[s] ? "確認済み" : "確認");
      const b = this.button(label, () => this.confirmRound(s), c[s] ? undefined : "primary");
      b.disabled = !!c[s];
      btnRow.appendChild(b);
    }
    box.appendChild(btnRow);
    if (!multi) {
      const other = ["east", "south"].find((s) => !mySeats.includes(s));
      if (other) box.appendChild(this.waitingHint(c[other] ? "相手: 確認済み" : "相手: 確認待ち"));
    }
    const countdown = this.waitingHint(this.resultCountdownText());
    countdown.classList.add("result-countdown");
    box.appendChild(countdown);
    box.appendChild(this.renderPeekBoardButton(box));
    return box;
  }

  /**
   * 和了・流局画面の右下の「盤面を見る」ボタン。押している間だけ結果のボックスを隠し、
   * 後ろの河・手牌などを見られるようにする(離すと元に戻る)。押している間に再描画されても
   * 隠したままにするため、状態は this._peekingBoard に持つ。
   */
  renderPeekBoardButton(box) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn result-peek-btn";
    b.dataset.sound = "none"; // 押している間だけ盤面を見るボタンなので、ボタンの音は鳴らさない
    b.textContent = "盤面を見る";
    if (this._peekingBoard) box.classList.add("result-peeking");
    const start = (e) => {
      e.preventDefault();
      this._peekingBoard = true;
      box.classList.add("result-peeking");
      if (b.setPointerCapture && e.pointerId != null) {
        try { b.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      }
      const end = () => {
        this._peekingBoard = false;
        const current = this.root.querySelector(".result-overlay");
        if (current) current.classList.remove("result-peeking");
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
        window.removeEventListener("blur", end);
      };
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
      window.addEventListener("blur", end);
    };
    b.addEventListener("pointerdown", start);
    b.addEventListener("contextmenu", (e) => e.preventDefault());
    return b;
  }

  /**
   * 結果画面に表示する、表ドラ(常時)・裏ドラ(リーチを含む和了の場合のみ)の表示牌一覧。
   * 表ドラ表示牌は wall.revealedDoraIndicators(カンのたびに増える)、裏ドラ表示牌は
   * それと同じ枚数だけ有効な activeUraDoraIndicators から取る。
   */
  renderResultDoraIndicators(scoreResult) {
    const wrap = document.createElement("div");
    wrap.className = "result-dora";

    const includesRiichi = scoreResult.yaku.some((y) => y.id === "riichi" || y.id === "double_riichi");

    const doraRow = document.createElement("div");
    doraRow.className = "result-dora-row";
    const doraLabel = document.createElement("span");
    doraLabel.className = "result-dora-label";
    doraLabel.textContent = "ドラ表示牌";
    doraRow.appendChild(doraLabel);
    const doraTiles = document.createElement("div");
    doraTiles.className = "result-dora-tiles tiles-small";
    for (const tile of this.state.wall.revealedDoraIndicators) {
      doraTiles.appendChild(makeTileEl(tile));
    }
    doraRow.appendChild(doraTiles);
    wrap.appendChild(doraRow);

    if (includesRiichi) {
      const uraRow = document.createElement("div");
      uraRow.className = "result-dora-row";
      const uraLabel = document.createElement("span");
      uraLabel.className = "result-dora-label";
      uraLabel.textContent = "裏ドラ表示牌";
      uraRow.appendChild(uraLabel);
      const uraTiles = document.createElement("div");
      uraTiles.className = "result-dora-tiles tiles-small";
      for (const tile of E.activeUraDoraIndicators(this.state.wall)) {
        uraTiles.appendChild(makeTileEl(tile));
      }
      uraRow.appendChild(uraTiles);
      wrap.appendChild(uraRow);
    }

    return wrap;
  }

  /** 「相手の操作待ち」を示す注記(オンライン対戦で自分が操作できない場面に出す)。 */
  /** 対局終了画面の、ロビーへ戻るボタンの文言(観戦画面では差し替える) */
  gameEndExitLabel() {
    return "対局を終了する";
  }

  waitingHint(text) {
    const hint = document.createElement("p");
    hint.className = "action-hint";
    hint.textContent = text;
    return hint;
  }

  button(label, onClick, variant) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn" + (variant === "primary" ? " btn-primary" : "");
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  toggleButton(label, active, onClick) {
    const b = this.button(label, onClick, active ? "primary" : undefined);
    b.classList.toggle("btn-toggle-active", active);
    return b;
  }

  /**
   * ツモ/ロン和了時に、和了者の手牌側にだけ表示する大きな文字(「ツモ」または「ロン」)。
   * setLastWin() が仕掛けたタイマーにより、表示から WIN_BANNER_DURATION_MS 経つと
   * 自動的に消える。seat が和了者本人でなければ何も返さない。
   */
  renderWinBanner(seat) {
    if (this.state.phase !== "round_end" || !this.lastWin || this.lastWin.seat !== seat) return null;
    if (!this.winBannerShownAt || Date.now() - this.winBannerShownAt >= WIN_BANNER_DURATION_MS) return null;
    const { kind } = this.lastWin;
    const label = kind === "ツモ和了" ? "ツモ" : "ロン";
    const banner = document.createElement("div");
    banner.className = "win-banner";
    banner.textContent = label;
    return banner;
  }

  /**
   * ポン・カン・リーチをした際に、その家の手牌側にだけ表示する大きな文字
   * (「ポン」「カン」「リーチ」)。setLastCall() が仕掛けたタイマーにより、
   * 表示から CALL_BANNER_DURATION_MS 経つと自動的に消える。
   * seat がポン/カン/リーチをした本人でなければ何も返さない。
   */
  renderCallBanner(seat) {
    if (this.state.phase === "round_end" || !this.lastCall || this.lastCall.seat !== seat) return null;
    if (!this.callBannerShownAt || Date.now() - this.callBannerShownAt >= CALL_BANNER_DURATION_MS) return null;
    const banner = document.createElement("div");
    banner.className = "win-banner call-banner";
    banner.textContent = this.lastCall.kind;
    return banner;
  }

  renderTable() {
    this._landscape = isLandscapePhone();
    if (this._landscape) return this.renderTableLandscape();

    const table = document.createElement("div");
    table.className = "table";

    const opponentSeat = this.opponentSeat();
    const selfSeat = this.selfSeat();

    // 実際の麻雀卓のように、各家の手牌と河の間にその家の前に積まれた山(牌山)を表示し、
    // 卓の中央(両者の河の間)に局・山の残り枚数・供託・得点をまとめて表示する。
    table.appendChild(
      this.renderHand(opponentSeat, {
        interactive: this.state.currentTurn === opponentSeat && this.canAct("discard", opponentSeat),
      })
    );
    table.appendChild(this.renderWallStack(opponentSeat));
    table.appendChild(this.renderDiscards(opponentSeat));
    table.appendChild(this.renderCenterInfo());
    // 自分側の河と、その右のスペースに置く操作ボタンをひとまとめにする
    // (ボタンは絶対配置なので、河の中央揃えには影響しない)。
    const selfRiverBand = document.createElement("div");
    selfRiverBand.className = "river-band";
    selfRiverBand.appendChild(this.renderDiscards(selfSeat));
    selfRiverBand.appendChild(this.renderSideActions());
    // 持ち時間は、操作ボタンと反対側(自分の河の左)の空いているスペースに出す
    const timer = this.renderTurnTimer();
    if (timer) selfRiverBand.appendChild(timer);
    table.appendChild(selfRiverBand);
    table.appendChild(this.renderWallStack(selfSeat));
    table.appendChild(
      this.renderHand(selfSeat, {
        interactive: this.state.currentTurn === selfSeat && this.canAct("discard", selfSeat),
      })
    );

    const toggles = this.renderToggles();
    toggles.appendChild(this.renderSoundButton());
    if (this.onExit) toggles.appendChild(this.renderExitButton());
    table.appendChild(toggles);

    // 流局直後は、結果のボックスより先に画面全体を暗くした「流局」表示を出す。
    const drawReveal = this.renderExhaustiveDrawReveal();
    if (drawReveal) table.appendChild(drawReveal);

    // 和了・流局・対局終了の結果は、卓の中央に重ねたボックスで知らせる。
    const overlay = this.renderResultOverlay();
    if (overlay) table.appendChild(overlay);

    return table;
  }

  /**
   * スマートフォン横向き用の卓(3列)。
   *   左: 相手の名前・持ち点 / 局・山の残り・供託 / 自分の名前・持ち点(手番の家が光る)
   *   中央: 相手の手牌・相手の河・リーチ棒・自分の河・自分の手牌
   *   右: 退室(右上、押し間違い防止のため操作ボタンから離す)・ドラ表示牌・設定・操作ボタン
   * 縦幅を節約するため牌山は表示せず、ドラ表示牌は右の欄に出す。
   */
  renderTableLandscape() {
    const table = document.createElement("div");
    table.className = "table table-landscape";
    const opponentSeat = this.opponentSeat();
    const selfSeat = this.selfSeat();

    const left = document.createElement("div");
    left.className = "ls-left";
    left.appendChild(this.renderCenterInfo());
    table.appendChild(left);

    const main = document.createElement("div");
    main.className = "ls-main";
    main.appendChild(
      this.renderHand(opponentSeat, {
        interactive: this.state.currentTurn === opponentSeat && this.canAct("discard", opponentSeat),
      })
    );
    main.appendChild(this.renderDiscards(opponentSeat));
    // リーチ棒は卓の真ん中(両者の河の間)に、それぞれの家の側に寄せて置く
    const sticks = document.createElement("div");
    sticks.className = "ls-sticks";
    for (const [seat, cls] of [[opponentSeat, "ls-stick-opponent"], [selfSeat, "ls-stick-self"]]) {
      const slot = document.createElement("div");
      slot.className = `ls-stick-slot ${cls}`;
      if (this.hasRiichiStick(seat)) {
        const stick = document.createElement("span");
        stick.className = "riichi-stick";
        stick.title = "リーチ棒(1000点)";
        slot.appendChild(stick);
      }
      sticks.appendChild(slot);
    }
    main.appendChild(sticks);
    main.appendChild(this.renderDiscards(selfSeat));
    // 選択肢のボタンは自分の河の右、持ち時間は河の左の空いているスペースに出す
    main.appendChild(this.renderSideActions());
    const timer = this.renderTurnTimer();
    if (timer) main.appendChild(timer);
    main.appendChild(
      this.renderHand(selfSeat, {
        interactive: this.state.currentTurn === selfSeat && this.canAct("discard", selfSeat),
      })
    );
    table.appendChild(main);

    const right = document.createElement("div");
    right.className = "ls-right";
    const topButtons = document.createElement("div");
    topButtons.className = "ls-top-buttons";
    topButtons.appendChild(this.renderSoundButton());
    if (this.onExit) topButtons.appendChild(this.renderExitButton());
    right.appendChild(topButtons);
    const dora = document.createElement("div");
    dora.className = "ls-dora";
    const doraLabel = document.createElement("div");
    doraLabel.className = "ls-dora-label";
    doraLabel.textContent = "ドラ表示牌";
    dora.appendChild(doraLabel);
    const doraTiles = document.createElement("div");
    doraTiles.className = "ls-dora-tiles tiles-small";
    // 実際の卓のように5枚分の場所を並べ、まだめくられていない分(カンのたびに1枚ずつめくれる)は裏向きにする
    const revealedDora = this.state.wall.revealedDoraIndicators;
    for (const tile of revealedDora) doraTiles.appendChild(makeTileEl(tile));
    for (let i = revealedDora.length; i < 5; i++) {
      doraTiles.appendChild(makeTileEl({ id: `dora-back-${i}`, kind: null }, { faceDown: true }));
    }
    dora.appendChild(doraTiles);
    right.appendChild(dora);
    right.appendChild(this.renderToggles());
    table.appendChild(right);

    const drawReveal = this.renderExhaustiveDrawReveal();
    if (drawReveal) table.appendChild(drawReveal);
    const overlay = this.renderResultOverlay();
    if (overlay) table.appendChild(overlay);
    return table;
  }

  /** 音のオン/オフ(消音)を切り替えるボタン。詳細な設定はロビーの「オプション」で行う。 */
  renderSoundButton() {
    const muted = MahjongSound.getSettings().muted;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn sound-btn" + (muted ? " sound-btn-muted" : "");
    b.setAttribute("aria-label", muted ? "音を出す" : "消音する");
    b.title = muted ? "音を出す" : "消音する";
    // スピーカーの形。消音中は音の波の代わりに×を描く
    b.innerHTML =
      '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" stroke="none"/>' +
      (muted
        ? '<path d="M16.5 9.5l5 5M21.5 9.5l-5 5"/>'
        : '<path d="M16 9.5a3.5 3.5 0 0 1 0 5"/><path d="M18.5 7a7 7 0 0 1 0 10"/>') +
      "</svg>";
    b.addEventListener("click", () => {
      MahjongSound.update({ muted: !muted });
      this.render();
    });
    return b;
  }

  /** 途中退室ボタン。押し間違い防止のため、押すと確認ダイアログを出す。 */
  renderExitButton() {
    const exitBtn = this.button("退室", () => {
      this.confirmingExit = true;
      this.render();
    });
    exitBtn.classList.add("exit-btn");
    return exitBtn;
  }

  /** 「相手の手牌を表示」トグルの文言(CPU対戦では「CPU手牌表示」に差し替える) */
  peekToggleLabel() {
    return "相手の手牌を表示(確認用)";
  }

  /** 自動理牌・鳴き無し・ツモ切り・自動和了(・相手の手牌を表示)のチェックボックス列 */
  renderToggles() {
    const toggles = document.createElement("div");
    toggles.className = "toggle-row";

    const sortToggle = document.createElement("label");
    sortToggle.className = "visibility-toggle";
    const sortCb = document.createElement("input");
    sortCb.type = "checkbox";
    sortCb.checked = this.autoSort;
    sortCb.addEventListener("change", () => this.setAutoSort(sortCb.checked));
    sortToggle.appendChild(sortCb);
    sortToggle.appendChild(
      document.createTextNode(" 自動理牌")
    );
    toggles.appendChild(sortToggle);

    const autoWinToggle = document.createElement("label");
    autoWinToggle.className = "visibility-toggle";
    const autoWinCb = document.createElement("input");
    autoWinCb.type = "checkbox";
    autoWinCb.checked = this.autoWin;
    autoWinCb.addEventListener("change", () => {
      this.autoWin = autoWinCb.checked;
      // オンにした瞬間に和了できる局面で止まっている場合は、そのまま自動和了を予約する。
      this.render();
    });
    autoWinToggle.appendChild(autoWinCb);
    autoWinToggle.appendChild(document.createTextNode(" 自動和了"));
    toggles.appendChild(autoWinToggle);

    const noCallToggle = document.createElement("label");
    noCallToggle.className = "visibility-toggle";
    const noCallCb = document.createElement("input");
    noCallCb.type = "checkbox";
    noCallCb.checked = this.noCall;
    noCallCb.addEventListener("change", () => {
      this.noCall = noCallCb.checked;
      // オンにした瞬間にポン・カンの選択待ちで止まっている場合は、そのまま自動で見送る。
      this.publish();
    });
    noCallToggle.appendChild(noCallCb);
    noCallToggle.appendChild(document.createTextNode(" 鳴き無し"));
    toggles.appendChild(noCallToggle);

    const tsumogiriToggle = document.createElement("label");
    tsumogiriToggle.className = "visibility-toggle";
    const tsumogiriCb = document.createElement("input");
    tsumogiriCb.type = "checkbox";
    tsumogiriCb.checked = this.autoTsumogiri;
    tsumogiriCb.addEventListener("change", () => {
      this.autoTsumogiri = tsumogiriCb.checked;
      // オンにした瞬間にツモった牌を持って止まっている場合は、そのまま自動で切る。
      this.render();
    });
    tsumogiriToggle.appendChild(tsumogiriCb);
    tsumogiriToggle.appendChild(document.createTextNode(" ツモ切り"));
    toggles.appendChild(tsumogiriToggle);

    if (this.allowPeekToggle) {
      const visibilityToggle = document.createElement("label");
      visibilityToggle.className = "visibility-toggle";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = this.showOpponentHand;
      cb.addEventListener("change", () => {
        this.showOpponentHand = cb.checked;
        this.render();
      });
      visibilityToggle.appendChild(cb);
      visibilityToggle.appendChild(document.createTextNode(" " + this.peekToggleLabel()));
      toggles.appendChild(visibilityToggle);
    }

    return toggles;
  }

  renderLog() {
    const wrap = document.createElement("div");
    wrap.className = "log-panel";
    const title = document.createElement("div");
    title.className = "log-title";
    title.textContent = "対局ログ";
    wrap.appendChild(title);
    const list = document.createElement("ul");
    for (const line of this.log) {
      const li = document.createElement("li");
      li.textContent = line;
      list.appendChild(li);
    }
    wrap.appendChild(list);
    return wrap;
  }
}

// ---------------- テストプレイ(CPU対戦) ----------------

/** CPUが行動するまでの待ち時間(人が相手の動きを目で追えるように少し間を置く) */
const CPU_ACTION_DELAY_MS = 600;

/** CPUの型ごとの表示名(「CPU(○○型)」の○○部分)。showTestPlayOptions() の選択肢と対応させる。 */
const CPU_TYPE_LABELS = {
  weak: "ポンコツ型",
  defensive: "守備型",
  offensive: "攻撃型",
  balanced: "バランス型",
  tsumogiri: "ツモ切り型",
};

/**
 * テストプレイ用: 画面上側(opponentSeat)をCPUが操作するローカル対戦。
 *
 * options:
 *   cpuType: "weak"(ポンコツ型。既定。旧 "efficiency"=通常 もこれになる) | "defensive"(守備型) | "offensive"(攻撃型) | "balanced"(バランス型) | "tsumogiri"(ツモ切りのみ。和了・鳴き・リーチ・カンをしない)
 *   humanSeat: 人が座る家("east" なら人が起家、"south" ならCPUが起家。既定 "east")
 *   timeControl: 人の持ち時間(MahjongApp 参照)
 *
 * CPUの判断そのものはエンジン側の純粋関数(E.decideTurnAction / E.decideCall)に任せ、
 * 実際の操作は人と同じ doDiscard / doTsumo / doRon / doPon / doPass / doAnkan を呼ぶことで、リーチ棒の供託タイミング・
 * 手出し演出・ログ・結果表示などの既存処理をそのまま使う。
 *
 * タイマーは常に1つだけ(_cpuTimer)。予約時の局面を表すキー(_cpuTaskKey)を覚えておき、
 * 再描画のたびに同じ局面なら予約し直さない(待ち時間が延びたり二重に行動したりしない)。
 * 発火時に局面が変わっていれば何もしない(次の render() で改めて予約される)。
 */
class CpuMahjongApp extends MahjongApp {
  constructor(root, options = {}) {
    super(root, Object.assign({}, options, { autoStart: false }));
    // 旧設定の "defense"(強化版)はバランス型として扱う
    const type = options.cpuType === "defense" ? "balanced" : options.cpuType;
    this.cpuType = ["tsumogiri", "balanced", "defensive", "offensive"].includes(type) ? type : "weak";
    this.humanSeat = options.humanSeat === "south" ? "south" : "east";
    this._cpuTimer = null;
    this._cpuTaskKey = null;
    this._destroyed = false;
    this.kifuRecorder = typeof KifuRecorder === "function" ? new KifuRecorder({ mode: "cpu" }) : null;
    if (options.autoStart !== false) {
      this.newGame();
    }
  }

  selfSeat() {
    return this.humanSeat;
  }

  opponentSeat() {
    return E.otherSeat(this.humanSeat);
  }

  cpuSeat() {
    return this.opponentSeat();
  }

  /** 守備(押し引き・ベタオリ)の性格。守備なしのCPUでは undefined(従来の判断) */
  cpuProfile() {
    return E.DEFENSE_PROFILES[this.cpuType]; // ポンコツ型・ツモ切りのみでは undefined
  }

  /** CPUの手牌は(確認用トグルがオフなら)常に伏せる。人の手番中も同様。 */
  hiddenSeatFor() {
    return this.cpuSeat();
  }

  /** テストプレイでは、自分の名前は「Player」、相手は型に応じて「CPU(○○型)」 */
  playerName(seat) {
    if (seat !== this.cpuSeat()) return "Player";
    const label = CPU_TYPE_LABELS[this.cpuType];
    return label ? `CPU(${label})` : "CPU";
  }

  /** CPU側の打牌・鳴きの判断は人には操作させない(ボタンも出さない)。 */
  canAct(kind, seat) {
    if ((kind === "discard" || kind === "callWindow" || kind === "confirm") && seat === this.cpuSeat()) {
      return false;
    }
    return true;
  }

  newGame() {
    this._clearCpuTimer();
    super.newGame();
  }

  autoRematchSeat(seat) {
    return seat === this.cpuSeat();
  }

  peekToggleLabel() {
    return "CPU手牌表示";
  }

  nextRound() {
    this._clearCpuTimer();
    super.nextRound();
  }

  destroy() {
    this._destroyed = true;
    if (this.kifuRecorder) this.kifuRecorder.stop();
    this._clearCpuTimer();
    this.clearResultTimers();
    this.stopTurnTimer();
    for (const key of ["_autoTsumogiriTimer", "_autoWinTimer", "_tedashiTimer", "_winBannerTimer", "_callBannerTimer", "_exhaustiveDrawTimer"]) {
      if (this[key]) {
        clearTimeout(this[key]);
        this[key] = null;
      }
    }
  }

  render() {
    if (this._destroyed) return;
    // CPUは結果画面ですぐに確認する(人が確認を押せば即座に次の局へ進む)
    if (this.state && this.state.phase === "round_end" && !this.roundConfirmations[this.cpuSeat()]) {
      this.roundConfirmations = Object.assign({}, this.roundConfirmations, { [this.cpuSeat()]: true });
    }
    super.render();
    this._scheduleCpu();
  }

  _clearCpuTimer() {
    if (this._cpuTimer) clearTimeout(this._cpuTimer);
    this._cpuTimer = null;
    this._cpuTaskKey = null;
  }

  /** いまCPUが判断すべき局面を表すキー。CPUの出番でなければ null。 */
  _cpuTaskKey_() {
    if (!this.state) return null;
    const cpu = this.cpuSeat();
    const phase = this.state.phase;
    if ((phase === "discard" || phase === "kan_replacement") && this.state.currentTurn === cpu) {
      const p = this.state.players[cpu];
      return `turn:${phase}:${p.drawnTile ? p.drawnTile.id : "-"}:${p.hand.length}:${p.melds.length}`;
    }
    if (phase === "call_window" && this.state.lastDiscard && E.otherSeat(this.state.lastDiscard.from) === cpu) {
      return `call:${this.state.lastDiscard.tile.id}`;
    }
    return null;
  }

  _scheduleCpu() {
    const key = this._cpuTaskKey_();
    if (!key) return this._clearCpuTimer();
    if (this._cpuTimer && this._cpuTaskKey === key) return; // 予約済み
    this._clearCpuTimer();
    this._cpuTaskKey = key;
    this._cpuTimer = setTimeout(() => {
      this._cpuTimer = null;
      this._cpuTaskKey = null;
      if (this._destroyed) return;
      // 手出し演出(TEDASHI_GAP_MS)の途中なら、それが終わってから改めて判断する
      if (this._tedashiTimer) return this._scheduleCpu();
      if (this._cpuTaskKey_() !== key) return this._scheduleCpu();
      this._runCpu(key);
    }, CPU_ACTION_DELAY_MS);
  }

  _runCpu(key) {
    const cpu = this.cpuSeat();
    try {
      if (this.cpuType === "tsumogiri") {
        // ツモ切りのみ: 鳴き・ロンは常に見送り、手番ではツモ牌をそのまま切る
        if (key.startsWith("call:")) {
          this.doPass();
          return;
        }
        const p = this.state.players[cpu];
        const tile = p.drawnTile || p.hand[p.hand.length - 1];
        this.pendingRiichi = false;
        this.doDiscard(tile);
        return;
      }
      if (key.startsWith("call:")) {
        const decision =
          this.cpuType === "weak" ? E.decideCallWeak(this.state, cpu) : E.decideCall(this.state, cpu, this.cpuProfile());
        if (decision === "ron") this.doRon();
        else if (decision === "pon") this.doPon(cpu);
        else if (decision === "minkan") this.doMinkan(cpu);
        else this.doPass();
        return;
      }
      const action =
        this.cpuType === "weak"
          ? E.decideTurnActionWeak(this.state, cpu)
          : E.decideTurnAction(this.state, cpu, this.cpuProfile());
      if (action.type === "tsumo") {
        this.doTsumo();
      } else if (action.type === "ankan") {
        this.doAnkan(action.kind);
      } else if (action.type === "kakan") {
        this.doKakan(action.kind);
      } else {
        this.pendingRiichi = !!action.declareRiichi;
        this.doDiscard(action.tile);
      }
    } catch (err) {
      // 想定外の例外で対局が止まらないよう、最低限の行動(見送り・ツモ切り)で進める
      console.error("CPU error", err);
      this.pendingRiichi = false;
      if (key.startsWith("call:")) {
        this.doPass();
      } else if (key.startsWith("turn:")) {
        const p = this.state.players[cpu];
        const tile = p.drawnTile || p.hand[p.hand.length - 1];
        if (tile) this.doDiscard(tile);
      }
    }
  }
}

// ---------------- 画面サイズに合わせた卓の拡大 ----------------
//
// 卓の各パーツ(牌・山・河・中央パネル)は、基準となる横幅 760px の中に収まるよう
// px で寸法を決めている。そのままだと画面の広いPCで卓だけが小さく見えてしまうため、
// ウィンドウの大きさに合わせて卓全体を拡大する(縮小はしない)。
// zoom はレイアウトごと拡大されるため、transform: scale と違って周囲の余白計算や
// クリック位置がずれない。未対応のブラウザでは拡大されないだけで従来どおり動く。

/** 拡大率1.0のときの卓の基準サイズ(河が3段とも埋まった状態で実測した値) */
const BOARD_DESIGN_WIDTH = 760;
const BOARD_DESIGN_HEIGHT = 720;
/** 拡大しすぎると却って見づらいので上限を設ける */
const BOARD_MAX_SCALE = 2;
/** この幅以下はスマートフォン向けに別途レイアウトを調整しているため拡大しない */
const BOARD_SCALE_MIN_WIDTH = 481;

function applyBoardScale() {
  const shell = document.querySelector(".app-shell");
  if (!shell) return;
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (width < BOARD_SCALE_MIN_WIDTH) {
    shell.style.zoom = "";
    return;
  }
  const scale = Math.min(width / BOARD_DESIGN_WIDTH, height / BOARD_DESIGN_HEIGHT, BOARD_MAX_SCALE);
  // 1倍未満(縦に短い横向きスマートフォンなど)では拡大も縮小もしない
  shell.style.zoom = scale > 1 ? String(Math.round(scale * 100) / 100) : "";
}

window.addEventListener("resize", applyBoardScale);

window.addEventListener("DOMContentLoaded", () => {
  const root = document.getElementById("app");
  applyBoardScale();
  // online.js が読み込まれていれば、そちらが「ローカル対戦 / オンライン対戦」の
  // 選択画面(ロビー)を出して起動を引き継ぐ。online.js が無い場合(単体テストなど)は
  // 従来通りローカル対戦をそのまま起動する。
  if (window.MahjongLobby && typeof window.MahjongLobby.mount === "function") {
    window.MahjongLobby.mount(root);
  } else {
    new MahjongApp(root);
  }
});
