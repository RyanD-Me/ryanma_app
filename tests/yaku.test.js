const test = require("node:test");
const assert = require("node:assert");
const { engine, man, pin, sou, honor, winContext } = require("./helpers");

const { evaluateYaku } = engine.evaluate;

/** 成立した役のIDの集合を返す */
function yakuIds(concealedTiles, melds, context) {
  const result = evaluateYaku({ concealedTiles, melds }, context);
  assert.ok(result.isWin, "和了形として認識されていない");
  return new Set(result.yaku.map((y) => y.id));
}

test("大七星: 字牌7種を2枚ずつで役満", () => {
  const hand = [
    honor("east"), honor("east"), honor("south"), honor("south"),
    honor("west"), honor("west"), honor("north"), honor("north"),
    honor("white"), honor("white"), honor("green"), honor("green"),
    honor("red"), honor("red"),
  ];
  const result = evaluateYaku({ concealedTiles: hand, melds: [] }, winContext({ winningTile: hand[13] }));
  const daichiishin = result.yaku.find((y) => y.id === "daichiishin");
  assert.ok(daichiishin, "大七星が成立していない");
  assert.strictEqual(daichiishin.isYakuman, true);
  assert.strictEqual(daichiishin.yakumanMultiplier, 1);
});

test("大数隣: 萬子2〜8を2枚ずつで役満", () => {
  const hand = [
    man(2), man(2), man(3), man(3), man(4), man(4), man(5),
    man(5), man(6), man(6), man(7), man(7), man(8), man(8),
  ];
  const result = evaluateYaku({ concealedTiles: hand, melds: [] }, winContext({ winningTile: hand[13] }));
  const daisuurin = result.yaku.find((y) => y.id === "daisuurin");
  assert.ok(daisuurin, "大数隣が成立していない");
  assert.strictEqual(daisuurin.isYakuman, true);
});

test("四暗刻: 単騎待ちなら役満(単独)", () => {
  const winTile = pin(1);
  const hand = [
    man(2), man(2), man(2), man(5), man(5), man(5),
    sou(9), sou(9), sou(9),
    honor("white"), honor("white"), honor("white"),
    pin(1), winTile,
  ];
  const result = evaluateYaku({ concealedTiles: hand, melds: [] }, winContext({ isTsumo: true, winningTile: winTile }));
  const suuankou = result.yaku.find((y) => y.id === "suuankou_tanki");
  assert.ok(suuankou, "四暗刻(単騎)が成立していない");
  assert.strictEqual(suuankou.isYakuman, true);
  assert.strictEqual(suuankou.combinable, false);
});

test("四暗刻: シャンポン待ちはツモなら倍満・複合あり", () => {
  const winTile = honor("white");
  const hand = [
    man(2), man(2), man(2), man(5), man(5), man(5),
    sou(9), sou(9), sou(9),
    honor("white"), honor("white"), winTile,
    pin(1), pin(1),
  ];
  const result = evaluateYaku({ concealedTiles: hand, melds: [] }, winContext({ isTsumo: true, winningTile: winTile }));
  const suuankou = result.yaku.find((y) => y.id === "suuankou_tsumo_shanpon");
  assert.ok(suuankou, "ツモり四暗刻が成立していない");
  assert.strictEqual(suuankou.han, 8); // 倍満相当を8翻役として表現する
  assert.strictEqual(suuankou.combinable, true);
});

test("四暗刻: シャンポン待ちをロンで完成した場合は不成立(三暗刻+対々和になる)", () => {
  const winTile = honor("white");
  const hand = [
    man(2), man(2), man(2), man(5), man(5), man(5),
    sou(9), sou(9), sou(9),
    honor("white"), honor("white"), winTile,
    pin(1), pin(1),
  ];
  const ids = yakuIds(hand, [], winContext({ isTsumo: false, winningTile: winTile }));
  assert.ok(!ids.has("suuankou_tsumo_shanpon"), "ロンなのに四暗刻が成立している");
  assert.ok(!ids.has("suuankou_tanki"));
  assert.ok(ids.has("sanankou"), "三暗刻が成立していない");
  assert.ok(ids.has("toitoi"), "対々和が成立していない");
});

test("国士無双: 13面待ちは役満(単独)、それ以外は倍満で複合あり", () => {
  const base = [
    man(9), pin(1), pin(9), sou(1), sou(9),
    honor("east"), honor("south"), honor("west"), honor("north"),
    honor("white"), honor("green"), honor("red"),
  ];

  // 13種すべて1枚ずつ揃った状態に、1萬が重なって和了(13面待ち)
  const winTile13 = man(1);
  const hand13 = [man(1), ...base, winTile13];
  const result13 = evaluateYaku({ concealedTiles: hand13, melds: [] }, winContext({ winningTile: winTile13 }));
  const kokushi13 = result13.yaku.find((y) => y.id === "kokushi_13");
  assert.ok(kokushi13, "13面待ちの国士無双が成立していない");
  assert.strictEqual(kokushi13.isYakuman, true);

  // すでに1萬が対子で、最後の1種(9萬)を引いて和了(単独待ち)
  const winTileOther = man(9);
  const handOther = [
    man(1), man(1), pin(1), pin(9), sou(1), sou(9),
    honor("east"), honor("south"), honor("west"), honor("north"),
    honor("white"), honor("green"), honor("red"),
    winTileOther,
  ];
  const resultOther = evaluateYaku({ concealedTiles: handOther, melds: [] }, winContext({ winningTile: winTileOther }));
  const kokushiOther = resultOther.yaku.find((y) => y.id === "kokushi_other");
  assert.ok(kokushiOther, "単独待ちの国士無双が成立していない");
  assert.strictEqual(kokushiOther.han, 8); // 倍満相当を8翻役として表現する
  assert.strictEqual(kokushiOther.combinable, true);

  // 単独待ちの国士無双(役満ではない8翻役)は、立直・門前清自摸和などの
  // 状況役と実際に複合すること(combinable:trueが立っているだけでなく、
  // evaluateYaku の結果に実際に含まれることを確認する)
  const resultCombined = evaluateYaku(
    { concealedTiles: handOther, melds: [] },
    winContext({ isTsumo: true, isRiichi: true, isIppatsu: true, winningTile: winTileOther })
  );
  const combinedIds = new Set(resultCombined.yaku.map((y) => y.id));
  assert.ok(combinedIds.has("kokushi_other"), "国士無双(非13面)が成立していない");
  assert.ok(combinedIds.has("riichi"), "立直と複合していない");
  assert.ok(combinedIds.has("ippatsu"), "一発と複合していない");
  assert.ok(combinedIds.has("menzen_tsumo"), "門前清自摸和と複合していない");
});

test("チー不可のため、鳴いた順子は面子として存在しない(混一色は鳴きでも成立する)", () => {
  const winTile = man(5);
  const concealed = [
    man(3), man(4), man(5), man(6), man(7), man(8),
    man(3), man(4), winTile,
    man(2), man(2),
  ];
  const melds = [
    { type: "triplet", tiles: [honor("white"), honor("white"), honor("white")], isOpen: true, calledFrom: "opponent" },
  ];
  const ids = yakuIds(concealed, melds, winContext({ winningTile: winTile }));
  assert.ok(ids.has("honitsu"), "混一色が成立していない");
  assert.ok(ids.has("yakuhai_white"), "役牌(白)が成立していない");
});

test("役満(字一色)は他の通常役(対々和・役牌など)と複合しない", () => {
  // 字牌のみの4刻子+雀頭。字一色(役満)だけでなく、そのままなら
  // 対々和・役牌(自風・場風・中)・三暗刻も同時に条件を満たしてしまう形。
  const winTile = honor("red");
  const hand = [
    honor("east"), honor("east"), honor("east"),
    honor("south"), honor("south"), honor("south"),
    honor("west"), honor("west"), honor("west"),
    honor("white"), honor("white"),
    honor("red"), honor("red"), winTile,
  ];
  const result = evaluateYaku({ concealedTiles: hand, melds: [] }, winContext({ winningTile: winTile }));
  assert.ok(result.isWin);
  const ids = new Set(result.yaku.map((y) => y.id));

  assert.ok(ids.has("tsuuiisou"), "字一色が成立していない");
  // 役満が成立している以上、通常役(n翻役)は判定結果に一切含まれない
  assert.ok(!ids.has("toitoi"), "役満なのに対々和が複合している");
  assert.ok(!ids.has("yakuhai_seat"), "役満なのに役牌(自風)が複合している");
  assert.ok(!ids.has("yakuhai_round"), "役満なのに役牌(場風)が複合している");
  assert.ok(!ids.has("yakuhai_red"), "役満なのに役牌(中)が複合している");
  assert.ok(!ids.has("sanankou"), "役満なのに三暗刻が複合している");
  assert.strictEqual(result.yaku.length, 1, "役満成立時は役満の役だけが結果に残るべき");
  assert.ok(result.yaku.every((y) => y.isYakuman), "結果に役満以外の役が混じっている");
});

test("大三元(門前): 役満のため、内訳の役牌(白・發・中)とは複合しない", () => {
  // 白・發・中の暗刻3つ + 萬子の順子 + 筒子の雀頭(門前)
  const winTile = pin(1);
  const hand = [
    honor("white"), honor("white"), honor("white"),
    honor("green"), honor("green"), honor("green"),
    honor("red"), honor("red"), honor("red"),
    man(1), man(2), man(3),
    pin(1), winTile,
  ];
  const result = evaluateYaku({ concealedTiles: hand, melds: [] }, winContext({ winningTile: winTile }));
  assert.ok(result.isWin);
  const ids = new Set(result.yaku.map((y) => y.id));
  assert.ok(ids.has("daisangen"), "大三元(門前)が成立していない");
  assert.ok(!ids.has("yakuhai_white"), "役満なのに役牌(白)が複合している");
  assert.ok(!ids.has("yakuhai_green"), "役満なのに役牌(發)が複合している");
  assert.ok(!ids.has("yakuhai_red"), "役満なのに役牌(中)が複合している");
  assert.strictEqual(result.yaku.length, 1, "役満成立時は役満の役だけが結果に残るべき");
});

test("大三元(鳴き・8翻): 白・發・中の役牌とは複合しない(二重計上を避ける)", () => {
  // 白を鳴いて(ポン)、發・中は暗刻。他の役(混一色など)との複合は妨げない形にする。
  const winTile = pin(1);
  const concealed = [
    honor("green"), honor("green"), honor("green"),
    honor("red"), honor("red"), honor("red"),
    man(1), man(2), man(3),
    pin(1), winTile,
  ];
  const melds = [
    { type: "triplet", tiles: [honor("white"), honor("white"), honor("white")], isOpen: true, calledFrom: "opponent" },
  ];
  const ids = yakuIds(concealed, melds, winContext({ winningTile: winTile }));
  assert.ok(ids.has("daisangen_open"), "大三元(鳴き)が成立していない");
  assert.ok(!ids.has("yakuhai_white"), "大三元(鳴き)なのに役牌(白)が複合している");
  assert.ok(!ids.has("yakuhai_green"), "大三元(鳴き)なのに役牌(發)が複合している");
  assert.ok(!ids.has("yakuhai_red"), "大三元(鳴き)なのに役牌(中)が複合している");
});

test("三槓子は11翻の通常役として、他の役と複合する(倍満・三倍満の固定帯扱いをしない)", () => {
  // 字牌の暗槓3つ(東・南・西)+ 萬子の順子(1-2-3)+ 筒子9の雀頭。
  // 4つ目の面子を刻子ではなく順子にすることで、対々和や四暗刻とは別に
  // 三槓子だけが他の役(役牌・混全帯幺九・三暗刻)と複合する形を作る。
  const winTile = man(3);
  const hand = {
    concealedTiles: [man(1), man(2), winTile, pin(9), pin(9)],
    melds: [
      { type: "kan_closed", tiles: [honor("east"), honor("east"), honor("east"), honor("east")], isOpen: false },
      { type: "kan_closed", tiles: [honor("south"), honor("south"), honor("south"), honor("south")], isOpen: false },
      { type: "kan_closed", tiles: [honor("west"), honor("west"), honor("west"), honor("west")], isOpen: false },
    ],
  };
  const result = evaluateYaku(hand, winContext({ winningTile: winTile }));
  assert.ok(result.isWin);

  const sankantsu = result.yaku.find((y) => y.id === "sankantsu");
  assert.ok(sankantsu, "三槓子が成立していない");
  assert.strictEqual(sankantsu.han, 11); // 三倍満相当を11翻役として表現する
  assert.strictEqual(sankantsu.combinable, true);

  // 固定帯として単独扱い(combinable:false)にしていた頃と異なり、
  // 役牌・混全帯幺九・三暗刻など他の役ともそのまま複合してよい。
  const ids = new Set(result.yaku.map((y) => y.id));
  assert.ok(ids.has("yakuhai_seat"), "役牌(自風)が複合していない");
  assert.ok(ids.has("yakuhai_round"), "役牌(場風)が複合していない");
  assert.ok(ids.has("sanankou"), "三暗刻が複合していない");
});

test("七対子はリーチ・一発・門前清自摸和など状況役と複合する", () => {
  // 3スート+字牌1種の、混一色・清一色・混老頭のどれにも該当しない素の七対子。
  const hand = [
    man(3), man(3), man(5), man(5),
    pin(1), pin(1), pin(9), pin(9),
    sou(1), sou(1), sou(9), sou(9),
    honor("east"), honor("east"),
  ];
  const winTile = hand[13];
  const result = evaluateYaku(
    { concealedTiles: hand, melds: [] },
    winContext({ isTsumo: true, isRiichi: true, isIppatsu: true, winningTile: winTile })
  );
  assert.ok(result.isWin);
  const ids = new Set(result.yaku.map((y) => y.id));
  assert.ok(ids.has("chiitoitsu"), "七対子が成立していない");
  assert.ok(ids.has("riichi"), "リーチが七対子と複合していない");
  assert.ok(ids.has("ippatsu"), "一発が七対子と複合していない");
  assert.ok(ids.has("menzen_tsumo"), "門前清自摸和が七対子と複合していない");
  assert.strictEqual(result.fu, 25, "七対子の符は状況役が複合しても25符のまま");
});

test("七対子+混一色(大七星に該当しない字牌混じりの一色)", () => {
  const hand = [
    man(2), man(2), man(4), man(4), man(6), man(6),
    honor("east"), honor("east"), honor("south"), honor("south"),
    honor("white"), honor("white"), honor("green"), honor("green"),
  ];
  const result = evaluateYaku({ concealedTiles: hand, melds: [] }, winContext({ winningTile: hand[13] }));
  assert.ok(result.isWin);
  const ids = new Set(result.yaku.map((y) => y.id));
  assert.ok(ids.has("chiitoitsu"));
  assert.ok(ids.has("honitsu"), "混一色が七対子と複合していない");
  const honitsu = result.yaku.find((y) => y.id === "honitsu");
  assert.strictEqual(honitsu.han, 3);
  assert.ok(!ids.has("daichiishin"), "字牌だけではないので大七星は成立しないはず");
});

test("七対子+清一色(大数隣に該当しない老頭牌混じりの萬子一色)", () => {
  // 標準形(4面子+雀頭)には分解できない飛び飛びのランク構成にして、
  // 七対子側の解釈が確実に採用されるようにする。
  const hand = [
    man(1), man(1), man(2), man(2), man(4), man(4), man(5), man(5),
    man(7), man(7), man(8), man(8), man(9), man(9),
  ];
  const result = evaluateYaku({ concealedTiles: hand, melds: [] }, winContext({ winningTile: hand[13] }));
  assert.ok(result.isWin);
  const ids = new Set(result.yaku.map((y) => y.id));
  assert.ok(ids.has("chiitoitsu"));
  assert.ok(ids.has("chinitsu"), "清一色が七対子と複合していない");
  const chinitsu = result.yaku.find((y) => y.id === "chinitsu");
  assert.strictEqual(chinitsu.han, 6);
  assert.ok(!ids.has("daisuurin"), "老頭牌(1・9)を含むので大数隣は成立しないはず");
});

test("七対子+混老頭(大七星に該当しない老頭牌+字牌混じり)", () => {
  const hand = [
    man(1), man(1), man(9), man(9),
    pin(1), pin(1), pin(9), pin(9),
    sou(1), sou(1), sou(9), sou(9),
    honor("east"), honor("east"),
  ];
  const result = evaluateYaku({ concealedTiles: hand, melds: [] }, winContext({ winningTile: hand[13] }));
  assert.ok(result.isWin);
  const ids = new Set(result.yaku.map((y) => y.id));
  assert.ok(ids.has("chiitoitsu"));
  assert.ok(ids.has("honroutou"), "混老頭が七対子と複合していない");
  assert.ok(!ids.has("honitsu") && !ids.has("chinitsu"), "3スート使っているので混一色・清一色は成立しないはず");
  assert.ok(!ids.has("daichiishin"), "字牌だけではないので大七星は成立しないはず");
});

test("大七星・大数隣は役満のため、リーチ等の状況役や通常役とは複合しない(回帰確認)", () => {
  const daichiishinHand = [
    honor("east"), honor("east"), honor("south"), honor("south"),
    honor("west"), honor("west"), honor("north"), honor("north"),
    honor("white"), honor("white"), honor("green"), honor("green"),
    honor("red"), honor("red"),
  ];
  const r1 = evaluateYaku(
    { concealedTiles: daichiishinHand, melds: [] },
    winContext({ isTsumo: true, isRiichi: true, isIppatsu: true, winningTile: daichiishinHand[13] })
  );
  assert.ok(r1.isWin);
  assert.strictEqual(r1.yaku.length, 1);
  assert.strictEqual(r1.yaku[0].id, "daichiishin");

  const daisuurinHand = [
    man(2), man(2), man(3), man(3), man(4), man(4), man(5),
    man(5), man(6), man(6), man(7), man(7), man(8), man(8),
  ];
  const r2 = evaluateYaku(
    { concealedTiles: daisuurinHand, melds: [] },
    winContext({ isTsumo: true, isRiichi: true, isIppatsu: true, winningTile: daisuurinHand[13] })
  );
  assert.ok(r2.isWin);
  assert.strictEqual(r2.yaku.length, 1);
  assert.strictEqual(r2.yaku[0].id, "daisuurin");
});

test("大七星と字一色は複合せず、大七星が優先される", () => {
  // 字牌7種を2枚ずつ(大七星の形)。状況役(河底撈魚)のコンテキストを与えても、
  // 大七星は他の解釈(標準形の字一色や状況役)と一切複合せず単独で確定する。
  const hand = [
    honor("east"), honor("east"), honor("south"), honor("south"),
    honor("west"), honor("west"), honor("north"), honor("north"),
    honor("white"), honor("white"), honor("green"), honor("green"),
    honor("red"), honor("red"),
  ];
  const result = evaluateYaku(
    { concealedTiles: hand, melds: [] },
    winContext({ isHoutei: true, winningTile: hand[13] })
  );
  assert.ok(result.isWin);
  assert.strictEqual(result.yaku.length, 1, "大七星は他の役(字一色・河底撈魚など)と複合しないはず");
  assert.strictEqual(result.yaku[0].id, "daichiishin");
});
